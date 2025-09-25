import { Command } from 'commander';
import chalk from 'chalk';
import { getActivePlatformConfig } from '../utils/config.js';
import { resolveEffectiveContext } from '../utils/context.js';
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
    
    if (effectiveContext.expiresAt) {
      const expiryDate = new Date(effectiveContext.expiresAt);
      const now = new Date();
      const timeLeft = Math.max(0, expiryDate.getTime() - now.getTime());
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      
      if (timeLeft > 0) {
        logger.info(`Expires in: ${chalk.green(`${hoursLeft}h ${minutesLeft}m`)}`);
      }
    }
    
    if (effectiveContext.organizations && effectiveContext.organizations.length > 0) {
      logger.info(`Organizations: ${chalk.cyan(effectiveContext.organizations.length.toString())}`);
      
      if (effectiveContext.activeOrganization) {
        const activeOrg = effectiveContext.organizations.find(o => o.machine_name === effectiveContext.activeOrganization);
        if (activeOrg) {
          logger.info(`Active organization: ${chalk.green(activeOrg.name)} (${chalk.gray(activeOrg.roles.map((r: any) => r.display_name).join(', '))})`);
        }
      }
      
      if (effectiveContext.activeApplication) {
        logger.info(`Active application: ${chalk.cyan(effectiveContext.activeApplication)}`);
      }
      
      if (effectiveContext.activeEnvironment) {
        logger.info(`Active environment: ${chalk.magenta(effectiveContext.activeEnvironment)}`);
      }
      
      if (effectiveContext.organizations.length > 1) {
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org list')} ${chalk.gray('to see all organizations')}`);
      }
    }
    
  } catch (error: any) {
    if (error.message?.includes('Not authenticated')) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
    } else {
      logger.error('Failed to check authentication status:', error.message || String(error));
    }
  }
}