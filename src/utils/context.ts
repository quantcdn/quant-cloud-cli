import { getActivePlatformConfig } from './config.js';
import { getProjectConfig } from './project-config.js';
import { Logger } from './logger.js';

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
}

/**
 * Resolves the effective context by merging command-line overrides, project config, and stored context
 * Priority: CLI flags > .quant.yml > stored config
 */
export async function resolveEffectiveContext(overrides: ContextOverrides = {}): Promise<EffectiveContext> {
  // Get the stored context (this handles platform switching if needed)
  const auth = await getActivePlatformConfig();
  
  if (!auth || !auth.token) {
    throw new Error('Not authenticated. Run `quant-cloud login` to authenticate.');
  }

  // Get project config from .quant.yml file
  const projectConfig = getProjectConfig();

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
  };

  // Log context sources for debugging
  const hasOverrides = overrides.org || overrides.app || overrides.env || overrides.platform;
  const hasProjectConfig = Object.keys(projectConfig).length > 0;
  
  if (hasOverrides || hasProjectConfig) {
    const sources = [];
    
    if (hasOverrides) {
      const overrideDetails = [
        overrides.org && `org=${overrides.org}`,
        overrides.app && `app=${overrides.app}`,
        overrides.env && `env=${overrides.env}`,
        overrides.platform && `platform=${overrides.platform}`
      ].filter(Boolean).join(', ');
      sources.push(`CLI: ${overrideDetails}`);
    }
    
    if (hasProjectConfig) {
      const projectDetails = [
        projectConfig.org && `org=${projectConfig.org}`,
        projectConfig.app && `app=${projectConfig.app}`,
        projectConfig.env && `env=${projectConfig.env}`,
        projectConfig.platform && `platform=${projectConfig.platform}`
      ].filter(Boolean).join(', ');
      sources.push(`Project: ${projectDetails}`);
    }
    
    logger.debug(`Context sources: ${sources.join('; ')}`);
    logger.debug(`Effective context: org=${effectiveContext.activeOrganization}, app=${effectiveContext.activeApplication}, env=${effectiveContext.activeEnvironment}`);
  }

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