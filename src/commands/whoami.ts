import { Command } from 'commander';
import chalk from 'chalk';
import { resolveEffectiveContext, EffectiveContext } from '../utils/context.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('WhoAmI');

export function whoamiCommand(program: Command) {
  program
    .command('whoami')
    .description('Display current user information')
    .action(async () => {
      await handleWhoAmI();
    });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "12 days" when more than 48 hours are left, "5h 20m" when less, "expired" when none. */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) {
    return 'expired';
  }
  if (ms > 48 * HOUR_MS) {
    return `${Math.floor(ms / DAY_MS)} days`;
  }
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}

function printExpiry(expiresAt?: string): void {
  if (!expiresAt) {
    return;
  }
  const timeLeft = new Date(expiresAt).getTime() - Date.now();
  if (timeLeft <= 0) {
    logger.info(`Expires in: ${chalk.red(formatTimeLeft(timeLeft))}`);
    return;
  }
  logger.info(`Expires in: ${chalk.green(formatTimeLeft(timeLeft))}`);
}

function printActiveOrganization(ctx: EffectiveContext, organizations: NonNullable<EffectiveContext['organizations']>): void {
  const activeOrg = ctx.activeOrganization && organizations.find(o => o.machine_name === ctx.activeOrganization);
  if (activeOrg) {
    logger.info(`Active organization: ${chalk.green(activeOrg.name)} (${chalk.gray(activeOrg.roles.map((r: any) => r.display_name).join(', '))})`);
  }
}

function printContext(ctx: EffectiveContext): void {
  const organizations = ctx.organizations ?? [];
  if (organizations.length === 0) {
    return;
  }
  logger.info(`Organizations: ${chalk.cyan(organizations.length.toString())}`);
  printActiveOrganization(ctx, organizations);
  if (ctx.activeApplication) {
    logger.info(`Active application: ${chalk.cyan(ctx.activeApplication)}`);
  }
  if (ctx.activeEnvironment) {
    logger.info(`Active environment: ${chalk.magenta(ctx.activeEnvironment)}`);
  }
  if (organizations.length > 1) {
    logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org list')} ${chalk.gray('to see all organizations')}`);
  }
}

async function handleWhoAmI() {
  try {
    // Get effective context (includes .quant.yml overrides)
    const effectiveContext = await resolveEffectiveContext();
    
    // Check if token is expired
    if (effectiveContext.expiresAt && new Date() >= new Date(effectiveContext.expiresAt)) {
      logger.info('Token has expired. Run `quant-cloud login` to re-authenticate.');
      return;
    }
    
    logger.info('Authenticated');
    logger.info(`Email: ${chalk.cyan(effectiveContext.email || 'Unknown')}`);
    logger.info(`Host: ${chalk.cyan(effectiveContext.host)}`);
    logger.info(`Token: ${chalk.gray(effectiveContext.token.substring(0, 10) + '...')}`);
    
    printExpiry(effectiveContext.expiresAt);
    printContext(effectiveContext);
  } catch (error: any) {
    if (error.message?.includes('Not authenticated')) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
    } else {
      logger.error('Failed to check authentication status:', error.message || String(error));
    }
  }
}