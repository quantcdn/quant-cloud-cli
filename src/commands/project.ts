import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../utils/spinner.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Project');

export function projectCommand(program: Command) {
  const project = program.command('project').description('Manage Quant projects');
  
  project.command('list')
    .description('List projects in the active organization')
    .option('--org <org>', 'override organization')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (options) => {
      await handleProjectList(options);
    });
  
  return project;
}

interface ProjectOptions {
  org?: string;
  platform?: string;
}

async function handleProjectList(options: ProjectOptions) {
  const spinner = createSpinner('Loading projects...');
  
  try {
    const client = await ApiClient.create({
      org: options.org,
      platform: options.platform
    });
    const projects = await client.getProjects({ organizationId: options.org });
    
    spinner.succeed(`Found ${projects.length} project${projects.length !== 1 ? 's' : ''}`);
    
    if (projects.length === 0) {
      logger.info('No projects found in this organization.');
      logger.info(`${chalk.gray('Create your first project in the dashboard')}`);
      return;
    }
    
    logger.info('\nProjects:');
    projects.forEach((project: any, index) => {
      const name = project.name || project.machine_name;
      const machineName = project.machine_name;
      const domain = project.domain || project.url || project.aws_cloudfront_domain_name;
      
      // Compact format: machine_name (name) - domain
      let displayLine = `  ${chalk.cyan(machineName)}`;
      
      if (name !== machineName) {
        displayLine += ` ${chalk.gray(`(${name})`)}`;
      }
      
      if (domain) {
        displayLine += ` - ${chalk.blue(domain)}`;
      }
      
      if (project.region) {
        displayLine += ` ${chalk.gray(`[${project.region}]`)}`;
      }
      
      logger.info(displayLine);
    });
    
    // Show context
    const orgInfo = options.org ? ` (org: ${options.org})` : ' (active organization)';
    logger.info(`\n${chalk.gray('Showing projects for')}${orgInfo}`);
    
  } catch (error: any) {
    spinner.fail('Failed to load projects');
    
    if (error.message?.includes('Not authenticated')) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
    } else if (error.message?.includes('404') || error.message?.includes('not found')) {
      logger.error('Organization not found or no access to projects.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org list')} ${chalk.gray('to see available organizations')}`);
    } else if (error.message?.includes('403') || error.message?.includes('forbidden')) {
      logger.error('Access denied. You may not have permission to view projects in this organization.');
    } else {
      logger.error('Error:', error.message);
      logger.debug('Full error:', error);
    }
  }
}

