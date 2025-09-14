import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadAuthConfig, saveAuthConfig } from '../utils/config.js';
import { UserInfo } from '../types/auth.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Organization');

export function orgCommand(program: Command) {
  const org = program.command('org').description('Manage organizations');
  
  org.command('list')
    .description('List available organizations')
    .action(async () => {
      await handleOrgList();
    });
  
  org.command('select')
    .description('Select active organization')
    .argument('[orgId]', 'organization ID to select')
    .action(async (orgId) => {
      await handleOrgSelect(orgId);
    });
  
  org.command('current')
    .description('Show current active organization')
    .action(async () => {
      await handleOrgCurrent();
    });
}

async function handleOrgList() {
  try {
    const auth = await loadAuthConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }

    // Fetch fresh organization data from API
    const response = await fetch(`${auth.host}/api/oauth/user`, {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.error('Failed to fetch organization data. Please re-authenticate with `quant-cloud login`.');
      return;
    }

    const userInfo = await response.json() as UserInfo;
    
    if (!userInfo.organizations || userInfo.organizations.length === 0) {
      logger.info('No organizations available.');
      return;
    }
    
    logger.info('Available organizations:');
    userInfo.organizations.forEach(org => {
      const isActive = org.machine_name === auth.activeOrganization;
      const marker = isActive ? chalk.green('*') : ' ';
      const roles = org.roles.map(r => r.display_name).join(', ');
      logger.info(`${marker} ${chalk.cyan(org.name)} (${chalk.gray(org.machine_name)})`);
      logger.info(`   ${chalk.gray('Roles:')} ${roles}`);
    });
    
    if (auth.activeOrganization) {
      const activeOrg = userInfo.organizations.find(o => o.machine_name === auth.activeOrganization);
      logger.info(`\nActive: ${chalk.green(activeOrg?.name || 'Unknown')}`);
    }

    // Update stored organizations
    auth.organizations = userInfo.organizations;
    if (!auth.activeOrganization && userInfo.organizations.length > 0) {
      auth.activeOrganization = userInfo.organizations[0].machine_name;
    }
    await saveAuthConfig(auth);

  } catch (error) {
    logger.error('Failed to list organizations:', error);
  }
}

async function handleOrgSelect(orgId?: string) {
  try {
    const auth = await loadAuthConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    if (!auth.organizations || auth.organizations.length === 0) {
      logger.info('No organizations available.');
      return;
    }
    
    if (auth.organizations.length === 1) {
      logger.info('Only one organization available - no switching needed.');
      return;
    }
    
    let targetOrgId = orgId;
    
    // If no orgId provided, show interactive selection
    if (!targetOrgId) {
      const { selectedOrgId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedOrgId',
          message: 'Select organization to switch to:',
          choices: auth.organizations.map(org => ({
            name: `${org.name} (${org.roles.map(r => r.display_name).join(', ')}) ${org.machine_name === auth.activeOrganization ? chalk.green('- current') : ''}`,
            value: org.machine_name
          }))
        }
      ]);
      targetOrgId = selectedOrgId;
    }
    
    // Validate the organization exists
    const targetOrg = auth.organizations?.find(o => o.machine_name === targetOrgId || o.id.toString() === targetOrgId);
    if (!targetOrg) {
      logger.error(`Organization '${targetOrgId}' not found.`);
      logger.info('Available organizations:');
      auth.organizations?.forEach(org => {
        logger.info(`  ${chalk.cyan(org.name)} (${chalk.gray(org.machine_name)})`);
      });
      return;
    }
    
    // Update active organization
    auth.activeOrganization = targetOrg.machine_name;
    
    // Clear application and environment context when switching organizations
    // since they are scoped to the previous organization
    auth.activeApplication = undefined;
    auth.activeEnvironment = undefined;
    
    await saveAuthConfig(auth);
    
    logger.info(`Switched to organization: ${chalk.green(targetOrg.name)} (${chalk.gray(targetOrg.machine_name)})`);
    logger.info(`${chalk.yellow('Note:')} Application and environment context cleared - use ${chalk.cyan('qc app select')} and ${chalk.cyan('qc env select')} to set new context`);
  } catch (error) {
    logger.error('Failed to switch organization:', error);
  }
}

async function handleOrgCurrent() {
  try {
    const auth = await loadAuthConfig();
    
    if (!auth || !auth.token) {
      logger.info('Not authenticated. Run `quant-cloud login` to authenticate.');
      return;
    }
    
    if (!auth.activeOrganization || !auth.organizations) {
      logger.info('No active organization set.');
      return;
    }
    
    const activeOrg = auth.organizations?.find(o => o.machine_name === auth.activeOrganization);
    if (!activeOrg) {
      logger.info('Active organization not found in available organizations.');
      return;
    }
    
    logger.info(`Active organization: ${chalk.green(activeOrg.name)}`);
    logger.info(`Machine name: ${chalk.gray(activeOrg.machine_name)}`);
    logger.info(`Your roles: ${chalk.cyan(activeOrg.roles.map(r => r.display_name).join(', '))}`);
  } catch (error) {
    logger.error('Failed to get current organization:', error);
  }
}