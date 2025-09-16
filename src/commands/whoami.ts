import { Command } from 'commander';
import chalk from 'chalk';
import { getActivePlatformConfig } from '../utils/config.js';
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
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    // Check if token is expired
    if (auth.expiresAt && new Date() >= new Date(auth.expiresAt)) {
      logger.info('Token has expired. Run `quant-cloud login` to re-authenticate.');
      return;
    }
    
    logger.info('Authenticated');
    logger.info(`Email: ${chalk.cyan(auth.email || 'Unknown')}`);
    logger.info(`Host: ${chalk.cyan(auth.host)}`);
    logger.info(`Token: ${chalk.gray(auth.token.substring(0, 10) + '...')}`);
    
    if (auth.expiresAt) {
      const expiryDate = new Date(auth.expiresAt);
      const now = new Date();
      const timeLeft = Math.max(0, expiryDate.getTime() - now.getTime());
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      
      if (timeLeft > 0) {
        logger.info(`Expires in: ${chalk.green(`${hoursLeft}h ${minutesLeft}m`)}`);
      }
    }
    
    if (auth.organizations && auth.organizations.length > 0) {
      logger.info(`Organizations: ${chalk.cyan(auth.organizations.length.toString())}`);
      
      if (auth.activeOrganization) {
        const activeOrg = auth.organizations.find(o => o.machine_name === auth.activeOrganization);
        if (activeOrg) {
          logger.info(`Active organization: ${chalk.green(activeOrg.name)} (${chalk.gray(activeOrg.roles.map(r => r.display_name).join(', '))})`);
        }
      }
      
      if (auth.activeApplication) {
        logger.info(`Active application: ${chalk.cyan(auth.activeApplication)}`);
      }
      
      if (auth.activeEnvironment) {
        logger.info(`Active environment: ${chalk.magenta(auth.activeEnvironment)}`);
      }
      
      if (auth.organizations.length > 1) {
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org list')} ${chalk.gray('to see all organizations')}`);
      }
    }
    
  } catch (error) {
    logger.error('Failed to check authentication status:', error);
  }
}