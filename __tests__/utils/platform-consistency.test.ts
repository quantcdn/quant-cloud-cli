import { describe, it, expect, jest, beforeEach, beforeAll, afterEach, afterAll } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

// Real config.ts against a temporary HOME; only .quant.yml discovery is mocked.
const home = mkdtempSync(join(tmpdir(), 'qc-home-'));
process.env.QUANT_CONFIG_DIR = join(home, '.quant');

const mockGetProjectConfig = jest.fn<(...args: any[]) => any>();
jest.unstable_mockModule('../../src/utils/project-config.js', () => ({
  getProjectConfig: mockGetProjectConfig,
}));

// Safety: never touch the real ~/.quant/credentials.
function assertIsolated(configFile: string): void {
  if (!configFile.startsWith(home)) {
    throw new Error(`refusing to run: CONFIG_FILE is ${configFile}`);
  }
}
if (!process.env.QUANT_CONFIG_DIR || !process.env.QUANT_CONFIG_DIR.startsWith(home)) {
  throw new Error('refusing to run: QUANT_CONFIG_DIR is not the temp dir');
}

const info = (id: string, host: string) => ({ id, name: id, host });
const creds = {
  activePlatform: 'quantcdn',
  platforms: {
    quantcdn: {
      token: 'tok-cdn', host: 'https://cdn.example', activeOrganization: 'cdn-org',
      activeApplication: 'cdn-app', platformInfo: info('quantcdn', 'https://cdn.example'),
    },
    quantgov: {
      token: 'tok-gov', host: 'https://gov.example', activeOrganization: 'gov-org',
      activeApplication: 'gov-app', platformInfo: info('quantgov', 'https://gov.example'),
    },
  },
};
const credFile = join(home, '.quant', 'credentials');
const readCreds = () => JSON.parse(readFileSync(credFile, 'utf-8'));

let ctx: typeof import('../../src/utils/context.js');
let Command: typeof import('commander').Command;
let orgCommand: typeof import('../../src/commands/org.js').orgCommand;
let envVarsCommand: typeof import('../../src/commands/env-vars.js').envVarsCommand;
let axios: typeof import('axios').default;

beforeAll(async () => {
  const { CONFIG_FILE } = await import('../../src/utils/config.js');
  assertIsolated(CONFIG_FILE);
  ctx = await import('../../src/utils/context.js');
  ({ Command } = await import('commander'));
  ({ orgCommand } = await import('../../src/commands/org.js'));
  ({ envVarsCommand } = await import('../../src/commands/env-vars.js'));
  // The SDK is CommonJS, so mock the same CommonJS axios instance it calls.
  axios = createRequire(import.meta.url)('axios').default ?? createRequire(import.meta.url)('axios');
});

beforeEach(() => {
  mkdirSync(join(home, '.quant'), { recursive: true });
  writeFileSync(credFile, JSON.stringify(creds));
  mockGetProjectConfig.mockReturnValue({});
});

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('one platform per command (no mixing)', () => {
  it('--platform quantgov: host, token and stored org/app all come from quantgov', async () => {
    const auth = await ctx.getEffectiveAuth('quantgov');
    const eff = await ctx.resolveEffectiveContext({ platform: 'quantgov' });
    for (const x of [auth!, eff]) {
      expect(x.host).toBe('https://gov.example');
      expect(x.token).toBe('tok-gov');
    }
    expect(auth!.activeOrganization).toBe('gov-org');
    expect(eff.activeOrganization).toBe('gov-org');
    expect(eff.activeApplication).toBe('gov-app');
  });

  it('persists context updates to the override platform and leaves the active platform alone', async () => {
    await ctx.saveEffectiveConfig({ activeEnvironment: 'prod' }, 'quantgov');
    const saved = readCreds();
    expect(saved.platforms.quantgov.activeEnvironment).toBe('prod');
    expect(saved.platforms.quantcdn.activeEnvironment).toBeUndefined();
    expect(saved.activePlatform).toBe('quantcdn');
  });

  it('a command without --platform (org list) honours .quant.yml platform for host, token and context', async () => {
    mockGetProjectConfig.mockReturnValue({ platform: 'quantgov' });
    const fetchMock = jest.fn<(...args: any[]) => any>().mockResolvedValue({
      ok: true,
      json: async () => ({ organizations: [{ machine_name: 'gov-org', name: 'Gov', roles: [] }] }),
    });
    (globalThis as any).fetch = fetchMock;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    orgCommand(program);
    await program.parseAsync(['node', 'qc', 'org', 'list']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gov.example/api/oauth/user');
    expect(init.headers.Authorization).toBe('Bearer tok-gov');
    const saved = readCreds();
    expect(saved.platforms.quantgov.organizations).toHaveLength(1);
    expect(saved.platforms.quantcdn.organizations).toBeUndefined();
    expect(saved.activePlatform).toBe('quantcdn');
  });
});

describe('qc env vars uses the same resolver', () => {
  it('list --platform quantgov sends the gov host and gov token, not the active platform', async () => {
    const requestMock = jest.spyOn(axios, 'request').mockResolvedValue({ data: { variables: [] }, status: 200 } as any);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    envVarsCommand(program.command('env'));
    await program.parseAsync([
      'node', 'qc', 'env', 'vars', 'list', '--platform', 'quantgov', '--app', 'gov-app', '--env', 'prod', '--json',
    ]);

    expect(requestMock).toHaveBeenCalledTimes(1);
    const args: any = requestMock.mock.calls[0][0];
    expect(args.url).toContain('https://gov.example');
    expect(args.url).toContain('/gov-org/');
    expect(args.url).not.toContain('cdn.example');
    expect(args.headers.Authorization).toBe('Bearer tok-gov');
    expect(readCreds().activePlatform).toBe('quantcdn');
  });
});

afterAll(() => rmSync(home, { recursive: true, force: true }));
