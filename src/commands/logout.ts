import { Command } from 'commander';
import inquirer from 'inquirer';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { CONFIG_FILE } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Logout');

export function logoutCommand(program: Command) {
  program
    .command('logout')
    .description('Sign out and remove stored credentials')
    .action(async () => {
      await handleLogout();
    });
}

async function handleLogout() {
  try {
    // Check if credentials file exists
    if (!existsSync(CONFIG_FILE)) {
      logger.info('Not currently logged in.');
      return;
    }

    // Confirm logout
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Are you sure you want to logout?',
        default: false
      }
    ]);

    if (!confirmed) {
      logger.info('Logout cancelled.');
      return;
    }

    // Remove credentials file
    await unlink(CONFIG_FILE);
    
    logger.info(`${chalk.green('✓')} Successfully logged out`);
    logger.info('Run `quant-cloud login` to authenticate again');

  } catch (error: any) {
    logger.error('Failed to logout:', error instanceof Error ? error.message : String(error));
  }
}