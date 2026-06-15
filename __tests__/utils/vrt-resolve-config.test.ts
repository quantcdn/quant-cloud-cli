import { describe, it, expect, jest } from '@jest/globals';
import { resolve } from 'path';
import {
  resolveVRTConfig,
  loadVRTConfig,
  loadVRTConfigFrom,
  VRTConfig
} from '../../src/utils/config.js';

const sampleConfig: VRTConfig = {
  projects: { 'my-project': 'https://example.com' }
};

const mockDefault = () => jest.fn<typeof loadVRTConfig>();
const mockFrom = () => jest.fn<typeof loadVRTConfigFrom>();

describe('resolveVRTConfig', () => {
  it('loads from the default loader when no --config path is given', async () => {
    const loadDefault = mockDefault().mockResolvedValue(sampleConfig);
    const loadFrom = mockFrom().mockResolvedValue(null);

    const result = await resolveVRTConfig(undefined, { loadDefault, loadFrom });

    expect(loadDefault).toHaveBeenCalledTimes(1);
    expect(loadFrom).not.toHaveBeenCalled();
    expect(result.config).toEqual(sampleConfig);
    expect(result.explicitPath).toBeUndefined();
  });

  it('loads from the explicit path, resolved against cwd', async () => {
    const loadDefault = mockDefault().mockResolvedValue(null);
    const loadFrom = mockFrom().mockResolvedValue(sampleConfig);

    const result = await resolveVRTConfig(
      './vrt-config.json',
      { loadDefault, loadFrom },
      '/home/user/work'
    );

    const expectedPath = resolve('/home/user/work', './vrt-config.json');
    expect(loadDefault).not.toHaveBeenCalled();
    expect(loadFrom).toHaveBeenCalledWith(expectedPath);
    expect(result.config).toEqual(sampleConfig);
    expect(result.explicitPath).toBe(expectedPath);
  });

  it('leaves an absolute --config path unchanged', async () => {
    const loadFrom = mockFrom().mockResolvedValue(sampleConfig);

    const result = await resolveVRTConfig(
      '/etc/quant/vrt.json',
      { loadDefault: mockDefault().mockResolvedValue(null), loadFrom },
      '/home/user/work'
    );

    expect(loadFrom).toHaveBeenCalledWith('/etc/quant/vrt.json');
    expect(result.explicitPath).toBe('/etc/quant/vrt.json');
  });

  it('surfaces a null config (with the resolved path) when the explicit file is unreadable', async () => {
    const loadFrom = mockFrom().mockResolvedValue(null);

    const result = await resolveVRTConfig(
      'missing.json',
      { loadDefault: mockDefault().mockResolvedValue(sampleConfig), loadFrom },
      '/tmp'
    );

    // Must NOT fall back to the default config.
    expect(result.config).toBeNull();
    expect(result.explicitPath).toBe(resolve('/tmp', 'missing.json'));
  });
});
