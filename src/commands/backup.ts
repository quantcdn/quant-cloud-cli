import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { createSpinner } from '../utils/spinner.js';
import { 
  CreateBackupRequest,
  ListBackups200Response,
  ListBackups200ResponseBackupsInner 
} from '@quantcdn/quant-client';

const logger = new Logger('Backup');

interface BackupOptions {
  org?: string;
  app?: string;
  env?: string;
  output?: string;
  platform?: string;
}

interface BackupListOptions extends BackupOptions {
  json?: boolean;
  type?: string;
  platform?: string;
}

interface BackupCreateOptions extends BackupOptions {
  type?: 'database' | 'filesystem';
  description?: string;
}

export function backupCommand(program: Command) {
  const backup = new Command('backup')
    .description('Manage environment backups');

  backup
    .command('list')
    .description('List available backups')
    .option('--org <org>', 'Organization ID')
    .option('--app <app>', 'Application ID')  
    .option('--env <env>', 'Environment ID')
    .option('--type <type>', 'Filter by backup type (database, filesystem)', 'database')
    .option('--json', 'Output as JSON')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (options: BackupListOptions) => {
      await handleBackupList(options);
    });

  backup
    .command('create')
    .description('Create a new backup')
    .option('--org <org>', 'Organization ID')
    .option('--app <app>', 'Application ID')
    .option('--env <env>', 'Environment ID') 
    .option('--type <type>', 'Backup type: database or filesystem', 'database')
    .option('--description <description>', 'Backup description')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (options: BackupCreateOptions) => {
      await handleBackupCreate(options);
    });

  backup
    .command('download [backupId]')
    .description('Download a backup')
    .option('--org <org>', 'Organization ID')
    .option('--app <app>', 'Application ID')
    .option('--env <env>', 'Environment ID')
    .option('--type <type>', 'Backup type: database or filesystem', 'database')
    .option('--output <path>', 'Output directory', './downloads')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (backupId: string | undefined, options: BackupListOptions) => {
      await handleBackupDownload(backupId, options);
    });

  backup
    .command('delete')
    .description('Delete a backup')
    .option('--org <org>', 'Organization ID')
    .option('--app <app>', 'Application ID')
    .option('--env <env>', 'Environment ID')
    .option('--type <type>', 'Backup type: database or filesystem', 'database')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (options: BackupListOptions) => {
      await handleBackupDelete(options);
    });

  return backup;
}

async function handleBackupList(options: BackupListOptions): Promise<void> {
  try {
    const client = await ApiClient.create({
      org: options.org,
      app: options.app,
      env: options.env,
      platform: options.platform
    });
    
    // Get target identifiers
    const orgId = options.org || client['defaultOrganizationId'];
    const appId = options.app || client['defaultApplicationId'];
    const envId = options.env || client['defaultEnvironmentId'];

    if (!orgId || !appId || !envId) {
      logger.error('Organization, application, and environment must be specified or configured');
      process.exit(1);
    }

    const spinner = createSpinner('Loading backups...');
    
    try {
      const backupType = (options.type || 'database') as 'database' | 'filesystem';
      const response = await client.backupManagementApi.listBackups(orgId, appId, envId, backupType);
      const backups = response.data?.backups || [];
      
      spinner.succeed(`Found ${backups.length} backups`);

      if (options.json) {
        console.log(JSON.stringify(backups, null, 2));
        return;
      }

      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found.'));
        return;
      }

      console.log('\n' + chalk.bold('📦 Backups'));
      console.log('─'.repeat(80));

      backups.forEach((backup: any, index: number) => {
        const createdDate = backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'Unknown';
        const size = backup.size ? formatBytes(backup.size) : 'Unknown';
        const status = getStatusIcon(backup.status);
        
        const backupId = backup.backupId || backup.id;
        const displayId = backupId || `backup-${new Date(backup.createdAt || Date.now()).getTime()}`;
        
        console.log(`${index + 1}. ${chalk.cyan(displayId)}`);
        console.log(`   Status: ${status} ${backup.status || 'Unknown'}`);
        console.log(`   Created: ${chalk.gray(createdDate)}`);
        
        // Show size (prefer formatted if available)
        if (backup.sizeFormatted) {
          console.log(`   Size: ${chalk.yellow(backup.sizeFormatted)}`);
        } else {
          console.log(`   Size: ${chalk.yellow(size)}`);
        }
        
        // Show additional fields if available
        if (backup.type) {
          console.log(`   Type: ${chalk.blue(backup.type)}`);
        }
        if (backup.engine) {
          console.log(`   Engine: ${chalk.gray(backup.engine)}`);
        }
        if (backup.description) {
          console.log(`   Description: ${backup.description}`);
        }
        if (!backupId) {
          console.log(`   ${chalk.yellow('⚠ No backup ID available - downloads not supported for this environment')}`);
        }
        console.log();
      });

    } catch (error: any) {
      spinner.fail(`Failed to load backups: ${error.message}`);
      logger.error(error);
      process.exit(1);
    }

  } catch (error: any) {
    logger.error(`Backup list failed: ${error.message}`);
    process.exit(1);
  }
}

