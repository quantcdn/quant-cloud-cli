import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import autocomplete from 'inquirer-autocomplete-prompt';
import { loadAuthConfig, saveAuthConfig } from '../utils/config.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { createSpinner } from '../utils/spinner.js';
import { Environment } from '../types/auth.js';

// Register the autocomplete prompt
inquirer.registerPrompt('autocomplete', autocomplete);

const logger = new Logger('Environment');

export function envCommand(program: Command) {
  const env = program.command('env').description('Manage environments');
  
  env.command('list')
    .description('List environments for the active application')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .action(async (options) => {
      await handleEnvList(options);
    });
  
  env.command('select')
    .description('Select active environment')
    .argument('[envId]', 'environment name to select')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .action(async (envId, options) => {
      await handleEnvSelect(envId, options);
    });
  
  env.command('current')
    .description('Show current active environment')
    .action(async () => {
      await handleEnvCurrent();
    });

  env.command('create')
    .description('Create a new environment')
    .argument('[envName]', 'name for the new environment')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .option('--clone-from <envName>', 'environment to clone configuration from')
    .option('--min-capacity <number>', 'minimum capacity (default: 1)', '1')
    .option('--max-capacity <number>', 'maximum capacity (default: 10)', '10')
    .action(async (envName, options) => {
      await handleEnvCreate(envName, options);
    });

  env.command('logs')
    .description('View environment logs')
    .argument('[envId]', 'environment name to view logs for')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .option('-f, --follow', 'follow log output (tail)')
    .option('-n, --lines <number>', 'number of lines to show (default: 100)', '100')
    .action(async (envId, options) => {
      await handleEnvLogs(envId, options);
    });

  // State control subcommands
  const state = env.command('state').description('Control environment state');
  
  state.command('stop')
    .description('Stop the active environment')
    .argument('[envId]', 'environment name to stop')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .action(async (envId, options) => {
      await handleEnvState('stop', envId, options);
    });

  state.command('start')
    .description('Start the active environment') 
    .argument('[envId]', 'environment name to start')
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .action(async (envId, options) => {
      await handleEnvState('start', envId, options);
    });

  state.command('redeploy')
    .description('Redeploy the active environment')
    .argument('[envId]', 'environment name to redeploy') 
    .option('--org <orgId>', 'override organization')
    .option('--app <appId>', 'override application')
    .option('--tag <imageTag>', 'Docker image tag for redeployment')
    .action(async (envId, options) => {
      await handleEnvState('redeploy', envId, options);
    });
}

interface EnvOptions {
  org?: string;
  app?: string;
}

interface EnvStateOptions extends EnvOptions {
  tag?: string; // For redeploy with specific image tag
}

interface EnvCreateOptions extends EnvOptions {
  cloneFrom?: string;
  minCapacity?: string;
  maxCapacity?: string;
}

interface EnvLogsOptions extends EnvOptions {
  follow?: boolean;
  lines?: string;
}

