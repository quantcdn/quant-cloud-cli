#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { orgCommand } from './commands/org.js';
import { appCommand } from './commands/app.js';
import { projectCommand } from './commands/project.js';
import { envCommand } from './commands/env.js';
import { sshCommand } from './commands/ssh.js';
import { platformCommand } from './commands/platform.js';
import { backupCommand } from './commands/backup.js';
import { vrtCommand } from './commands/vrt.js';
import { getActivePlatformConfig } from './utils/config.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

// Display full banner with ASCII art
function displayBanner() {
  console.clear();
  const title = figlet.textSync('QUANT CLI', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default'
  });
  
  console.log(gradient(['#00ff88', '#0088ff', '#8800ff'])(title));
  console.log(chalk.cyan('Quant Cloud Platform CLI\n'));
}

// Display slim banner for subcommands
function displaySlimBanner() {
  const title = gradient(['#00ff88', '#0088ff', '#8800ff'])('█ QUANT CLI');
  console.log(title);
}

async function displayContext() {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      console.log(chalk.yellow('⚠ Not authenticated - run ') + chalk.cyan('qc login') + chalk.yellow(' to get started\n'));
      return;
    }

    console.log(chalk.gray('Current Context:'));
    console.log(chalk.gray('├─ User: ') + chalk.green(auth.email || 'Unknown'));
    
    if (auth.activeOrganization && auth.organizations) {
      const activeOrg = auth.organizations.find(o => o.machine_name === auth.activeOrganization);
      console.log(chalk.gray('├─ Organization: ') + chalk.cyan(activeOrg ? activeOrg.name : auth.activeOrganization));
    } else {
      console.log(chalk.gray('├─ Organization: ') + chalk.red('None selected'));
    }
    
    if (auth.activeApplication) {
      console.log(chalk.gray('├─ Application: ') + chalk.magenta(auth.activeApplication));
    } else {
      console.log(chalk.gray('├─ Application: ') + chalk.red('None selected'));
    }
    
    if (auth.activeEnvironment) {
      console.log(chalk.gray('└─ Environment: ') + chalk.yellow(auth.activeEnvironment));
    } else {
      console.log(chalk.gray('└─ Environment: ') + chalk.red('None selected'));
    }
    
    console.log(); // Empty line before help
  } catch (error) {
    // Silently fail if config can't be loaded
  }
}

async function main() {
  // Show full banner for main commands, slim banner for subcommands
  const args = process.argv.slice(2);
  const shouldShowFullBanner = args.length === 0 || 
                              args.includes('--help') || 
                              args.includes('-h') || 
                              args[0] === 'help' ||
                              args[0] === 'login';
                          
  if (shouldShowFullBanner) {
    displayBanner();
    await displayContext();
  } else {
    // Show slim banner for subcommands to maintain visual feedback
    displaySlimBanner();
  }

  program
    .name('quant-cloud')
    .description('CLI for Quant Cloud Platform')
    .version(version);

  // Register commands
      loginCommand(program);
      logoutCommand(program);
      whoamiCommand(program);
      orgCommand(program);
      appCommand(program);
      projectCommand(program);
      envCommand(program);
      platformCommand(program);
      program.addCommand(sshCommand);
      program.addCommand(backupCommand(program));
      vrtCommand(program);

  // Global error handling
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('❌ Unexpected error:'), error.message);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(chalk.red('❌ Unhandled rejection:'), reason);
    process.exit(1);
  });

  // Parse command line arguments
  await program.parseAsync(process.argv);

  // Show help if no command provided
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

main().catch((error) => {
  console.error(chalk.red('❌ CLI Error:'), error.message);
  process.exit(1);
});