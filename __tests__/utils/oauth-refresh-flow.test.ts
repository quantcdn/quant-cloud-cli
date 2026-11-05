import { describe, it, expect, jest, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// Real credentials file, lock file and refresh code, in a temp config dir.
const home = mkdtempSync(join(tmpdir(), 'qc-oauth-refresh-'));
process.env.QUANT_CONFIG_DIR = join(home, '.quant');
mkdirSync(process.env.QUANT_CONFIG_DIR);
if (!process.env.QUANT_CONFIG_DIR.startsWith(home)) {
  throw new Error('refusing to run: QUANT_CONFIG_DIR is not the temp dir');
}

jest.unstable_mockModule('../../src/utils/project-config.js', () => ({
  getProjectConfig: () => ({}),
}));

const HOST = 'https://dash.example.test';
const DAY = 24 * 60 * 60 * 1000;

let credFile: string;
let ctx: typeof import('../../src/utils/context.js');
let ApiClient: typeof import('../../src/utils/api.js').ApiClient;

beforeAll(async () => {
  ({ CONFIG_FILE: credFile } = await import('../../src/utils/config.js'));
  ctx = await import('../../src/utils/context.js');
  ({ ApiClient } = await import('../../src/utils/api.js'));
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

interface Login {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
}

function writeLogin(login: Login): void {
  const platform = { ...login, host: HOST, activeOrganization: 'acme', platformInfo: { id: 'quantcdn', name: 'Q', host: HOST } };
  writeFileSync(credFile, JSON.stringify({ activePlatform: 'quantcdn', platforms: { quantcdn: platform } }));
}

const stored = () => JSON.parse(readFileSync(credFile, 'utf-8')).platforms.quantcdn;

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

const rotated = (n: number, extra: Record<string, unknown> = {}) =>
  json(200, { access_token: `qc_new${n}`, refresh_token: `qcr_new${n}`, expires_in: 90 * 86400, token_type: 'Bearer', ...extra });

const fetchMock = jest.fn<(...args: any[]) => any>();
const isTokenCall = (call: any[]) => String(call[0]).endsWith('/oauth/token');
const tokenCalls = () => fetchMock.mock.calls.filter(isTokenCall);
const sentRefreshToken = (call: any[]) => new URLSearchParams(call[1].body).get('refresh_token');

// The SDK calls the CommonJS axios when no instance is passed (legacy logins).
const cjsAxios = createRequire(import.meta.url)('axios');
const sdkAxios = cjsAxios.default ?? cjsAxios;

const realFetch = global.fetch;
const realAdapter = axios.defaults.adapter;
const realSdkAdapter = sdkAxios.defaults.adapter;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
});

afterEach(() => {
  global.fetch = realFetch;
  axios.defaults.adapter = realAdapter;
  sdkAxios.defaults.adapter = realSdkAdapter;
  jest.restoreAllMocks();
});

/** Routes the quant-client (axios) requests to respond(), and records the token sent. */
function fakeApi(respond: (token: string) => number): string[] {
  const tokens: string[] = [];
  const adapter = async (config: InternalAxiosRequestConfig) => {
    const token = String(config.headers.Authorization).replace('Bearer ', '');
    tokens.push(token);
    const status = respond(token);
    const response: AxiosResponse = { data: [{ name: 'app' }], status, statusText: String(status), headers: {}, config };
    if (status >= 400) {
      throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response);
    }
    return response;
  };
  axios.defaults.adapter = adapter;
  sdkAxios.defaults.adapter = adapter;
  return tokens;
}

describe('legacy login (no refresh token, no expiry)', () => {
  it('is never refreshed, and a 401 is not retried', async () => {
    writeLogin({ token: 'legacy-token' });
    const before = readFileSync(credFile, 'utf-8');
    const sent = fakeApi(() => 401);

    const auth = await ctx.getEffectiveAuth();
    const client = await ApiClient.create();
    await expect(client.getApplications()).rejects.toThrow(/Authentication expired/);

    expect(auth?.token).toBe('legacy-token');
    expect(sent).toEqual(['legacy-token']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readFileSync(credFile, 'utf-8')).toBe(before);
  });
});

