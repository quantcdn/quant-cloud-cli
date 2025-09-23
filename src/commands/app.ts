import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import inquirerAutocompletePrompt from 'inquirer-autocomplete-prompt';

inquirer.registerPrompt('autocomplete', inquirerAutocompletePrompt);
import { createSpinner } from '../utils/spinner.js';
import { getActivePlatformConfig, saveActivePlatformConfig } from '../utils/config.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { Application } from '../types/auth.js';

const logger = new Logger('App');

export function appCommand(program: Command) {
  const app = program.command('app').description('Manage applications');
  
  app.command('list')
    .description('List applications in the active organization')
    .option('--org <orgId>', 'override organization')
    .action(async (options) => {
      await handleAppList(options);
    });
  
  app.command('select')
    .description('Select active application')
    .argument('[appId]', 'application name to select')
    .option('--org <orgId>', 'override organization')
    .action(async (appId, options) => {
      await handleAppSelect(appId, options);
    });
  
  app.command('current')
    .description('Show current active application')
    .action(async () => {
      await handleAppCurrent();
    });
}

interface AppOptions {
  org?: string;
}

async function handleAppList(options: AppOptions) {
  const spinner = createSpinner('Loading applications...');
  
  try {
    const client = await ApiClient.create();
    const apps = await client.getApplications({ organizationId: options.org });
    
    // Remove debug logging
    
    spinner.succeed(`Found ${apps.length} application${apps.length !== 1 ? 's' : ''}`);
    
    if (apps.length === 0) {
      logger.info('No applications found in this organization.');
      logger.info(`${chalk.gray('Create your first app in the dashboard')}`);
      return;
    }

    const auth = await getActivePlatformConfig();
    
    logger.info('\nApplications:');
    apps.forEach((app: any, index) => {
      const isActive = app.appName === auth?.activeApplication;
      const marker = isActive ? chalk.green('*') : ' ';
      
      // Check production environment status for overall app status
      const prodEnv = app.environments?.find((env: any) => env.envName === 'production');
      const status = prodEnv ? getStatusIndicator(prodEnv.status) : '○';
      
      logger.info(`${marker} ${status} ${chalk.cyan(app.appName)}`);
      
      // Show environment count and status (limit to first 3 for readability)
      if (app.environments && app.environments.length > 0) {
        const maxEnvsToShow = 3;
        const envs = app.environments.slice(0, maxEnvsToShow);
        const envNames = envs.map((e: any) => e.envName);
        const remainingCount = app.environments.length - maxEnvsToShow;
        
        let envDisplay = envNames.join(', ');
        if (remainingCount > 0) {
          envDisplay += chalk.gray(` ... and ${remainingCount} more`);
        }
        logger.info(`   ${chalk.gray('Environments:')} ${envDisplay}`);
        
        // Show running status for displayed environments only
        envs.forEach((env: any) => {
          const envStatus = env.deploymentStatus === 'COMPLETED' ? chalk.green('✓') : chalk.yellow('⚠');
          const running = env.runningCount || 0;
          const desired = env.desiredCount || 0;
          logger.info(`     ${envStatus} ${chalk.magenta(env.envName)}: ${running}/${desired} running`);
        });
        
        if (remainingCount > 0) {
          logger.info(`     ${chalk.gray(`Use ${chalk.cyan('qc env list')} to see all ${app.environments.length} environments`)}`);
        }
      }
      
      console.log(); // Empty line between apps
    });
    
    // Show context
    const orgInfo = options.org ? ` (org: ${options.org})` : ' (active organization)';
    logger.info(`${chalk.gray('Showing applications for')}${orgInfo}`);
    
    if (apps.length > 1) {
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud app select')} ${chalk.gray('to change active application')}`);
    }
    
  } catch (error: any) {
    spinner.fail('Failed to load applications');
    
    if (error.message?.includes('Not authenticated')) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
    } else if (error.message?.includes('404') || error.message?.includes('not found')) {
      logger.error('Organization not found or no access to applications.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org list')} ${chalk.gray('to see available organizations')}`);
    } else if (error.message?.includes('403') || error.message?.includes('forbidden')) {
      logger.error('Access denied. You may not have permission to view applications in this organization.');
    } else {
      logger.error('Error:', error.message);
      logger.debug('Full error:', error);
    }
  }
}

async function handleAppSelect(appId?: string, options?: AppOptions) {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Get applications with spinner
    const spinner = createSpinner('Loading applications...');
    const client = await ApiClient.create();
    
    let apps: any[] = [];
    try {
      apps = await client.getApplications({ organizationId: options?.org });
      spinner.succeed('Loaded applications');
    } catch (error) {
      spinner.fail('Failed to load applications');
      throw error;
    }
    
    if (apps.length === 0) {
      logger.info('No applications available in this organization.');
      return;
    }
    
    if (apps.length === 1) {
      logger.info('Only one application available - no switching needed.');
      return;
    }
    
    let targetAppId = appId;
    
    // If no appId provided, show interactive selection with search
    if (!targetAppId) {
      const appChoices = apps.map((app: any) => {
        const isCurrent = app.appName === auth.activeApplication;
        return {
          name: `${app.appName}${isCurrent ? chalk.green(' - current') : ''}`,
          value: app.appName
        };
      });

      const { selectedAppId } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'selectedAppId',
          message: 'Select application (type to filter):',
          source: async (answersSoFar: any, input: string) => {
            if (!input) {
              return appChoices;
            }
            
            // Filter applications based on user input
            const filtered = appChoices.filter((choice: any) => 
              choice.value.toLowerCase().includes(input.toLowerCase())
            );
            
            return filtered.length > 0 ? filtered : [
              { name: chalk.red(`No applications matching "${input}"`), value: null, disabled: true }
            ];
          },
          pageSize: 10,
          searchText: 'Searching...',
          emptyText: 'No applications found'
        }
      ]);
      
      if (!selectedAppId) {
        logger.info('No application selected.');
        return;
      }
      
      targetAppId = selectedAppId;
    }
    
    // Validate the application exists
    const targetApp = apps.find((a: any) => a.appName === targetAppId);
    if (!targetApp) {
      logger.error(`Application '${targetAppId}' not found.`);
      logger.info('Available applications:');
      apps.forEach((app: any) => {
        logger.info(`  ${chalk.cyan(app.appName)}`);
      });
      return;
    }
    
    // Update active application (and clear environment since it may not exist in new app)
    auth.activeApplication = targetApp.appName;
    auth.activeEnvironment = undefined; // Reset environment when switching apps
    
    logger.info(`Selected application: ${chalk.green(targetApp.appName)}`);
    
    // Now automatically continue with environment selection
    const envSpinner = createSpinner('Loading environments...');
    
    try {
      const environments = await client.getEnvironments({ 
        organizationId: options?.org,
        applicationId: targetApp.appName
      });
      envSpinner.succeed(`Found ${environments.length} environments`);
      
      if (environments.length === 0) {
        logger.info('No environments available in this application.');
        return;
      }
      
      if (environments.length === 1) {
        // Auto-select single environment
        await saveActivePlatformConfig({
          activeApplication: targetApp.appName,
          activeEnvironment: environments[0].envName
        });
        logger.info(`Auto-selected environment: ${chalk.magenta(environments[0].envName)}`);
        return;
      }
      
      // Multiple environments - prompt for selection
      const searchEnvs = (answers: any, input: string = '') => {
        return new Promise((resolve) => {
          const filtered = environments.filter((env: any) => 
            env.envName.toLowerCase().includes(input.toLowerCase())
          );
          
          const choices = filtered.map((env: any) => ({
            name: `${chalk.magenta(env.envName)} ${chalk.gray(`(${env.runningCount || 0}/${env.desiredCount || 0} running)`)}`,
            value: env.envName
          }));
          
          resolve(choices);
        });
      };
      
      const { selectedEnvId } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'selectedEnvId',
          message: 'Select environment:',
          source: searchEnvs,
          pageSize: 10,
        }
      ]);
      
      // Save the selected application and environment
      await saveActivePlatformConfig({
        activeApplication: targetApp.appName,
        activeEnvironment: selectedEnvId
      });
      
      logger.info(`Selected environment: ${chalk.magenta(selectedEnvId)}`);
      logger.info(`${chalk.gray('Context:')} ${chalk.green(auth.activeOrganization || 'default')}/${chalk.blue(targetApp.appName)}/${chalk.magenta(selectedEnvId)}`);
      
    } catch (envError) {
      envSpinner.fail('Failed to load environments');
      logger.warn(`Could not load environments for app '${targetApp.appName}'. Environment context cleared.`);
      await saveActivePlatformConfig({
        activeApplication: targetApp.appName,
        activeEnvironment: undefined
      });
    }
    
  } catch (error) {
    logger.error('Failed to switch application:', error);
  }
}

async function handleAppCurrent() {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    if (!auth.activeApplication) {
      logger.info('No active application set.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud app list')} ${chalk.gray('to see available applications')}`);
      return;
    }
    
    try {
      // Get fresh app data from API with spinner
      const spinner = createSpinner('Loading application data...');
      const client = await ApiClient.create();
      
      let apps: any[] = [];
      try {
        apps = await client.getApplications();
        spinner.succeed('Loaded application data');
      } catch (error) {
        spinner.fail('Failed to load application data');
        throw error;
      }
      
      const activeApp = apps.find((a: Application) => a.machine_name === auth.activeApplication);
      
      if (!activeApp) {
        logger.info('Active application not found in current organization.');
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud app list')} ${chalk.gray('to see available applications')}`);
        return;
      }
      
      logger.info(`Active application: ${chalk.green(activeApp.name || activeApp.machine_name)}`);
      logger.info(`Machine name: ${chalk.gray(activeApp.machine_name)}`);
      
      if (activeApp.status) {
        const status = getStatusIndicator(activeApp.status);
        logger.info(`Status: ${status} ${activeApp.status}`);
      }
      
      if (activeApp.url) {
        logger.info(`URL: ${chalk.blue(activeApp.url)}`);
      }
      
      if (auth.activeEnvironment) {
        logger.info(`Active environment: ${chalk.cyan(auth.activeEnvironment)}`);
      }
      
    } catch (error) {
      // Fallback to showing just stored data
      logger.info(`Active application: ${chalk.green(auth.activeApplication)}`);
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud app list')} ${chalk.gray('to refresh application data')}`);
    }
    
  } catch (error) {
    logger.error('Failed to get current application:', error);
  }
}

function getStatusIndicator(status?: string): string {
  if (!status) return chalk.gray('○');
  
  const statusLower = status.toLowerCase();
  
  if (statusLower === 'running' || statusLower === 'active' || statusLower === 'deployed') {
    return chalk.green('●');
  } else if (statusLower === 'building' || statusLower === 'deploying' || statusLower === 'pending') {
    return chalk.yellow('◐');
  } else if (statusLower === 'error' || statusLower === 'failed') {
    return chalk.red('●');
  } else if (statusLower === 'stopped' || statusLower === 'inactive') {
    return chalk.gray('○');
  } else {
    return chalk.blue('◒');
  }
}