async function handleBackupCreate(options: BackupCreateOptions): Promise<void> {
  try {
    const client = await ApiClient.create({
      org: options.org,
      app: options.app,
      env: options.env,
      platform: options.platform
    });
    
    // Get target identifiers
    const orgId = options.org || client['defaultOrganizationId'];
    const appId = options.app || client['defaultApplicationId'];
    const envId = options.env || client['defaultEnvironmentId'];

    if (!orgId || !appId || !envId) {
      logger.error('Organization, application, and environment must be specified or configured');
      process.exit(1);
    }

    let backupType = options.type || 'database';
    let description = options.description;

    // Interactive prompts if not provided
    if (!options.type) {
      const typeAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'type',
          message: 'What type of backup would you like to create?',
          choices: [
            { name: '🗄️  Database', value: 'database' },
            { name: '📁 Filesystem', value: 'filesystem' }
          ]
        }
      ]);
      backupType = typeAnswer.type;
    }

    if (!description) {
      const descAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'description',
          message: 'Enter a description for this backup (optional):',
          default: `${backupType} backup created on ${new Date().toLocaleString()}`
        }
      ]);
      description = descAnswer.description;
    }

    const spinner = createSpinner('Creating backup...');
    
    try {
      const createRequest: CreateBackupRequest = {
        ...(description && { description })
      };

      const response = await client.backupManagementApi.createBackup(orgId, appId, envId, backupType as 'database' | 'filesystem', createRequest);
      const backup = response.data;
      
      spinner.succeed('Backup creation initiated!');
      
      console.log(`\n${chalk.green('✓')} Backup creation initiated!`);
      console.log(`Type: ${chalk.blue(backupType)}`);
      const responseData = backup as any;
      if (responseData?.id) {
        console.log(`ID: ${chalk.cyan(responseData.id)}`);
      }
      if (responseData?.status) {
        console.log(`Status: ${getStatusIcon(responseData.status)} ${responseData.status}`);
      }
      if (description) {
        console.log(`Description: ${description}`);
      }
      console.log(`\n${chalk.yellow('ℹ')} Use ${chalk.cyan('qc backup list')} to monitor the backup progress.`);

    } catch (error: any) {
      spinner.fail(`Failed to create backup: ${error.message}`);
      logger.error(error);
      process.exit(1);
    }

  } catch (error: any) {
    logger.error(`Backup creation failed: ${error.message}`);
    process.exit(1);
  }
}