async function handleEnvList(options: EnvOptions) {
  const spinner = createSpinner('Loading environments...');
  
  try {
    const client = await ApiClient.create();
    const environments = await client.getEnvironments({ 
      organizationId: options.org,
      applicationId: options.app
    });
    
    spinner.succeed(`Found ${environments.length} environment${environments.length !== 1 ? 's' : ''}`);
    
    if (environments.length === 0) {
      logger.info('No environments found for this application.');
      logger.info(`${chalk.gray('Environments are created automatically when you deploy')}`);
      return;
    }

    const auth = await loadAuthConfig();
    
    logger.info('\nEnvironments:');
    environments.forEach((env: any, index: number) => {
      const isActive = env.envName === auth?.activeEnvironment;
      const marker = isActive ? chalk.green('*') : ' ';
      
      const statusIndicator = env.status === 'ACTIVE' ? '●' : '○';
      const statusColor = env.status === 'ACTIVE' ? chalk.green(statusIndicator) : chalk.red(statusIndicator);
      
      logger.info(`${marker} ${statusColor} ${chalk.cyan(env.envName)}`);
      
      // Show running status
      const running = env.runningCount || 0;
      const desired = env.desiredCount || 0;
      const runningStatus = running === desired ? chalk.green(`${running}/${desired} running`) : chalk.yellow(`${running}/${desired} running`);
      logger.info(`   ${runningStatus}`);
      
      // Show capacity info if available
      if (env.minCapacity || env.maxCapacity) {
        logger.info(`   ${chalk.gray('Capacity:')} ${env.minCapacity || 0}-${env.maxCapacity || 1}`);
      }
      
      console.log(); // Empty line between environments
    });
    
    // Show context
    const contextParts = [];
    if (options?.org) contextParts.push(`org: ${options.org}`);
    if (options?.app) contextParts.push(`app: ${options.app}`);
    const contextStr = contextParts.length > 0 ? ` (${contextParts.join(', ')})` : ' (active context)';
    logger.info(`${chalk.gray('Showing environments for')}${contextStr}`);
    
    if (environments.length > 1) {
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud env select')} ${chalk.gray('to change active environment')}`);
    }
    
  } catch (error: any) {
    spinner.fail('Failed to load environments');
    
    if (error.message?.includes('Not authenticated')) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
    } else if (error.message?.includes('404') || error.message?.includes('not found')) {
      logger.error('Application not found or no access to environments.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud app list')} ${chalk.gray('to see available applications')}`);
    } else if (error.message?.includes('403') || error.message?.includes('forbidden')) {
      logger.error('Access denied. You may not have permission to view environments for this application.');
    } else {
      logger.error('Error:', error.message);
      logger.debug('Full error:', error);
    }
  }
}

async function handleEnvSelect(envId?: string, options?: EnvOptions) {
  try {
    const auth = await loadAuthConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Get environments
    const client = await ApiClient.create();
    const environments = await client.getEnvironments({ 
      organizationId: options?.org,
      applicationId: options?.app
    });
    
    if (environments.length === 0) {
      logger.info('No environments available for this application.');
      return;
    }
    
    if (environments.length === 1) {
      logger.info('Only one environment available - no switching needed.');
      return;
    }
    
    let targetEnvId = envId;
    
    // If no envId provided, show interactive selection with search
    if (!targetEnvId) {
      const envChoices = environments.map((env: any) => {
        const isCurrent = env.envName === auth.activeEnvironment;
        return {
          name: `${env.envName}${isCurrent ? chalk.green(' - current') : ''}`,
          value: env.envName
        };
      });

      const { selectedEnvId } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'selectedEnvId',
          message: 'Select environment (type to filter):',
          source: async (answersSoFar: any, input: string) => {
            if (!input) {
              return envChoices;
            }
            
            // Filter environments based on user input
            const filtered = envChoices.filter((choice: any) => 
              choice.value.toLowerCase().includes(input.toLowerCase())
            );
            
            return filtered.length > 0 ? filtered : [
              { name: chalk.red(`No environments matching "${input}"`), value: null, disabled: true }
            ];
          },
          pageSize: 10,
          searchText: 'Searching...',
          emptyText: 'No environments found'
        }
      ]);
      
      if (!selectedEnvId) {
        logger.info('No environment selected.');
        return;
      }
      
      targetEnvId = selectedEnvId;
    }
    
    // Validate the environment exists
    const targetEnv = environments.find((env: any) => env.envName === targetEnvId);
    if (!targetEnv) {
      logger.error(`Environment '${targetEnvId}' not found.`);
      logger.info('Available environments:');
      environments.forEach((env: any) => {
        logger.info(`  ${chalk.cyan(env.envName)}`);
      });
      return;
    }
    
    // Update active environment
    auth.activeEnvironment = targetEnvId;
    await saveAuthConfig(auth);
    
    logger.info(`${chalk.green('✓')} Selected environment: ${chalk.cyan(targetEnvId)}`);
    
  } catch (error) {
    logger.error('Failed to switch environment:', error);
  }
}

async function handleEnvCurrent() {
  try {
    const auth = await loadAuthConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    if (!auth.activeEnvironment) {
      logger.info('No active environment set.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud env list')} ${chalk.gray('to see available environments')}`);
      return;
    }
    
    try {
      // Get fresh environment data from API
      const client = await ApiClient.create();
      const environments = await client.getEnvironments();
      const activeEnv = environments.find((e: Environment) => e.machine_name === auth.activeEnvironment);
      
      if (!activeEnv) {
        logger.info('Active environment not found in current application.');
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud env list')} ${chalk.gray('to see available environments')}`);
        return;
      }
      
      logger.info(`Active environment: ${chalk.green(activeEnv.name || activeEnv.machine_name)}`);
      logger.info(`Machine name: ${chalk.gray(activeEnv.machine_name)}`);
      
      if (activeEnv.status) {
        const status = getStatusIndicator(activeEnv.status);
        logger.info(`Status: ${status} ${activeEnv.status}`);
      }
      
      if (activeEnv.url) {
        logger.info(`URL: ${chalk.blue(activeEnv.url)}`);
      }
      
    } catch (error) {
      // Fallback to showing just stored data
      logger.info(`Active environment: ${chalk.green(auth.activeEnvironment)}`);
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud env list')} ${chalk.gray('to refresh environment data')}`);
    }
    
  } catch (error) {
    logger.error('Failed to get current environment:', error);
  }
}

