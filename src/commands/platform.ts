import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { listPlatforms, switchPlatform, getActivePlatformConfig, removePlatform } from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';

export function platformCommand(program: Command) {
  const platform = program
    .command('platform')
    .description('Manage multiple platform connections')
    .alias('plat');

  platform
    .command('list')
    .description('List all authenticated platforms')
    .action(async () => {
      await handlePlatformList();
    });

  platform
    .command('switch')
    .description('Switch between authenticated platforms')
    .action(async () => {
      await handlePlatformSwitch();
    });

  platform
    .command('current')
    .description('Show currently active platform')
    .action(async () => {
      await handlePlatformCurrent();
    });

  platform
    .command('remove')
    .description('Remove a platform authentication')
    .action(async () => {
      await handlePlatformRemove();
    });
}

async function handlePlatformList() {
  const spinner = createSpinner('Loading platforms...');
  
  try {
    const platforms = await listPlatforms();
    spinner.stop();
    
    if (platforms.length === 0) {
      console.log(chalk.yellow('No authenticated platforms found.'));
      console.log(chalk.gray('Use "qc login" to authenticate with a platform.'));
      return;
    }
    
    console.log(chalk.bold('Authenticated Platforms:'));
    console.log();
    
    platforms.forEach(({ id, info, isActive }) => {
      const activeIndicator = isActive ? chalk.green('●') : chalk.gray('○');
      const status = isActive ? chalk.green('[ACTIVE]') : chalk.gray('[inactive]');
      
      console.log(`${activeIndicator} ${chalk.cyan(info.name)} ${status}`);
      console.log(`   ${chalk.gray('ID:')} ${id}`);
      console.log(`   ${chalk.gray('Host:')} ${info.host}`);
      if (info.description && info.description !== info.host) {
        console.log(`   ${chalk.gray('Description:')} ${info.description}`);
      }
      console.log();
    });
    
    if (!platforms.some(p => p.isActive)) {
      console.log(chalk.yellow('⚠ No active platform set. Use "qc platform switch" to activate one.'));
    }
  } catch (error) {
    spinner.fail('Failed to load platforms');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }
}

async function handlePlatformSwitch() {
  const spinner = createSpinner('Loading platforms...');
  
  try {
    const platforms = await listPlatforms();
    spinner.stop();
    
    if (platforms.length === 0) {
      console.log(chalk.yellow('No authenticated platforms found.'));
      console.log(chalk.gray('Use "qc login" to authenticate with a platform.'));
      return;
    }
    
    if (platforms.length === 1) {
      const platform = platforms[0];
      if (platform.isActive) {
        console.log(chalk.green(`Already using ${platform.info.name} (${platform.info.host})`));
        return;
      }
    }
    
    const choices = platforms.map(({ id, info, isActive }) => ({
      name: `${info.name} ${chalk.gray(`(${info.host})`)} ${isActive ? chalk.green('[current]') : ''}`,
      value: id,
      disabled: isActive ? 'Currently active' : false
    }));
    
    const { selectedPlatform } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPlatform',
        message: 'Select platform to switch to:',
        choices
      }
    ]);
    
    const switchSpinner = createSpinner(`Switching to ${selectedPlatform}...`);
    const success = await switchPlatform(selectedPlatform);
    
    if (success) {
      const platformInfo = platforms.find(p => p.id === selectedPlatform)?.info;
      switchSpinner.succeed(`Switched to ${platformInfo?.name || selectedPlatform}`);
      console.log(chalk.gray(`Now using: ${platformInfo?.host}`));
    } else {
      switchSpinner.fail('Failed to switch platform');
    }
  } catch (error) {
    spinner.fail('Failed to switch platform');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }
}

async function handlePlatformCurrent() {
  const spinner = createSpinner('Loading active platform...');
  
  try {
    const activeConfig = await getActivePlatformConfig();
    const platforms = await listPlatforms();
    const activePlatform = platforms.find(p => p.isActive);
    
    spinner.stop();
    
    if (!activeConfig || !activePlatform) {
      console.log(chalk.yellow('No active platform set.'));
      console.log(chalk.gray('Use "qc platform switch" to activate a platform.'));
      return;
    }
    
    console.log(chalk.bold('Current Active Platform:'));
    console.log();
    console.log(`${chalk.green('●')} ${chalk.cyan(activePlatform.info.name)}`);
    console.log(`   ${chalk.gray('ID:')} ${activePlatform.id}`);
    console.log(`   ${chalk.gray('Host:')} ${activePlatform.info.host}`);
    if (activePlatform.info.description && activePlatform.info.description !== activePlatform.info.host) {
      console.log(`   ${chalk.gray('Description:')} ${activePlatform.info.description}`);
    }
    console.log(`   ${chalk.gray('User:')} ${activeConfig.email || 'Unknown'}`);
    console.log(`   ${chalk.gray('Organizations:')} ${activeConfig.organizations?.length || 0}`);
    if (activeConfig.activeOrganization) {
      console.log(`   ${chalk.gray('Active Org:')} ${activeConfig.activeOrganization}`);
    }
    console.log();
  } catch (error) {
    spinner.fail('Failed to load active platform');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }
}

async function handlePlatformRemove() {
  const spinner = createSpinner('Loading platforms...');
  
  try {
    const platforms = await listPlatforms();
    spinner.stop();
    
    if (platforms.length === 0) {
      console.log(chalk.yellow('No authenticated platforms found.'));
      return;
    }
    
    const choices = platforms.map(({ id, info, isActive }) => ({
      name: `${info.name} ${chalk.gray(`(${info.host})`)} ${isActive ? chalk.yellow('[ACTIVE]') : ''}`,
      value: id
    }));
    
    const { selectedPlatform } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPlatform',
        message: 'Select platform to remove:',
        choices
      }
    ]);
    
    const platformInfo = platforms.find(p => p.id === selectedPlatform)?.info;
    const isActive = platforms.find(p => p.id === selectedPlatform)?.isActive;
    
    // Confirm removal
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove ${platformInfo?.name} (${platformInfo?.host})${isActive ? ' [ACTIVE]' : ''}?`,
        default: false
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.gray('Removal cancelled.'));
      return;
    }
    
    const removeSpinner = createSpinner(`Removing ${selectedPlatform}...`);
    const success = await removePlatform(selectedPlatform);
    
    if (success) {
      removeSpinner.succeed(`Removed ${platformInfo?.name || selectedPlatform}`);
      if (isActive) {
        console.log(chalk.yellow('⚠ Active platform was removed. Use "qc platform switch" to activate another platform.'));
      }
    } else {
      removeSpinner.fail('Failed to remove platform');
    }
  } catch (error) {
    spinner.fail('Failed to remove platform');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }
}