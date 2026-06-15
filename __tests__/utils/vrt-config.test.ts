import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadVRTConfigFrom, VRTConfig } from '../../src/utils/config.js';

describe('loadVRTConfigFrom', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'qc-vrt-config-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns the parsed config for a valid file', async () => {
    const expected: VRTConfig = {
      projects: { 'my-project': 'https://example.com' },
      threshold: 0.05,
      maxPages: 20
    };
    const path = join(tempDir, 'valid.json');
    await fs.writeFile(path, JSON.stringify(expected), 'utf-8');

    const config = await loadVRTConfigFrom(path);

    expect(config).toEqual(expected);
  });

  it('returns null when the file does not exist', async () => {
    const config = await loadVRTConfigFrom(join(tempDir, 'does-not-exist.json'));

    expect(config).toBeNull();
  });

  it('returns null when the file contains invalid JSON', async () => {
    const path = join(tempDir, 'invalid.json');
    await fs.writeFile(path, '{ not valid json', 'utf-8');

    const config = await loadVRTConfigFrom(path);

    expect(config).toBeNull();
  });
});
