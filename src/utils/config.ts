import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AuthConfig, MultiPlatformConfig, PlatformInfo } from '../types/auth.js';

const CONFIG_DIR = join(homedir(), '.quant');
export const CONFIG_FILE = join(CONFIG_DIR, 'credentials');
export const VRT_CONFIG_FILE = join(CONFIG_DIR, 'vrt-config.json');

export interface VRTProjectConfig {
  url: string;
  remoteAuth?: string;
  quantAuth?: string;
}

export interface VRTProjectMapping {
  [projectMachineName: string]: string | VRTProjectConfig; // machine name -> remote URL or config object
}

export interface VRTConfig {
  projects: VRTProjectMapping;
  threshold?: number; // Default threshold (0-1)
  maxPages?: number; // Max pages to crawl per project
  maxDepth?: number; // Max crawl depth
  quantAuth?: string; // Default basic auth for Quant URLs (username:password)
  remoteAuth?: string; // Default basic auth for remote URLs (username:password)
}

export async function ensureConfigDir(): Promise<void> {
  try {
    await fs.access(CONFIG_DIR);
  } catch {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  }
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function loadAuthConfig(): Promise<AuthConfig | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function clearAuthConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_FILE);
  } catch {
    // File doesn't exist, which is fine
  }
}

// Multi-platform configuration management
export async function loadMultiPlatformConfig(): Promise<MultiPlatformConfig> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    
    // Check if it's already a multi-platform config
    if (parsed.platforms) {
      return parsed as MultiPlatformConfig;
    }
    
    // Migrate single-platform config to multi-platform
    return await migrateSinglePlatformConfig(parsed as AuthConfig);
  } catch {
    // Return empty multi-platform config
    return { platforms: {} };
  }
}

export async function saveMultiPlatformConfig(config: MultiPlatformConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function getActivePlatformConfig(): Promise<AuthConfig | null> {
  const multiConfig = await loadMultiPlatformConfig();
  
  if (!multiConfig.activePlatform) {
    return null;
  }
  
  const platformConfig = multiConfig.platforms[multiConfig.activePlatform];
  if (!platformConfig) {
    return null;
  }
  
  // Return just the AuthConfig part, excluding platformInfo
  const { platformInfo, ...authConfig } = platformConfig;
  return authConfig;
}

export async function savePlatformConfig(platformId: string, authConfig: AuthConfig, platformInfo: PlatformInfo): Promise<void> {
  const multiConfig = await loadMultiPlatformConfig();
  
  multiConfig.platforms[platformId] = {
    ...authConfig,
    platformInfo
  };
  
  // Set as active if it's the first platform or no active platform set
  if (!multiConfig.activePlatform || Object.keys(multiConfig.platforms).length === 1) {
    multiConfig.activePlatform = platformId;
  }
  
  await saveMultiPlatformConfig(multiConfig);
}

export async function switchPlatform(platformId: string): Promise<boolean> {
  const multiConfig = await loadMultiPlatformConfig();
  
  if (!multiConfig.platforms[platformId]) {
    return false;
  }
  
  multiConfig.activePlatform = platformId;
  await saveMultiPlatformConfig(multiConfig);
  return true;
}

export async function listPlatforms(): Promise<Array<{ id: string; info: PlatformInfo; isActive: boolean }>> {
  const multiConfig = await loadMultiPlatformConfig();
  
  return Object.entries(multiConfig.platforms).map(([id, config]) => ({
    id,
    info: config.platformInfo,
    isActive: multiConfig.activePlatform === id
  }));
}

export async function removePlatform(platformId: string): Promise<boolean> {
  const multiConfig = await loadMultiPlatformConfig();
  
  if (!multiConfig.platforms[platformId]) {
    return false;
  }
  
  delete multiConfig.platforms[platformId];
  
  // If we removed the active platform, clear the active platform
  if (multiConfig.activePlatform === platformId) {
    const remainingPlatforms = Object.keys(multiConfig.platforms);
    multiConfig.activePlatform = remainingPlatforms.length > 0 ? remainingPlatforms[0] : undefined;
  }
  
  await saveMultiPlatformConfig(multiConfig);
  return true;
}

// Migration helper
async function migrateSinglePlatformConfig(authConfig: AuthConfig): Promise<MultiPlatformConfig> {
  const platformInfo: PlatformInfo = generatePlatformInfo(authConfig.host);
  
  const multiConfig: MultiPlatformConfig = {
    activePlatform: platformInfo.id,
    platforms: {
      [platformInfo.id]: {
        ...authConfig,
        platformInfo
      }
    }
  };
  
  // Save the migrated config
  await saveMultiPlatformConfig(multiConfig);
  return multiConfig;
}

// Helper to generate platform info from host
function generatePlatformInfo(host: string): PlatformInfo {
  if (host.includes('quantgov.cloud')) {
    return {
      id: 'quantgov',
      name: 'QuantGov Cloud',
      host,
      description: 'Government & Enterprise Platform'
    };
  } else if (host.includes('quantcdn.io')) {
    return {
      id: 'quantcdn', 
      name: 'Quant Cloud',
      host,
      description: 'Content Delivery Platform'
    };
  } else {
    // Custom endpoint - use host as ID
    const hostId = host.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9-]/g, '-');
    return {
      id: hostId,
      name: 'Custom Endpoint',
      host,
      description: host
    };
  }
}

// Helper to save updates to the active platform
export async function saveActivePlatformConfig(updates: Partial<AuthConfig>): Promise<void> {
  const multiConfig = await loadMultiPlatformConfig();
  
  if (!multiConfig.activePlatform) {
    throw new Error('No active platform set');
  }
  
  const currentPlatformConfig = multiConfig.platforms[multiConfig.activePlatform];
  if (!currentPlatformConfig) {
    throw new Error('Active platform configuration not found');
  }
  
  // Extract current auth config and apply updates
  const { platformInfo, ...currentAuthConfig } = currentPlatformConfig;
  const updatedAuthConfig = { ...currentAuthConfig, ...updates };
  
  // Save back to multi-platform config
  multiConfig.platforms[multiConfig.activePlatform] = {
    ...updatedAuthConfig,
    platformInfo
  };
  
  await saveMultiPlatformConfig(multiConfig);
}

// Backward compatibility - update existing functions to use active platform
export async function loadAuthConfigCompat(): Promise<AuthConfig | null> {
  return await getActivePlatformConfig();
}

// VRT configuration management
export async function loadVRTConfig(): Promise<VRTConfig | null> {
  try {
    const data = await fs.readFile(VRT_CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveVRTConfig(config: VRTConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(VRT_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function addVRTProject(machineName: string, remoteUrl: string): Promise<void> {
  const config = await loadVRTConfig() || { projects: {} };
  config.projects[machineName] = remoteUrl;
  await saveVRTConfig(config);
}

export async function removeVRTProject(machineName: string): Promise<boolean> {
  const config = await loadVRTConfig();
  if (!config || !config.projects[machineName]) {
    return false;
  }
  delete config.projects[machineName];
  await saveVRTConfig(config);
  return true;
}