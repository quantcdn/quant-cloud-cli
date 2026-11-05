import { describe, it, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { forceRefresh, isRefreshDue, recovery, refreshIfDue, toAuthUpdates, REFRESH_WINDOW_MS } from '../../src/utils/token-refresh.js';
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
    Object.assign(recovery, { delayMs: 5, maxRetries: 2, windowMs: 240_000 });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('does not call the portal when no refresh is due', async () => {
    const auth = login(30 * DAY);
    expect(await refreshIfDue(auth, { save, reload, lockFile, location: 'creds' })).toBe(auth);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never refreshes a legacy login, even after a 401', async () => {
    const legacy: AuthConfig = { token: 'legacy', host: HOST };
    expect(await refreshIfDue(legacy, { save, reload, lockFile, location: 'creds' })).toBe(legacy);
    expect(await forceRefresh(legacy, { save, reload, lockFile, location: 'creds' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('exchanges the refresh token and saves the new pair', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'qc_new', refresh_token: 'qcr_new', expires_in: 90 * 86400, token_type: 'Bearer',
    }));

    const result = await refreshIfDue(login(DAY), { save, reload, lockFile, location: 'creds' });

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

    const result = await refreshIfDue(login(DAY), { save, reload, lockFile, location: 'creds' });

    expect(result.token).toBe('qc_peer');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('force-refreshes a token that is not yet due', async () => {
    reload.mockResolvedValue(login(60 * DAY));
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'qc_new', refresh_token: 'qcr_new', expires_in: 60, token_type: 'Bearer' }));

    const result = await forceRefresh(login(60 * DAY), { save, reload, lockFile, location: 'creds' });

    expect(result?.token).toBe('qc_new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored login when the refresh fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const auth = login(DAY);
    reload.mockResolvedValue(auth);

    expect(await refreshIfDue(auth, { save, reload, lockFile, location: 'creds' })).toBe(auth);
    expect(save).not.toHaveBeenCalled();
  });

  describe('unknown outcome recovery', () => {
    const ok = (n: string) => jsonResponse(200, { access_token: `qc_${n}`, refresh_token: `qcr_${n}`, expires_in: 60, token_type: 'Bearer' });
    const sentTokens = () => fetchMock.mock.calls.map((c: any[]) => new URLSearchParams(c[1].body).get('refresh_token'));

    it('retries once with the same refresh token after a timeout, and saves the recovered pair', async () => {
      fetchMock
        .mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
        .mockResolvedValueOnce(ok('recovered'));

      const result = await refreshIfDue(login(DAY, { refreshToken: 'qcr_t1' }), { save, reload: async () => login(DAY, { refreshToken: 'qcr_t1' }), lockFile, location: 'creds' });

      expect(result.token).toBe('qc_recovered');
      expect(sentTokens()).toEqual(['qcr_t1', 'qcr_t1']);
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ token: 'qc_recovered', refreshToken: 'qcr_recovered' }));
    });

    it('retries once after a 5xx', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(503, {})).mockResolvedValueOnce(ok('after5xx'));

      const result = await refreshIfDue(login(DAY), { save, reload, lockFile, location: 'creds' });

      expect(result.token).toBe('qc_after5xx');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries once after an unreadable 200, and keeps the login when the retry is refused', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
        .mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant', error_description: 'not found' }));
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const auth = login(DAY, { refreshToken: 'qcr_unreadable' });

      const result = await refreshIfDue(auth, { save, reload: async () => auth, lockFile, location: 'creds' });

      expect(result).toBe(auth);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(save).not.toHaveBeenCalled();
    });

    it('sends at most two retries', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));
      const auth = login(DAY, { refreshToken: 'qcr_three' });

      expect(await refreshIfDue(auth, { save, reload: async () => auth, lockFile, location: 'creds' })).toBe(auth);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(save).not.toHaveBeenCalled();
    });

    it('sends no retry after the window since the first send has passed', async () => {
      Object.assign(recovery, { delayMs: 100, windowMs: 150 });
      fetchMock.mockResolvedValue(jsonResponse(503, {}));
      const auth = login(DAY, { refreshToken: 'qcr_window' });

      await refreshIfDue(auth, { save, reload: async () => auth, lockFile, location: 'creds' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('skips the retry when the stored token changed during the wait', async () => {
      fetchMock.mockResolvedValue(jsonResponse(502, {}));
      const auth = login(DAY, { refreshToken: 'qcr_changed' });
      const stored = [auth, login(90 * DAY, { token: 'qc_other', refreshToken: 'qcr_other' })];
      const reloadSeq = jest.fn<(...args: any[]) => any>()
        .mockResolvedValueOnce(stored[0])
        .mockResolvedValue(stored[1]);

      const result = await refreshIfDue(auth, { save, reload: reloadSeq, lockFile, location: 'creds' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.token).toBe('qc_other');
      expect(result.refreshToken).toBe('qcr_other');
    });

    it('treats "just rotated" as unknown: no warning, not refused, and the retry recovers', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const auth = login(DAY, { refreshToken: 'qcr_just' });
      const justRotated = () => jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'Refresh token was just rotated; reload your stored tokens.',
      });
      fetchMock.mockResolvedValueOnce(justRotated()).mockResolvedValueOnce(ok('recovered2'));

      const result = await refreshIfDue(auth, { save, reload: async () => auth, lockFile, location: 'creds' });

      expect(result.token).toBe('qc_recovered2');
      expect(sentTokens()).toEqual(['qcr_just', 'qcr_just']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not mark a "just rotated" token as refused', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const auth = login(DAY, { refreshToken: 'qcr_just2' });
      fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant', error_description: 'Refresh token was just rotated' }));
      const store = { save, reload: async () => auth, lockFile, location: 'creds' };

      await refreshIfDue(auth, store);
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(ok('later'));
      const later = await refreshIfDue(auth, store);

      expect(later.token).toBe('qc_later');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not retry after a definite 4xx', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const auth = login(DAY, { refreshToken: 'qcr_definite' });

      await refreshIfDue(auth, { save, reload: async () => auth, lockFile, location: 'creds' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('waits the recovery delay after the previous attempt ended', async () => {
      recovery.delayMs = 100;
      const starts: number[] = [];
      const ends: number[] = [];
      fetchMock.mockImplementation(async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 60));
        ends.push(Date.now());
        return starts.length < 3 ? jsonResponse(504, {}) : ok('late');
      });

      const result = await refreshIfDue(login(DAY), { save, reload, lockFile, location: 'creds' });

      expect(result.token).toBe('qc_late');
      expect(starts).toHaveLength(3);
      expect(starts[1] - ends[0]).toBeGreaterThanOrEqual(95);
      expect(starts[2] - ends[1]).toBeGreaterThanOrEqual(95);
    });
  });
});