async function handleBackupDownload(backupId: string | undefined, options: BackupListOptions): Promise<void> {
  try {
    const client = await ApiClient.create({
      org: options.org,
      app: options.app,
      env: options.env,
      platform: options.platform
    });
    
    // Get target identifiers
    const orgId = options.org || client['defaultOrganizationId'];
    const appId = options.app || client['defaultApplicationId'];
    const envId = options.env || client['defaultEnvironmentId'];

    if (!orgId || !appId || !envId) {
      logger.error('Organization, application, and environment must be specified or configured');
      process.exit(1);
    }

    const spinner = createSpinner('Loading backups...');
    
    try {
      // First, get the list of backups
      const backupType = (options.type || 'database') as 'database' | 'filesystem';
      const listResponse = await client.backupManagementApi.listBackups(orgId, appId, envId, backupType);
      const backups = listResponse.data?.backups || [];
      
      if (backups.length === 0) {
        spinner.fail('No backups found');
        console.log(chalk.yellow(`Create a ${backupType} backup first using: qc backup create --type=${backupType}`));
        return;
      }

      spinner.succeed(`Found ${backups.length} ${backupType} backups`);

      let selectedBackupId: string;

      // If backup ID provided as argument, use it directly
      if (backupId) {
        // Verify the backup exists and is completed
        const backup = backups.find((b: any) => (b.backupId || b.id) === backupId);
        if (!backup) {
          console.log(chalk.red(`\n❌ Backup '${backupId}' not found`));
          return;
        }
        if (backup.status !== 'completed') {
          console.log(chalk.yellow(`\n⚠ Backup '${backupId}' is not completed (status: ${backup.status})`));
          return;
        }
        selectedBackupId = backupId;
      } else {
        // Let user select which backup to download
        const choices = backups
          .filter((backup: any) => backup.status === 'completed') // Only show completed backups
          .map((backup: any, index: number) => {
            const backupId = backup.backupId || backup.id;
            const size = backup.sizeFormatted || formatBytes(backup.size || 0);
            const description = backup.description ? ` (${backup.description})` : '';
            const displayName = `${backupId}${description} - ${new Date(backup.createdAt || '').toLocaleDateString()} - ${size}`;
            
            return {
              name: displayName,
              value: backupId
            };
          });

        if (choices.length === 0) {
          console.log(chalk.yellow('No completed backups available for download.'));
          return;
        }

        const selection = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedBackupId',
            message: 'Select backup to download:',
            choices
          }
        ]);
        selectedBackupId = selection.selectedBackupId;
      }

      // Find the selected backup
      const selectedBackup = backups.find((b: any) => (b.backupId || b.id) === selectedBackupId);
      if (!selectedBackup) {
        console.log(chalk.red('\n❌ Selected backup not found'));
        return;
      }

      const downloadSpinner = createSpinner('Downloading backup...');
      
      try {
        // Step 1: Get download URL from API
        const downloadResponse = await client.backupManagementApi.downloadBackup(orgId, appId, envId, backupType, selectedBackupId);
        const downloadData = downloadResponse.data as any;
        
        if (!downloadData?.downloadUrl) {
          downloadSpinner.fail('No download URL received from API');
          console.log(chalk.red('API response:'), JSON.stringify(downloadData, null, 2));
          return;
        }

        downloadSpinner.text = 'Downloading backup file...';

        // Create output directory
        const outputDir = path.resolve(options.output || './downloads');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate filename
        const timestamp = selectedBackup?.createdAt ? 
          new Date(selectedBackup.createdAt).toISOString().split('T')[0] : 
          new Date().toISOString().split('T')[0];
        const filename = downloadData?.filename || `${(selectedBackup as any).backupId || selectedBackupId}-${timestamp}.sql.gz`;
        const filePath = path.join(outputDir, filename);

        // Step 2: Download the actual file
        await downloadFile(downloadData.downloadUrl, filePath);
        
        downloadSpinner.succeed('Backup download completed!');
        
        console.log(`\n${chalk.green('✓')} Backup downloaded successfully`);
        console.log(`File: ${chalk.cyan(filePath)}`);
        console.log(`Size: ${chalk.yellow(formatBytes(selectedBackup?.size || 0))}`);

      } catch (downloadError: any) {
        downloadSpinner.fail(`Failed to download backup: ${downloadError.message}`);
        logger.error(downloadError);
        process.exit(1);
      }

    } catch (error: any) {
      spinner.fail(`Failed to load backups: ${error.message}`);
      logger.error(error);
      process.exit(1);
    }

  } catch (error: any) {
    logger.error(`Backup download failed: ${error.message}`);
    process.exit(1);
  }
}

