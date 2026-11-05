import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { forceRefresh, isRefreshDue, refreshIfDue, toAuthUpdates, REFRESH_WINDOW_MS } from '../../src/utils/token-refresh.js';
import type { AuthConfig } from '../../src/types/auth.js';

const DAY = 24 * 60 * 60 * 1000;
const dir = mkdtempSync(join(tmpdir(), 'qc-refresh-unit-'));
const lockFile = join(dir, 'credentials.lock');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const HOST = 'https://dashboard.quantcdn.io';

const login = (msFromNow: number, extra: Partial<AuthConfig> = {}): AuthConfig => ({
  token: 'qc_old',
  refreshToken: 'qcr_old',
  expiresAt: new Date(Date.now() + msFromNow).toISOString(),
  host: HOST,
  ...extra,
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('isRefreshDue', () => {
  it('never refreshes a legacy login without refresh token or expiry', () => {
    expect(isRefreshDue({ token: 't', host: HOST })).toBe(false);
    expect(isRefreshDue({ token: 't', host: HOST, refreshToken: 'r' })).toBe(false);
    expect(isRefreshDue({ token: 't', host: HOST, expiresAt: new Date().toISOString() })).toBe(false);
  });

  it('refreshes inside the window and after expiry, not before', () => {
    expect(isRefreshDue(login(30 * DAY))).toBe(false);
    expect(isRefreshDue(login(REFRESH_WINDOW_MS - DAY))).toBe(true);
    expect(isRefreshDue(login(-DAY))).toBe(true);
  });
});

describe('toAuthUpdates', () => {
  it('maps the token response and leaves expiry unset without expires_in', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(toAuthUpdates({ access_token: 'a', refresh_token: 'r', expires_in: 60, token_type: 'Bearer' }, now))
      .toEqual({ token: 'a', refreshToken: 'r', expiresAt: new Date(now + 60000).toISOString() });
    expect(toAuthUpdates({ access_token: 'a', token_type: 'Bearer' }, now).expiresAt).toBeUndefined();
  });

  it('leaves refreshToken out when the response has no refresh_token, so the stored one is kept', () => {
    const updates = toAuthUpdates({ access_token: 'a', expires_in: 60, token_type: 'Bearer' });
    expect('refreshToken' in updates).toBe(false);
    expect({ ...login(DAY), ...updates }.refreshToken).toBe('qcr_old');
  });
});

describe('refreshIfDue', () => {
  const fetchMock = jest.fn<(...args: any[]) => any>();
  const save = jest.fn<(...args: any[]) => any>();
  const reload = jest.fn<(...args: any[]) => any>();
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
    save.mockResolvedValue(undefined);
    reload.mockImplementation(async () => login(DAY));
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('does not call the portal when no refresh is due', async () => {
    const auth = login(30 * DAY);
    expect(await refreshIfDue(auth, { save, reload, lockFile })).toBe(auth);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never refreshes a legacy login, even after a 401', async () => {
    const legacy: AuthConfig = { token: 'legacy', host: HOST };
    expect(await refreshIfDue(legacy, { save, reload, lockFile })).toBe(legacy);
    expect(await forceRefresh(legacy, { save, reload, lockFile })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('exchanges the refresh token and saves the new pair', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'qc_new', refresh_token: 'qcr_new', expires_in: 90 * 86400, token_type: 'Bearer',
    }));

    const result = await refreshIfDue(login(DAY), { save, reload, lockFile });

    expect(result.token).toBe('qc_new');
    expect(result.refreshToken).toBe('qcr_new');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ token: 'qc_new', refreshToken: 'qcr_new' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe(`${HOST}/oauth/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_id')).toBe('quant-cli');
    expect(body.get('refresh_token')).toBe('qcr_old');
  });

  it('uses the credentials another process saved, and sends no request', async () => {
    reload.mockResolvedValue(login(90 * DAY, { token: 'qc_peer', refreshToken: 'qcr_peer' }));

    const result = await refreshIfDue(login(DAY), { save, reload, lockFile });

    expect(result.token).toBe('qc_peer');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('force-refreshes a token that is not yet due', async () => {
    reload.mockResolvedValue(login(60 * DAY));
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'qc_new', refresh_token: 'qcr_new', expires_in: 60, token_type: 'Bearer' }));

    const result = await forceRefresh(login(60 * DAY), { save, reload, lockFile });

    expect(result?.token).toBe('qc_new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored login when the refresh fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const auth = login(DAY);
    reload.mockResolvedValue(auth);

    expect(await refreshIfDue(auth, { save, reload, lockFile })).toBe(auth);
    expect(save).not.toHaveBeenCalled();
  });
});
