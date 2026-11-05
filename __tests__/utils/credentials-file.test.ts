import { describe, it, expect, jest, beforeAll, afterEach, afterAll } from '@jest/globals';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Real credentials file in a temp config dir.
const home = mkdtempSync(join(tmpdir(), 'qc-credentials-'));
const configDir = join(home, '.quant');
process.env.QUANT_CONFIG_DIR = configDir;
if (!process.env.QUANT_CONFIG_DIR.startsWith(home)) {
  throw new Error('refusing to run: QUANT_CONFIG_DIR is not the temp dir');
}
mkdirSync(configDir);

let config: typeof import('../../src/utils/config.js');

beforeAll(async () => {
  config = await import('../../src/utils/config.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  rmSync(config.CONFIG_FILE, { force: true });
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const info = (id: string) => ({ id, name: id, host: `https://${id}.example` });
const twoPlatforms = () => JSON.stringify({
  activePlatform: 'quantcdn',
  platforms: {
    quantcdn: { token: 'a', host: 'https://quantcdn.example', platformInfo: info('quantcdn') },
    quantgov: { token: 'b', host: 'https://quantgov.example', platformInfo: info('quantgov') },
  },
});

describe('credentials file save', () => {
  it('keeps a symlinked credentials file as a symlink and updates its target', async () => {
    const target = join(home, 'dotfiles-credentials');
    writeFileSync(target, twoPlatforms());
    symlinkSync(target, config.CONFIG_FILE);

    await config.savePlatformUpdates('quantcdn', { activeOrganization: 'acme' });

    expect(lstatSync(config.CONFIG_FILE).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf-8')).platforms.quantcdn.activeOrganization).toBe('acme');
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('writes in place when the rename fails with EBUSY (single-file bind mount)', async () => {
    writeFileSync(config.CONFIG_FILE, twoPlatforms());
    const rename = jest.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));

    await config.savePlatformUpdates('quantgov', { activeOrganization: 'gov-org' });

    expect(rename).toHaveBeenCalledTimes(4);
    const saved = JSON.parse(readFileSync(config.CONFIG_FILE, 'utf-8'));
    expect(saved.platforms.quantgov.activeOrganization).toBe('gov-org');
    expect(saved.platforms.quantcdn.token).toBe('a');
    expect(statSync(config.CONFIG_FILE).mode & 0o777).toBe(0o600);
    expect(readdirSync(configDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to save when the file cannot be parsed, and leaves it unchanged', async () => {
    writeFileSync(config.CONFIG_FILE, '{not json');

    await expect(config.savePlatformUpdates('quantcdn', { activeOrganization: 'x' })).rejects.toThrow();

    expect(readFileSync(config.CONFIG_FILE, 'utf-8')).toBe('{not json');
  });

  it('migrates an old single-platform file under the lock', async () => {
    writeFileSync(config.CONFIG_FILE, JSON.stringify({ token: 'old', host: 'https://dashboard.quantcdn.io' }));

    const multi = await config.loadMultiPlatformConfig();

    expect(multi.activePlatform).toBe('quantcdn');
    expect(JSON.parse(readFileSync(config.CONFIG_FILE, 'utf-8')).platforms.quantcdn.token).toBe('old');
    expect(readdirSync(configDir)).toEqual(['credentials']);
  });

  it('logout removes the file under the lock', async () => {
    writeFileSync(config.CONFIG_FILE, twoPlatforms());
    await config.clearAuthConfig();
    expect(readdirSync(configDir)).toEqual([]);
  });
});
