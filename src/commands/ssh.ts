import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getActivePlatformConfig } from '../utils/config.js';
import { ApiClient } from '../utils/api.js';
import { createSpinner } from '../utils/spinner.js';
import { SSHAccessApi, GetSshAccessCredentials200Response } from '@quantcdn/quant-client';

interface SSHOptions {
  container?: string;
  org?: string;
  app?: string;
  env?: string;
  command?: string;
  interactive?: boolean;
  platform?: string;
}

// Use the generated TypeScript client response type
type SSHAccessResponse = GetSshAccessCredentials200Response;

export const sshCommand = new Command('ssh')
  .description('Connect to environment container via SSH')
  .option('--container <name>', 'specific container to connect to')
  .option('--org <org>', 'organization machine name')
  .option('--app <app>', 'application machine name') 
  .option('--env <env>', 'environment name')
  .option('--command <cmd>', 'command to run (default: /bin/bash for interactive shell)')
  .option('--interactive', 'force interactive mode (only needed with --command)')
  .option('--platform <platform>', 'platform to use (override active platform)')
  .action(handleSSH);

async function handleSSH(options: SSHOptions) {
  const spinner = createSpinner('Checking SSH access...');
  
  try {
    // Log non-interactive mode parameters for validation
    const hasNonInteractiveParams = options.org || options.app || options.env || options.container;
    if (hasNonInteractiveParams) {
      console.log(chalk.gray(`🔧 Non-interactive mode: org=${options.org || 'auto'}, app=${options.app || 'auto'}, env=${options.env || 'auto'}, container=${options.container || 'auto'}`));
    }
    
    const auth = await getActivePlatformConfig();
    if (!auth || !auth.token) {
      spinner.fail('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Check if AWS CLI is installed
    spinner.text = 'Checking AWS CLI installation...';
    const awsCliAvailable = await checkAWSCLI();
    if (!awsCliAvailable) {
      spinner.fail('AWS CLI is required but not installed. Please install it first: https://aws.amazon.com/cli/');
      return;
    }

    const client = await ApiClient.create({
      org: options.org,
      app: options.app,
      env: options.env,
      platform: options.platform
    });
    
    // Resolve context
    const orgId = options.org || auth.activeOrganization;
    const appId = options.app || auth.activeApplication;
    const envId = options.env || auth.activeEnvironment;

    if (!orgId) {
      spinner.fail('No organization specified. Use --org or set active organization.');
      return;
    }
    if (!appId) {
      spinner.fail('No application specified. Use --app or set active application.');
      return;
    }
    if (!envId) {
      spinner.fail('No environment specified. Use --env or set active environment.');
      return;
    }

    // Request SSH access
    spinner.text = 'Requesting SSH access credentials...';
    
    let sshAccess: any;
    try {
      const sshAccessResponse = await client.sshAccessApi.getSshAccessCredentials(orgId, appId, envId);
      sshAccess = sshAccessResponse.body;
    } catch (apiError: any) {
      throw new Error(`SSH access request failed: ${apiError.message || 'Unknown API error'}`);
    }
    
    if (!sshAccess.success) {
      spinner.fail('SSH access denied or environment not available for SSH.');
      return;
    }

    // Select container if multiple available
    let containerName = options.container;
    if (!containerName) {
      if (sshAccess.containerNames && sshAccess.containerNames.length === 1) {
        containerName = sshAccess.containerNames[0];
      } else if (sshAccess.containerNames && sshAccess.containerNames.length > 1) {
        spinner.stop();
        const { selectedContainer } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedContainer',
            message: 'Select container:',
            choices: sshAccess.containerNames.map((name: string) => ({
              name: `${chalk.cyan(name)}`,
              value: name
            }))
          }
        ]);
        containerName = selectedContainer;
        spinner.start('Establishing SSH connection...');
      } else {
        spinner.fail('No containers available for SSH access.');
        return;
      }
    }

    // Verify selected container exists
    if (!containerName) {
      spinner.fail('No container specified.');
      return;
    }
    
    if (!sshAccess.containerNames || !sshAccess.containerNames.includes(containerName)) {
      spinner.fail(`Container '${containerName}' not found. Available: ${sshAccess.containerNames?.join(', ') || 'none'}`);
      return;
    }

    spinner.text = 'Connecting to container...';
    
    // Display connection info
    spinner.succeed('SSH access granted!');
    console.log();
    console.log(`${chalk.gray('Cluster:')} ${chalk.cyan(sshAccess.clusterName)}`);
    console.log(`${chalk.gray('Container:')} ${chalk.cyan(containerName)}`);
    console.log(`${chalk.gray('Region:')} ${chalk.cyan(sshAccess.region)}`);
    console.log(`${chalk.gray('Expires:')} ${chalk.yellow(sshAccess.credentials?.expiration ? new Date(sshAccess.credentials.expiration).toLocaleString() : 'Unknown')}`);
    console.log(`${chalk.gray('Context:')} ${chalk.green(orgId)}/${chalk.blue(appId)}/${chalk.magenta(envId)}`);
    console.log();
    console.log(chalk.gray('Establishing secure connection...'));
    console.log();

    // Execute AWS CLI command
    await executeAWSCommand(sshAccess, containerName, options.command, options.interactive);

  } catch (error: any) {
    spinner.fail(`SSH connection failed: ${error.message || String(error)}`);
    if (error.response?.status === 403) {
      console.log(chalk.yellow('\n💡 You may not have SSH access to this environment.'));
    }
  }
}

async function checkAWSCLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('aws', ['--version'], { stdio: 'pipe' });
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}


async function executeAWSCommand(sshAccess: SSHAccessResponse, containerName: string, command?: string, forceInteractive?: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!sshAccess.credentials) {
      reject(new Error('No credentials available'));
      return;
    }

    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: sshAccess.credentials.accessKeyId || '',
      AWS_SECRET_ACCESS_KEY: sshAccess.credentials.secretAccessKey || '',
      AWS_SESSION_TOKEN: sshAccess.credentials.sessionToken || '',
      AWS_DEFAULT_REGION: sshAccess.region || 'us-east-1'
    };

    // Logic:
    // - No command: default to /bin/bash and interactive
    // - With command: non-interactive by default
    // - With command + --interactive: interactive
    const targetCommand = command || '/bin/bash';
    const isInteractive = !command || forceInteractive;
    
    if (command) {
      if (forceInteractive) {
        console.log(chalk.gray(`Running interactive command: ${targetCommand}`));
      } else {
        console.log(chalk.gray(`Running command: ${targetCommand}`));
      }
    } else {
      console.log(chalk.gray('Starting interactive bash shell...'));
    }

    const args = [
      'ecs', 'execute-command',
      '--cluster', sshAccess.clusterName || '',
      '--task', sshAccess.taskArn || '',
      '--container', containerName,
      '--command', targetCommand
    ];

    // ECS cluster only supports interactive mode currently
    // Always use --interactive, but command vs shell behavior is handled by targetCommand
    args.push('--interactive');

    const child = spawn('aws', args, { 
      env,
      stdio: 'inherit',
      shell: false
    });

    child.on('close', (code) => {
      console.log();
      if (code === 0) {
        console.log(chalk.green('✅ Command completed successfully'));
      } else {
        console.log(chalk.yellow(`⚠ Command ended with code ${code}`));
      }
      resolve();
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to execute AWS CLI: ${error.message}`));
    });
  });
}