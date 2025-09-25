import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import yaml from 'js-yaml';
import { Logger } from './logger.js';

const logger = new Logger('ProjectConfig');

export interface ProjectConfig {
  platform?: string;
  org?: string;
  app?: string;
  env?: string;
}

/**
 * Finds .quant.yml file by walking up the directory tree
 * Stops at git root or filesystem root
 */
export function findProjectConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = resolve(startDir);
  const rootDir = resolve('/');
  
  logger.debug(`Looking for .quant.yml starting from: ${currentDir}`);
  
  while (currentDir !== rootDir) {
    const configPath = join(currentDir, '.quant.yml');
    
    logger.debug(`Checking for config at: ${configPath}`);
    
    if (existsSync(configPath)) {
      logger.debug(`Found .quant.yml at: ${configPath}`);
      return configPath;
    }
    
    // Check if we're at a git root - if so, stop here even if no config found
    const gitPath = join(currentDir, '.git');
    if (existsSync(gitPath)) {
      logger.debug(`Reached git root at: ${currentDir}, stopping search`);
      break;
    }
    
    // Move up one directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  
  logger.debug('No .quant.yml file found');
  return null;
}

/**
 * Loads and parses a .quant.yml file
 */
export function loadProjectConfig(configPath: string): ProjectConfig {
  try {
    logger.debug(`Loading project config from: ${configPath}`);
    
    const fileContent = readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContent) as any;
    
    if (!parsed || typeof parsed !== 'object') {
      logger.warn(`Invalid .quant.yml format at ${configPath}: expected object`);
      return {};
    }
    
    const config: ProjectConfig = {};
    
    // Extract supported fields
    if (parsed.platform && typeof parsed.platform === 'string') {
      config.platform = parsed.platform;
    }
    if (parsed.org && typeof parsed.org === 'string') {
      config.org = parsed.org;
    }
    if (parsed.app && typeof parsed.app === 'string') {
      config.app = parsed.app;
    }
    if (parsed.env && typeof parsed.env === 'string') {
      config.env = parsed.env;
    }
    
    logger.debug(`Loaded project config:`, config);
    
    return config;
  } catch (error: any) {
    logger.warn(`Failed to load .quant.yml from ${configPath}: ${error.message}`);
    return {};
  }
}

/**
 * Finds and loads project config from .quant.yml
 * Returns empty object if no config found or error occurs
 */
export function getProjectConfig(startDir?: string): ProjectConfig {
  const configPath = findProjectConfigFile(startDir);
  
  if (!configPath) {
    return {};
  }
  
  const config = loadProjectConfig(configPath);
  
  // Log when project config is being used
  const hasConfig = Object.keys(config).length > 0;
  if (hasConfig) {
    const configSummary = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    logger.debug(`Using project config: ${configSummary}`);
  }
  
  return config;
}