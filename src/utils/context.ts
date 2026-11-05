import { applyPlatformUpdates, CREDENTIALS_LOCK_FILE, loadMultiPlatformConfig, saveActivePlatformConfig, savePlatformUpdates } from './config.js';
import type { AuthConfig } from '../types/auth.js';
import { getProjectConfig, ProjectConfig } from './project-config.js';
import { Logger } from './logger.js';
import { forceRefresh, refreshIfDue, RefreshStore } from './token-refresh.js';

const logger = new Logger('Context');

export interface ContextOverrides {
  platform?: string;
  org?: string;
  app?: string;
  env?: string;
}

export interface EffectiveContext {
  token: string;
  host: string;
  email?: string;
  expiresAt?: string;
  activeOrganization?: string;
  activeApplication?: string;
  activeEnvironment?: string;
  organizations?: any[];
  /** Present only for logins with a refresh token. See tokenRenewer(). */
  renewToken?: TokenRenewer;
}

/**
 * Called after the portal answers 401 for sentToken. Returns a new access token,
 * or null when the login cannot be renewed.
 */
export type TokenRenewer = (sentToken: string) => Promise<string | null>;

/** The stored login for a platform, or null when there is none. */
async function loadStoredAuth(platformId: string): Promise<AuthConfig | null> {
  const multiConfig = await loadMultiPlatformConfig();
  const stored = multiConfig.platforms[platformId];
  if (!stored) {
    return null;
  }
  const { platformInfo, ...auth } = stored;
  return auth;
}

/**
 * Loads the stored credentials for a named platform without changing the persisted active platform.
 */
async function loadPlatformAuth(platformId: string): Promise<AuthConfig> {
  const auth = await loadStoredAuth(platformId);
  if (!auth || !auth.token) {
    throw new Error(`Not logged in to platform ${platformId}. Run qc login and choose ${platformId}, or qc platform list.`);
  }
  return auth;
}

/**
 * The refresh store for one platform. It is bound to the platform id, so a
 * refresh never writes to another platform, even if the active one changes.
 */
export function platformRefreshStore(platformId: string): RefreshStore {
  return {
    reload: () => loadStoredAuth(platformId),
    save: (updates) => applyPlatformUpdates(platformId, updates),
    lockFile: CREDENTIALS_LOCK_FILE,
  };
}

/** A TokenRenewer for this login, or undefined for a legacy login without a refresh token. */
export function tokenRenewer(auth: AuthConfig, platformId: string): TokenRenewer | undefined {
  if (!auth.refreshToken) {
    return undefined;
  }
  const store = platformRefreshStore(platformId);
  return async (sentToken) => {
    const renewed = await forceRefresh({ ...auth, token: sentToken }, store);
    return renewed?.token ?? null;
  };
}

function describe(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function logContextSources(overrides: ContextOverrides, projectConfig: ProjectConfig, ctx: EffectiveContext): void {
  const cli = describe({ org: overrides.org, app: overrides.app, env: overrides.env, platform: overrides.platform });
  const project = describe({ org: projectConfig.org, app: projectConfig.app, env: projectConfig.env, platform: projectConfig.platform });
  if (!cli && !project) {
    return;
  }
  const sources = [cli && `CLI: ${cli}`, project && `Project: ${project}`].filter(Boolean);
  logger.debug(`Context sources: ${sources.join('; ')}`);
  logger.debug(`Effective context: org=${ctx.activeOrganization}, app=${ctx.activeApplication}, env=${ctx.activeEnvironment}`);
}

/**
 * Returns the platform id requested by flag or .quant.yml, or undefined for the active platform.
 */
export function requestedPlatform(flag?: string): string | undefined {
  return flag || getProjectConfig().platform || undefined;
}

/**
 * Auth for the effective platform (flag > .quant.yml > active). Returns null if the
 * active platform has no login. Throws if a requested platform has no stored login.
 * Every command must use this instead of getActivePlatformConfig() so that host,
 * token and stored org/app context always come from the same platform.
 */
export async function getEffectiveAuth(platformFlag?: string): Promise<AuthConfig | null> {
  const effective = await loadEffectiveAuth(platformFlag);
  return effective ? effective.auth : null;
}

/** getEffectiveAuth, plus the id of the platform the login came from. */
async function loadEffectiveAuth(platformFlag?: string): Promise<{ platformId: string; auth: AuthConfig } | null> {
  const requested = requestedPlatform(platformFlag);
  const platformId = requested || (await loadMultiPlatformConfig()).activePlatform;
  if (!platformId) {
    return null;
  }
  const auth = requested ? await loadPlatformAuth(platformId) : await loadStoredAuth(platformId);
  if (!auth) {
    return null;
  }
  return { platformId, auth: await refreshIfDue(auth, platformRefreshStore(platformId)) };
}

/**
 * Persists context updates to the effective platform (never switches the active platform).
 */
export async function saveEffectiveConfig(updates: Partial<AuthConfig>, platformFlag?: string): Promise<void> {
  const id = requestedPlatform(platformFlag);
  if (id) {
    await savePlatformUpdates(id, updates);
    return;
  }
  await saveActivePlatformConfig(updates);
}

/**
 * Resolves the effective context by merging command-line overrides, project config, and stored context
 * Priority: CLI flags > .quant.yml > stored config
 */
export async function resolveEffectiveContext(overrides: ContextOverrides = {}): Promise<EffectiveContext> {
  // Get project config from .quant.yml file
  const projectConfig = getProjectConfig();

  // Platform priority: CLI flag > .quant.yml > active platform. Never persisted.
  const effective = await loadEffectiveAuth(overrides.platform);
  if (!effective || !effective.auth.token) {
    throw new Error('Not authenticated. Run `quant-cloud login` to authenticate.');
  }
  const { auth, platformId } = effective;

  // Apply in priority order: CLI flags > project config > stored config
  const effectiveContext: EffectiveContext = {
    token: auth.token,
    host: auth.host,
    email: auth.email,
    expiresAt: auth.expiresAt,
    organizations: auth.organizations,
    activeOrganization: overrides.org || projectConfig.org || auth.activeOrganization,
    activeApplication: overrides.app || projectConfig.app || auth.activeApplication,
    activeEnvironment: overrides.env || projectConfig.env || auth.activeEnvironment,
    renewToken: tokenRenewer(auth, platformId),
  };

  logContextSources(overrides, projectConfig, effectiveContext);

  return effectiveContext;
}

/**
 * Validates that the required context is available
 */
export function validateContext(
  context: EffectiveContext,
  required: { org?: boolean; app?: boolean; env?: boolean } = {}
): void {
  if (required.org && !context.activeOrganization) {
    throw new Error('No organization specified. Use --org or set active organization with `qc org select`.');
  }
  
  if (required.app && !context.activeApplication) {
    throw new Error('No application specified. Use --app or set active application with `qc app select`.');
  }
  
  if (required.env && !context.activeEnvironment) {
    throw new Error('No environment specified. Use --env or set active environment with `qc env select`.');
  }
}