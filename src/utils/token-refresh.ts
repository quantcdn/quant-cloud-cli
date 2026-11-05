import type { AuthConfig, LoginResponse } from '../types/auth.js';
import { HeldLock, withFileLock } from './file-lock.js';
import { Logger } from './logger.js';

const logger = new Logger('Auth');

const CLIENT_ID = 'quant-cli';

/** Refresh when the access token has this much life or less left. */
export const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The portal can stall for a long time, and it commits a rotation even when the
 * client has gone, so qc waits long for the answer. The timeout must stay below
 * LOCK_STALE_MS, or a waiting process takes the lock and sends the same refresh
 * token, which revokes the chain.
 */
export const REFRESH_TIMEOUT_MS = 60_000;

/** After this long, qc tells the user that it is still renewing the login. */
const SLOW_NOTICE_MS = 5_000;

/** Refresh tokens the portal refused in this process. They are not sent again. */
const rejectedTokens = new Set<string>();

/** Where refreshed credentials go, and how to read what another qc process saved. */
export interface RefreshStore {
  /** Saves the refreshed tokens. Called while the lock is held. */
  save(updates: Partial<AuthConfig>): Promise<void>;
  /** Reads the stored login again. */
  reload(): Promise<AuthConfig | null>;
  /** The lock file that every qc process holds while it refreshes or saves. */
  lockFile: string;
  /** The credentials file, for messages. */
  location: string;
}

/** The portal refused the refresh token (HTTP 400 invalid_grant or invalid_client). */
export class TokenRefreshError extends Error {
  constructor(public readonly code: string, description?: string) {
    super(description || code);
    this.name = 'TokenRefreshError';
  }
}

/**
 * True when the stored login can and should be refreshed. Legacy logins have no
 * refresh token or expiry and are never refreshed.
 */
export function isRefreshDue(auth: AuthConfig, now: number = Date.now()): boolean {
  if (!auth.refreshToken || !auth.expiresAt) {
    return false;
  }
  const expiry = Date.parse(auth.expiresAt);
  return Number.isNaN(expiry) || expiry - now <= REFRESH_WINDOW_MS;
}

/**
 * The credential fields to store from an /oauth/token response. A response
 * without refresh_token keeps the stored refresh token: the key is left out.
 */
export function toAuthUpdates(body: LoginResponse, now: number = Date.now()): Partial<AuthConfig> {
  const updates: Partial<AuthConfig> = {
    token: body.access_token,
    expiresAt: typeof body.expires_in === 'number'
      ? new Date(now + body.expires_in * 1000).toISOString()
      : undefined,
  };
  if (body.refresh_token) {
    updates.refreshToken = body.refresh_token;
  }
  return updates;
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
}

function refreshFailure(status: number, body: TokenErrorBody): Error {
  if (body.error) {
    return new TokenRefreshError(body.error, body.error_description);
  }
  return new Error(`HTTP ${status}`);
}

/** Prints a note on stderr when the refresh takes longer than SLOW_NOTICE_MS. Returns a function that cancels it. */
function noticeIfSlow(): () => void {
  const timer = setTimeout(() => process.stderr.write('Renewing Quant login…\n'), SLOW_NOTICE_MS);
  timer.unref?.();
  return () => clearTimeout(timer);
}

async function requestRefresh(auth: AuthConfig): Promise<Partial<AuthConfig>> {
  const cancelNotice = noticeIfSlow();
  try {
    return await sendRefresh(auth);
  } finally {
    cancelNotice();
  }
}

async function sendRefresh(auth: AuthConfig): Promise<Partial<AuthConfig>> {
  const refreshToken = auth.refreshToken as string;
  if (rejectedTokens.has(refreshToken)) {
    throw new TokenRefreshError('invalid_grant', 'Refresh token was refused earlier');
  }
  const response = await fetch(new URL('/oauth/token', auth.host).toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });

  const body = await response.json().catch(() => ({})) as Partial<LoginResponse> & TokenErrorBody;
  if (!response.ok || typeof body.access_token !== 'string') {
    const failure = refreshFailure(response.status, body);
    if (failure instanceof TokenRefreshError) {
      rejectedTokens.add(refreshToken);
    }
    throw failure;
  }
  return toAuthUpdates(body as LoginResponse);
}

/**
 * Refreshes under the lock. The stored credentials are read again first: when
 * another qc process already rotated the token, its result is used and no
 * request is sent, so one refresh token is never sent twice.
 */
async function refreshLocked(
  auth: AuthConfig,
  store: RefreshStore,
  shouldRefresh: (latest: AuthConfig) => boolean,
): Promise<AuthConfig> {
  return withFileLock(store.lockFile, async (lock: HeldLock) => {
    const latest = await store.reload();
    if (!latest || latest.token !== auth.token || !shouldRefresh(latest)) {
      return latest ?? auth;
    }
    await lock.verify();
    const updates = await requestRefresh(latest);
    await saveRotation(store, updates);
    logger.debug('Access token refreshed');
    return { ...latest, ...updates };
  });
}

/**
 * Saves a rotated pair, with one retry. The portal has already rotated, so the
 * new pair is used for this command even when it cannot be saved.
 */
async function saveRotation(store: RefreshStore, updates: Partial<AuthConfig>): Promise<void> {
  try {
    await store.save(updates);
  } catch {
    try {
      await store.save(updates);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Could not save the refreshed login to ${store.location} (${reason}): run \`qc login\` if later commands fail.`);
    }
  }
}

let warnedRejected = false;

function reportFailure(auth: AuthConfig, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof TokenRefreshError) {
    if (warnedRejected) {
      return;
    }
    warnedRejected = true;
    logger.warn(`Your Quant login could not be renewed (${reason}). Run \`qc login\` to sign in again.`);
    return;
  }
  logger.debug(`Token refresh failed: ${reason}`);
  if (auth.expiresAt && Date.parse(auth.expiresAt) <= Date.now()) {
    logger.warn(`Your Quant login expired and could not be renewed (${reason}). Run \`qc login\` to sign in again.`);
  }
}

/**
 * Returns the login to use for this command. When the access token is close to
 * expiry, it is exchanged for a new pair, which is saved. On failure the stored
 * login is returned unchanged: it is still valid if it has not expired.
 */
export async function refreshIfDue(auth: AuthConfig, store: RefreshStore): Promise<AuthConfig> {
  if (!isRefreshDue(auth)) {
    return auth;
  }
  try {
    return await refreshLocked(auth, store, (latest) => isRefreshDue(latest));
  } catch (error) {
    reportFailure(auth, error);
    return auth;
  }
}

/**
 * Refreshes after the portal rejected auth.token with 401, even when the token
 * is not yet due. Returns the new login, or null when no new token is available.
 */
export async function forceRefresh(auth: AuthConfig, store: RefreshStore): Promise<AuthConfig | null> {
  if (!auth.refreshToken) {
    return null;
  }
  try {
    const renewed = await refreshLocked(auth, store, (latest) => Boolean(latest.refreshToken));
    return renewed.token !== auth.token ? renewed : null;
  } catch (error) {
    reportFailure(auth, error);
    return null;
  }
}
