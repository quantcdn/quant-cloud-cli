import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals';

const mockLoadMulti = jest.fn<(...args: any[]) => any>();
const mockGetProjectConfig = jest.fn<(...args: any[]) => any>();

jest.unstable_mockModule('../../src/utils/config.js', () => ({
  loadMultiPlatformConfig: mockLoadMulti,
  getActivePlatformConfig: async () => {
    const m = await mockLoadMulti();
    const { platformInfo, ...auth } = m.platforms[m.activePlatform];
    return auth;
  },
}));
jest.unstable_mockModule('../../src/utils/project-config.js', () => ({
  getProjectConfig: mockGetProjectConfig,
}));

let resolveEffectiveContext: typeof import('../../src/utils/context.js').resolveEffectiveContext;

beforeAll(async () => {
  ({ resolveEffectiveContext } = await import('../../src/utils/context.js'));
});

const info = (id: string) => ({ id, name: id, description: id });
const multi = () => ({
  activePlatform: 'quantcdn',
  platforms: {
    quantcdn: { token: 'tok-cdn', host: 'https://dashboard.quantcdn.io', platformInfo: info('quantcdn') },
    quantgov: { token: 'tok-gov', host: 'https://dash.quantgov.cloud', platformInfo: info('quantgov') },
  },
});

describe('resolveEffectiveContext platform selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadMulti.mockResolvedValue(multi());
    mockGetProjectConfig.mockReturnValue({});
  });

  it('uses the active platform when no flag or .quant.yml platform is set', async () => {
    const ctx = await resolveEffectiveContext({});
    expect(ctx.token).toBe('tok-cdn');
    expect(ctx.host).toBe('https://dashboard.quantcdn.io');
  });

  it('uses the --platform flag credentials', async () => {
    const ctx = await resolveEffectiveContext({ platform: 'quantgov' });
    expect(ctx.token).toBe('tok-gov');
    expect(ctx.host).toBe('https://dash.quantgov.cloud');
  });

  it('uses the .quant.yml platform when no flag is set', async () => {
    mockGetProjectConfig.mockReturnValue({ platform: 'quantgov' });
    const ctx = await resolveEffectiveContext({});
    expect(ctx.token).toBe('tok-gov');
  });

  it('prefers the flag over .quant.yml', async () => {
    mockGetProjectConfig.mockReturnValue({ platform: 'quantgov' });
    const ctx = await resolveEffectiveContext({ platform: 'quantcdn' });
    expect(ctx.token).toBe('tok-cdn');
  });

  it('fails with a clear error for a platform with no stored login', async () => {
    await expect(resolveEffectiveContext({ platform: 'custom' })).rejects.toThrow(
      'Not logged in to platform custom. Run qc login and choose custom, or qc platform list.'
    );
  });

  it('does not save or change the active platform', async () => {
    await resolveEffectiveContext({ platform: 'quantgov' });
    expect(mockLoadMulti).toHaveBeenCalled();
    // only loadMultiPlatformConfig is mocked: any save/switch call would throw
  });
});