async function handleEnvState(action: 'stop' | 'start' | 'redeploy', envId?: string, options?: EnvStateOptions) {
  try {
    const auth = await loadAuthConfig();
    if (!auth || !auth.token) {
      logger.error('Not authenticated. Run `quant-cloud login` first.');
      return;
    }

    // Determine target environment
    let targetEnvId = envId;
    if (!targetEnvId && !auth.activeEnvironment) {
      logger.error('No environment specified and no active environment set.');
      logger.info('Use `quant-cloud env select` to set an active environment or specify an environment name.');
      return;
    }
    
    targetEnvId = targetEnvId || auth.activeEnvironment;
    
    // Determine context
    const organizationId = options?.org || auth.activeOrganization;
    const applicationId = options?.app || auth.activeApplication;
    
    if (!organizationId) {
      logger.error('No organization found. Use `quant-cloud org select` first.');
      return;
    }
    
    if (!applicationId) {
      logger.error('No application found. Use `quant-cloud app select` first.');
      return;
    }

    const spinner = createSpinner(`${action === 'stop' ? 'Stopping' : action === 'start' ? 'Starting' : 'Redeploying'} environment: ${targetEnvId}...`);
    
    try {
      const client = await ApiClient.create();
      
      // Prepare the state update request
      const stateRequest: any = {
        action: action
      };
      
      // Add image tag for redeploy if specified
      if (action === 'redeploy' && options?.tag) {
        stateRequest.imageTag = options.tag;
      }
      
      await client.environmentsApi.updateEnvironmentState(
        organizationId,
        applicationId,
        targetEnvId!,
        stateRequest
      );
      
      spinner.succeed(`${chalk.green('✓')} Environment ${chalk.cyan(targetEnvId)} ${action} operation initiated`);
      
      if (action === 'redeploy') {
        logger.info(`${chalk.gray('Note:')} Redeployment may take a few minutes to complete`);
      } else {
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('qc env list')} ${chalk.gray('to check the updated status')}`);
      }
      
    } catch (error: any) {
      spinner.fail(`Failed to ${action} environment`);
      
      if (error.response && error.response.status === 404) {
        logger.error(`Environment '${targetEnvId}' not found in application '${applicationId}'`);
      } else if (error.response && error.response.status === 403) {
        logger.error('Insufficient permissions to control environment state');
      } else {
        logger.error(`API Error: ${error.message || 'Unknown error occurred'}`);
      }
      
      logger.info(`${chalk.gray('Available environments:')} ${chalk.cyan('qc env list')}`);
    }
    
  } catch (error: any) {
    logger.error(`Failed to ${action} environment:`, error instanceof Error ? error.message : String(error));
  }
}

async function handleEnvCreate(envName?: string, options?: EnvCreateOptions) {
  try {
    const auth = await loadAuthConfig();
    if (!auth || !auth.token) {
      logger.error('Not authenticated. Run `quant-cloud login` first.');
      return;
    }

    // Determine context
    const organizationId = options?.org || auth.activeOrganization;
    const applicationId = options?.app || auth.activeApplication;
    
    if (!organizationId) {
      logger.error('No organization found. Use `quant-cloud org select` first.');
      return;
    }
    
    if (!applicationId) {
      logger.error('No application found. Use `quant-cloud app select` first.');
      return;
    }

    // Prompt for environment name if not provided
    let targetEnvName = envName;
    if (!targetEnvName) {
      const { name } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Environment name:',
          validate: (input: string) => {
            if (!input.trim()) return 'Environment name is required';
            if (!/^[a-zA-Z0-9-_]+$/.test(input)) return 'Environment name can only contain letters, numbers, hyphens, and underscores';
            return true;
          }
        }
      ]);
      targetEnvName = name;
    }

    // Get existing environments for cloning options
    const loadSpinner = createSpinner('Loading existing environments...');
    const client = await ApiClient.create();
    
    try {
      const environments = await client.getEnvironments({ 
        organizationId,
        applicationId 
      });
      loadSpinner.succeed('Loaded environments');

      // Determine clone source
      let cloneFrom = options?.cloneFrom;
      if (!cloneFrom && environments.length > 0) {
        const { selectedCloneFrom } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedCloneFrom',
            message: 'Clone configuration from:',
            choices: [
              { name: 'Create empty environment', value: null },
              ...environments.map((env: any) => ({
                name: `${env.envName} (${env.runningCount || 0}/${env.desiredCount || 0} running)`,
                value: env.envName
              }))
            ]
          }
        ]);
        cloneFrom = selectedCloneFrom;
      }

      // Prepare create request
      const createRequest: any = {
        envName: targetEnvName,
        minCapacity: parseInt(options?.minCapacity || '1'),
        maxCapacity: parseInt(options?.maxCapacity || '10')
      };

      if (cloneFrom) {
        createRequest.cloneConfigurationFrom = cloneFrom;
      }

      // Create the environment
      const spinner = createSpinner(`Creating environment '${targetEnvName}'...`);
      
      try {
        const response = await client.environmentsApi.createEnvironment(
          organizationId,
          applicationId, 
          createRequest
        );
        
        spinner.succeed(`Environment '${targetEnvName}' created successfully!`);
        
        // Display created environment info
        const createdEnv = response.body;
        logger.info(`${chalk.green('✓')} Environment: ${chalk.cyan(createdEnv.envName)}`);
        if (cloneFrom) {
          logger.info(`${chalk.gray('Cloned from:')} ${chalk.yellow(cloneFrom)}`);
        }
        logger.info(`${chalk.gray('Capacity:')} ${createRequest.minCapacity}-${createRequest.maxCapacity}`);
        
        // Ask if user wants to select this as active environment
        const { setActive } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'setActive',
            message: `Set '${targetEnvName}' as active environment?`,
            default: true
          }
        ]);

        if (setActive) {
          auth.activeEnvironment = targetEnvName;
          await saveAuthConfig(auth);
          logger.info(`${chalk.green('✓')} Active environment set to: ${chalk.cyan(targetEnvName)}`);
        }

      } catch (createError: any) {
        spinner.fail(`Failed to create environment '${targetEnvName}'`);
        throw createError;
      }

    } catch (error: any) {
      loadSpinner.fail('Failed to load environments');
      throw error;
    }
    
  } catch (error: any) {
    logger.error('Failed to create environment:', error instanceof Error ? error.message : String(error));
  }
}

async function handleEnvLogs(envId?: string, options?: EnvLogsOptions) {
  try {
    const auth = await loadAuthConfig();
    if (!auth || !auth.token) {
      logger.error('Not authenticated. Run `quant-cloud login` first.');
      return;
    }

    // Determine target environment
    let targetEnvId = envId;
    if (!targetEnvId && !auth.activeEnvironment) {
      logger.error('No environment specified and no active environment set.');
      logger.info('Use `quant-cloud env select` to set an active environment or specify an environment name.');
      return;
    }
    
    const resolvedEnvId = targetEnvId || auth.activeEnvironment!;
    
    // Determine context
    const organizationId = options?.org || auth.activeOrganization;
    const applicationId = options?.app || auth.activeApplication;
    
    if (!organizationId) {
      logger.error('No organization found. Use `quant-cloud org select` first.');
      return;
    }
    
    if (!applicationId) {
      logger.error('No application found. Use `quant-cloud app select` first.');
      return;
    }

    const client = await ApiClient.create();
    const maxLines = parseInt(options?.lines || '100');
    
    console.log(chalk.gray(`--- Logs for environment: ${chalk.cyan(resolvedEnvId)} ---`));
    
    if (options?.follow) {
      console.log(chalk.gray('Following logs... Press Ctrl+C to exit'));
      console.log();
      
      let isFollowing = true;
      let lastTimestamp: string | null = null;
      
      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        isFollowing = false;
        console.log(chalk.gray('\n--- Log tailing stopped ---'));
        process.exit(0);
      });
      
      // Poll for logs every 2 seconds
      while (isFollowing) {
        try {
          const logs = await fetchLogs(client, organizationId, applicationId, resolvedEnvId);
          
          if (logs && logs.length > 0) {
            const newLogs: any[] = lastTimestamp 
              ? logs.filter((log: any) => log.timestamp > lastTimestamp!)
              : logs.slice(-maxLines);
              
            if (newLogs.length > 0) {
              newLogs.forEach((log: any) => displayLog(log));
              lastTimestamp = newLogs[newLogs.length - 1].timestamp;
            }
          }
          
          // Wait 2 seconds before next poll
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error: any) {
          if (isFollowing) {
            logger.error('Error fetching logs:', error instanceof Error ? error.message : String(error));
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait longer on error
          }
        }
      }
    } else {
      // Single fetch
      const spinner = createSpinner('Fetching logs...');
      
      try {
        const logs = await fetchLogs(client, organizationId, applicationId, resolvedEnvId);
        spinner.stop();
        
        if (logs && logs.length > 0) {
          const recentLogs = logs.slice(-maxLines);
          recentLogs.forEach((log: any) => displayLog(log));
          
          console.log();
          console.log(chalk.gray(`--- Showing last ${recentLogs.length} log entries ---`));
          if (logs.length > maxLines) {
            console.log(chalk.gray(`Use ${chalk.cyan('--lines')} to show more entries or ${chalk.cyan('--follow')} to tail logs`));
          }
        } else {
          console.log(chalk.yellow('No logs found for this environment'));
        }
        
      } catch (error: any) {
        spinner.fail('Failed to fetch logs');
        throw error;
      }
    }
    
  } catch (error: any) {
    logger.error('Failed to get environment logs:', error instanceof Error ? error.message : String(error));
  }
}

async function fetchLogs(client: ApiClient, organizationId: string, applicationId: string, environmentId: string): Promise<any[]> {
  try {
    const response = await client.environmentsApi.getEnvironmentLogs(
      organizationId,
      applicationId,
      environmentId
    );
    
    // The logs might be in different formats, let's handle various possibilities
    if (response.body) {
      // If body is already parsed JSON
      if (Array.isArray(response.body)) {
        return response.body;
      }
      
      // If body has a logs property
      if (response.body.logs && Array.isArray(response.body.logs)) {
        return response.body.logs;
      }
      
      // If body is a single log entry
      if (response.body.message || response.body.timestamp) {
        return [response.body];
      }
      
      // Try to parse as JSON string if it's a string
      if (typeof response.body === 'string') {
        try {
          const parsed = JSON.parse(response.body);
          if (Array.isArray(parsed)) {
            return parsed;
          }
          if (parsed.logs) {
            return parsed.logs;
          }
          return [parsed];
        } catch {
          // If parsing fails, treat as plain text logs
          return [{ message: response.body, timestamp: new Date().toISOString() }];
        }
      }
    }
    
    return [];
  } catch (error: any) {
    logger.error('API call failed:', error);
    throw error;
  }
}

function displayLog(log: any) {
  const timestamp = log.timestamp || log.time || log.created_at || new Date().toISOString();
  const message = log.message || log.msg || log.log || String(log);
  const level = log.level || log.severity || 'info';
  
  // Format timestamp
  const date = new Date(timestamp);
  const formattedTime = date.toLocaleTimeString();
  
  // Color code by log level
  let levelColor = chalk.gray;
  if (level.toLowerCase().includes('error') || level.toLowerCase().includes('err')) {
    levelColor = chalk.red;
  } else if (level.toLowerCase().includes('warn')) {
    levelColor = chalk.yellow;
  } else if (level.toLowerCase().includes('info')) {
    levelColor = chalk.blue;
  } else if (level.toLowerCase().includes('debug')) {
    levelColor = chalk.gray;
  }
  
  // Display formatted log entry
  console.log(
    chalk.gray(`[${formattedTime}]`) + ' ' + 
    levelColor(`${level.toUpperCase()}`) + ' ' + 
    message
  );
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