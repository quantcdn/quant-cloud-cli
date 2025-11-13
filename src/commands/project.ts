import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSpinner } from '../utils/spinner.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { getActivePlatformConfig, saveActivePlatformConfig } from '../utils/config.js';

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
  
  project.command('select')
    .description('Select active project')
    .argument('[projectName]', 'project name to select')
    .option('--org <org>', 'override organization')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (projectName, options) => {
      await handleProjectSelect(projectName, options);
    });
  
  project.command('current')
    .description('Show current active project')
    .action(async () => {
      await handleProjectCurrent();
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

async function handleProjectSelect(projectName?: string, options?: ProjectOptions) {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    const spinner = createSpinner('Loading projects...');
    const client = await ApiClient.create({
      org: options?.org,
      platform: options?.platform
    });
    
    const projects = await client.getProjects({ organizationId: options?.org });
    spinner.succeed(`Found ${projects.length} project${projects.length !== 1 ? 's' : ''}`);
    
    if (projects.length === 0) {
      logger.info('No projects found in this organization.');
      return;
    }
    
    let targetProjectName = projectName;
    
    // If no project name provided, show interactive selection
    if (!targetProjectName) {
      if (projects.length === 1) {
        targetProjectName = projects[0].machine_name || projects[0].name;
        logger.info(`Only one project available: ${chalk.cyan(targetProjectName)}`);
      } else {
        const { selectedProjectName } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedProjectName',
            message: 'Select project:',
            choices: projects.map((proj: any) => ({
              name: `${chalk.cyan(proj.machine_name || proj.name)} ${proj.name && proj.name !== proj.machine_name ? chalk.gray(`(${proj.name})`) : ''} ${proj.domain ? `- ${chalk.blue(proj.domain)}` : ''}`,
              value: proj.machine_name || proj.name
            }))
          }
        ]);
        targetProjectName = selectedProjectName;
      }
    }
    
    // Validate the project exists
    const targetProject = projects.find((p: any) => 
      p.machine_name === targetProjectName || p.name === targetProjectName
    );
    
    if (!targetProject) {
      logger.error(`Project '${targetProjectName}' not found.`);
      logger.info('Available projects:');
      projects.forEach((proj: any) => {
        logger.info(`  ${chalk.cyan(proj.machine_name || proj.name)}`);
      });
      return;
    }
    
    // Save the selected project
    await saveActivePlatformConfig({
      activeProject: targetProject.machine_name || targetProject.name
    });
    
    const displayName = targetProject.name || targetProject.machine_name;
    logger.info(`Selected project: ${chalk.green(displayName)}`);
    
    if (targetProject.domain) {
      logger.info(`URL: ${chalk.blue(targetProject.domain)}`);
    }
    
  } catch (error: any) {
    logger.error('Failed to select project:', error.message);
  }
}

async function handleProjectCurrent() {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    if (!auth.activeProject) {
      logger.info('No active project set.');
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud project select')} ${chalk.gray('to select a project')}`);
      return;
    }
    
    try {
      // Get fresh project data from API
      const spinner = createSpinner('Loading project data...');
      const client = await ApiClient.create();
      
      const projects = await client.getProjects();
      spinner.succeed('Loaded project data');
      
      const activeProject = projects.find((p: any) => 
        p.machine_name === auth.activeProject || p.name === auth.activeProject
      );
      
      if (!activeProject) {
        logger.info('Active project not found in current organization.');
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud project list')} ${chalk.gray('to see available projects')}`);
        return;
      }
      
      logger.info(`Active project: ${chalk.green(activeProject.name || activeProject.machine_name)}`);
      logger.info(`Machine name: ${chalk.gray(activeProject.machine_name)}`);
      
      if (activeProject.domain || activeProject.url || activeProject.aws_cloudfront_domain_name) {
        const domain = activeProject.domain || activeProject.url || activeProject.aws_cloudfront_domain_name;
        logger.info(`URL: ${chalk.blue(domain)}`);
      }
      
      if (activeProject.region) {
        logger.info(`Region: ${chalk.gray(activeProject.region)}`);
      }
      
    } catch (error) {
      // Fallback to showing just stored data
      logger.info(`Active project: ${chalk.green(auth.activeProject)}`);
      logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud project list')} ${chalk.gray('to refresh project data')}`);
    }
    
  } catch (error: any) {
    logger.error('Failed to get current project:', error.message);
  }
}