describe('proactive refresh', () => {
  it('refreshes a due token and saves the new pair atomically with mode 0600', async () => {
    writeLogin({ token: 'qc_old1', refreshToken: 'qcr_old1', expiresAt: new Date(Date.now() + DAY).toISOString() });
    fetchMock.mockResolvedValue(rotated(1));

    const auth = await ctx.getEffectiveAuth();

    expect(auth?.token).toBe('qc_new1');
    expect(tokenCalls()).toHaveLength(1);
    expect(sentRefreshToken(tokenCalls()[0])).toBe('qcr_old1');
    expect(stored()).toMatchObject({ token: 'qc_new1', refreshToken: 'qcr_new1', activeOrganization: 'acme' });
    expect(Date.parse(stored().expiresAt)).toBeGreaterThan(Date.now() + 89 * DAY);
    expect(statSync(credFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(home, '.quant'))).toEqual(['credentials']);
  });

  it('does not refresh a token with more than 7 days left', async () => {
    writeLogin({ token: 'qc_fresh', refreshToken: 'qcr_fresh', expiresAt: new Date(Date.now() + 30 * DAY).toISOString() });

    expect((await ctx.getEffectiveAuth())?.token).toBe('qc_fresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the stored refresh token when the response has none', async () => {
    writeLogin({ token: 'qc_old2', refreshToken: 'qcr_keep', expiresAt: new Date(Date.now() + DAY).toISOString() });
    fetchMock.mockResolvedValue(json(200, { access_token: 'qc_new2', expires_in: 90 * 86400, token_type: 'Bearer' }));

    await ctx.getEffectiveAuth();

    expect(stored()).toMatchObject({ token: 'qc_new2', refreshToken: 'qcr_keep' });
  });

  it('sends one refresh request when two refreshes run at the same time', async () => {
    writeLogin({ token: 'qc_old3', refreshToken: 'qcr_old3', expiresAt: new Date(Date.now() - DAY).toISOString() });
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return rotated(3);
    });

    const [a, b] = await Promise.all([ctx.getEffectiveAuth(), ctx.getEffectiveAuth()]);

    expect(tokenCalls()).toHaveLength(1);
    expect(a?.token).toBe('qc_new3');
    expect(b?.token).toBe('qc_new3');
    expect(stored().refreshToken).toBe('qcr_new3');
    expect(existsSync(`${credFile}.lock`)).toBe(false);
  });
});

describe('401 retry', () => {
  const notDue = () => new Date(Date.now() + 60 * DAY).toISOString();

  it('refreshes once and repeats the API request once', async () => {
    writeLogin({ token: 'qc_old4', refreshToken: 'qcr_old4', expiresAt: notDue() });
    fetchMock.mockResolvedValue(rotated(4));
    const sent = fakeApi((token) => (token === 'qc_new4' ? 200 : 401));

    const client = await ApiClient.create();
    const apps = await client.getApplications();

    expect(apps).toEqual([{ name: 'app' }]);
    expect(sent).toEqual(['qc_old4', 'qc_new4']);
    expect(tokenCalls()).toHaveLength(1);
    expect(stored().token).toBe('qc_new4');
  });

  it('does not loop when the renewed token also gets 401', async () => {
    writeLogin({ token: 'qc_old5', refreshToken: 'qcr_old5', expiresAt: notDue() });
    fetchMock.mockResolvedValue(rotated(5));
    const sent = fakeApi(() => 401);

    const client = await ApiClient.create();
    await expect(client.getApplications()).rejects.toThrow(/Authentication expired/);

    expect(sent).toEqual(['qc_old5', 'qc_new5']);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('refreshes once and repeats the /api/oauth/user request once', async () => {
    writeLogin({ token: 'qc_old6', refreshToken: 'qcr_old6', expiresAt: notDue() });
    fetchMock.mockImplementation(async (url: any, init: any) => {
      if (String(url).endsWith('/oauth/token')) {
        return rotated(6);
      }
      return init.headers.Authorization === 'Bearer qc_new6' ? json(200, { email: 'a@b.c' }) : json(401, {});
    });

    const client = await ApiClient.create();

    expect(await client.getUserInfo()).toEqual({ email: 'a@b.c' });
    expect(tokenCalls()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('refresh token refused', () => {
  it('tells the user to run qc login and keeps the credentials', async () => {
    writeLogin({ token: 'qc_old7', refreshToken: 'qcr_dead', expiresAt: new Date(Date.now() + DAY).toISOString() });
    const before = readFileSync(credFile, 'utf-8');
    fetchMock.mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const auth = await ctx.getEffectiveAuth();
    await ctx.getEffectiveAuth();

    expect(auth?.token).toBe('qc_old7');
    expect(tokenCalls()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Refresh token revoked');
    expect(String(warn.mock.calls[0][0])).toContain('qc login');
    expect(readFileSync(credFile, 'utf-8')).toBe(before);
  });
});
