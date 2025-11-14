import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSpinner } from '../utils/spinner.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { getActivePlatformConfig } from '../utils/config.js';

const logger = new Logger('Crawler');

export function crawlerCommand(program: Command) {
  const crawler = program.command('crawler').description('Manage Quant crawlers');
  
  crawler.command('run')
    .description('Run a crawler')
    .argument('[crawlerId]', 'crawler ID to run')
    .option('--project <project>', 'project name (if not using active project)')
    .option('--urls <urls...>', 'specific URLs to crawl (space-separated)')
    .option('--org <org>', 'override organization')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (crawlerId, options) => {
      await handleCrawlerRun(crawlerId, options);
    });
  
  crawler.command('list')
    .description('List crawlers for a project')
    .option('--project <project>', 'project name (if not using active project)')
    .option('--org <org>', 'override organization')
    .option('--platform <platform>', 'platform to use (override active platform)')
    .action(async (options) => {
      await handleCrawlerList(options);
    });
  
  return crawler;
}

interface CrawlerOptions {
  project?: string;
  urls?: string[];
  org?: string;
  platform?: string;
}

async function handleCrawlerRun(crawlerId?: string, options?: CrawlerOptions) {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Create API client
    const client = await ApiClient.create({
      org: options?.org,
      platform: options?.platform
    });

    // Get project name - prefer option, fallback to active project
    let projectName = options?.project || auth.activeProject;
    
    if (!projectName) {
      // Try to get from active project context or prompt user
      const projects = await client.getProjects();
      
      if (projects.length === 0) {
        logger.error('No projects found.');
        return;
      }

      if (projects.length === 1) {
        projectName = projects[0].name || projects[0].machine_name;
        logger.info(`Using project: ${chalk.cyan(projectName)}`);
      } else {
        const { selectedProject } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedProject',
            message: 'Select a project:',
            choices: projects.map((p: any) => ({
              name: `${p.name || p.machine_name} ${p.url ? chalk.gray(`(${p.url})`) : ''}`,
              value: p.name || p.machine_name
            }))
          }
        ]);
        projectName = selectedProject;
      }
    }

    // Ensure we have a project name at this point
    if (!projectName) {
      logger.error('Project name is required');
      return;
    }

    // Get crawler ID if not provided
    if (!crawlerId) {
      const spinner = createSpinner('Fetching crawlers...');
      const crawlers = await client.getCrawlers(projectName);
      spinner.succeed(`Found ${crawlers.length} crawler(s)`);

      if (crawlers.length === 0) {
        logger.error(`No crawlers found for project '${projectName}'.`);
        return;
      }

      if (crawlers.length === 1) {
        crawlerId = crawlers[0].uuid || crawlers[0].machine_name;
        logger.info(`Using crawler: ${chalk.cyan(crawlerId)}`);
      } else {
        const { selectedCrawler } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedCrawler',
            message: 'Select a crawler:',
            choices: crawlers.map((c: any) => ({
              name: `${c.name || c.machine_name} ${c.description ? chalk.gray(`(${c.description})`) : ''}`,
              value: c.uuid || c.machine_name
            }))
          }
        ]);
        crawlerId = selectedCrawler;
      }
    }

    // Ensure we have crawlerId at this point
    if (!crawlerId) {
      logger.error('Crawler ID is required');
      return;
    }

    // Run the crawler
    const spinner = createSpinner(`Running crawler '${crawlerId}'...`);
    const result = await client.runCrawler(projectName, crawlerId, options?.urls);
    
    if (result.run_id) {
      spinner.succeed(`Crawler run started successfully`);
      logger.info(`Run ID: ${chalk.green(result.run_id)}`);
      logger.info(`Project: ${chalk.cyan(projectName)}`);
      logger.info(`Crawler: ${chalk.cyan(crawlerId)}`);
      
      if (options?.urls && options.urls.length > 0) {
        logger.info(`URLs: ${chalk.gray(options.urls.join(', '))}`);
      }
    } else {
      spinner.succeed(`Crawler run started`);
      logger.info(`Project: ${chalk.cyan(projectName)}`);
      logger.info(`Crawler: ${chalk.cyan(crawlerId)}`);
    }

  } catch (error: any) {
    logger.error('Failed to run crawler:', error.message);
    process.exit(1);
  }
}

async function handleCrawlerList(options?: CrawlerOptions) {
  try {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Create API client
    const client = await ApiClient.create({
      org: options?.org,
      platform: options?.platform
    });

    // Get project name - prefer option, fallback to active project
    let projectName = options?.project || auth.activeProject;
    
    if (!projectName) {
      const projects = await client.getProjects();
      
      if (projects.length === 0) {
        logger.error('No projects found.');
        return;
      }

      if (projects.length === 1) {
        projectName = projects[0].name || projects[0].machine_name;
        logger.info(`Using project: ${chalk.cyan(projectName)}`);
      } else {
        const { selectedProject } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedProject',
            message: 'Select a project:',
            choices: projects.map((p: any) => ({
              name: `${p.name || p.machine_name} ${p.url ? chalk.gray(`(${p.url})`) : ''}`,
              value: p.name || p.machine_name
            }))
          }
        ]);
        projectName = selectedProject;
      }
    }

    // Ensure we have a project name at this point
    if (!projectName) {
      logger.error('Project name is required');
      return;
    }

    // Get crawlers
    const spinner = createSpinner('Fetching crawlers...');
    const crawlers = await client.getCrawlers(projectName);
    spinner.succeed(`Found ${crawlers.length} crawler(s) for project '${projectName}'`);

    if (crawlers.length === 0) {
      logger.info(`No crawlers found for project '${projectName}'.`);
      return;
    }

    // Display crawlers
    logger.info(`\n${chalk.bold(`Crawlers for project: ${chalk.cyan(projectName)}`)}`);
    crawlers.forEach((crawler: any) => {
      const uuid = crawler.uuid || crawler.machine_name;
      const name = crawler.name || uuid;
      const description = crawler.description ? chalk.gray(` - ${crawler.description}`) : '';
      
      logger.info(`  ${chalk.green('•')} ${chalk.cyan(uuid)} ${name !== uuid ? chalk.white(`(${name})`) : ''}${description}`);
      
      if (crawler.url) {
        logger.info(`    ${chalk.gray('URL:')} ${crawler.url}`);
      }
      
      if (crawler.status) {
        logger.info(`    ${chalk.gray('Status:')} ${crawler.status}`);
      }
      
      if (crawler.schedule) {
        logger.info(`    ${chalk.gray('Schedule:')} ${crawler.schedule}`);
      }
    });

  } catch (error: any) {
    logger.error('Failed to list crawlers:', error.message);
    process.exit(1);
  }
}