function getStatusIcon(status: string | undefined): string {
  switch (status) {
    case 'completed':
      return chalk.green('✓');
    case 'running':
    case 'in_progress':
      return chalk.yellow('●');
    case 'failed':
      return chalk.red('✗');
    default:
      return chalk.gray('○');
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function downloadFile(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    
    const client = url.startsWith('https:') ? https : http;
    
    const request = client.get(url, (response) => {
      // Check if response is successful
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: HTTP ${response.statusCode}`));
        return;
      }

      // Pipe the response to file
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (error) => {
      fs.unlink(filePath, () => {}); // Delete the file on error
      reject(error);
    });

    file.on('error', (error) => {
      fs.unlink(filePath, () => {}); // Delete the file on error  
      reject(error);
    });
  });
}

async function handleBackupDelete(options: BackupListOptions): Promise<void> {
  try {
    const client = await ApiClient.create({
      org: options.org,
      app: options.app,
      env: options.env,
      platform: options.platform
    });
    
    // Get target identifiers
    const orgId = options.org || client['defaultOrganizationId'];
    const appId = options.app || client['defaultApplicationId'];
    const envId = options.env || client['defaultEnvironmentId'];

    if (!orgId || !appId || !envId) {
      logger.error('Organization, application, and environment must be specified or configured');
      process.exit(1);
    }

    const backupType = (options.type || 'database') as 'database' | 'filesystem';
    const spinner = createSpinner('Loading backups...');
    
    try {
      // First, get the list of backups
      const listResponse = await client.backupManagementApi.listBackups(orgId, appId, envId, backupType);
      const backups = listResponse.data?.backups || [];
      
      if (backups.length === 0) {
        spinner.fail('No backups found');
        console.log(chalk.yellow(`Create a ${backupType} backup first using: qc backup create --type=${backupType}`));
        return;
      }

      spinner.succeed(`Found ${backups.length} ${backupType} backups`);

      // Let user select which backup to delete
      const choices = backups.map((backup: any, index: number) => {
        const backupId = backup.backupId || backup.id;
        const size = backup.sizeFormatted || formatBytes(backup.size || 0);
        const createdDate = new Date(backup.createdAt || '').toLocaleDateString();
        const displayName = `${backupId} (${createdDate}) - ${size}`;
        
        return {
          name: displayName,
          value: backupId
        };
      });

      const { selectedBackupId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedBackupId',
          message: 'Select backup to delete:',
          choices
        }
      ]);

      // Find the selected backup
      const selectedBackup = backups.find((b: any) => (b.backupId || b.id) === selectedBackupId);
      if (!selectedBackup) {
        console.log(chalk.red('\n❌ Selected backup not found'));
        return;
      }

      // Confirmation prompt
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message: `Are you sure you want to delete backup ${chalk.cyan(selectedBackupId)}? This cannot be undone.`,
          default: false
        }
      ]);

      if (!confirmDelete) {
        console.log(chalk.yellow('Backup deletion cancelled.'));
        return;
      }

      const deleteSpinner = createSpinner('Deleting backup...');
      
      try {
        // Try to call deleteBackup method - we'll need to check if this exists in the API
        await client.backupManagementApi.deleteBackup(orgId, appId, envId, backupType, selectedBackupId);
        
        deleteSpinner.succeed('Backup deleted successfully!');
        
        console.log(`\n${chalk.green('✓')} Backup deleted`);
        console.log(`ID: ${chalk.cyan(selectedBackupId)}`);

      } catch (deleteError: any) {
        deleteSpinner.fail(`Failed to delete backup: ${deleteError.message}`);
        
        // Check if it's a method not found error
        if (deleteError.message.includes('deleteBackup is not a function')) {
          console.log(chalk.yellow('\n⚠️  Delete functionality not yet available in the API client.'));
          console.log(chalk.gray('This feature may need to be added to the backend API.'));
        } else {
          logger.error(deleteError);
        }
        process.exit(1);
      }

    } catch (error: any) {
      spinner.fail(`Failed to load backups: ${error.message}`);
      logger.error(error);
      process.exit(1);
    }

  } catch (error: any) {
    logger.error(`Backup deletion failed: ${error.message}`);
    process.exit(1);
  }
}