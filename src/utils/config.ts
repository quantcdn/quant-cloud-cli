import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { AuthConfig, MultiPlatformConfig, PlatformInfo } from '../types/auth.js';
import { withFileLock } from './file-lock.js';

const CONFIG_DIR = process.env.QUANT_CONFIG_DIR || join(homedir(), '.quant');
export const CONFIG_FILE = join(CONFIG_DIR, 'credentials');
/** Every qc process holds this lock while it reads and then rewrites CONFIG_FILE. */
export const CREDENTIALS_LOCK_FILE = `${CONFIG_FILE}.lock`;
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

/**
 * Replaces the credentials file in one step: a reader sees the old file or the
 * new file, never a partial write. The file is readable by its owner only.
 */
async function writeCredentialsFile(content: string): Promise<void> {
  await ensureConfigDir();
  const temp = join(dirname(CONFIG_FILE), `.credentials.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(temp, CONFIG_FILE);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Runs a read-modify-write of the credentials file under the credentials lock. */
export async function withCredentialsLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureConfigDir();
  return withFileLock(CREDENTIALS_LOCK_FILE, fn);
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await writeCredentialsFile(JSON.stringify(config, null, 2));
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
  await writeCredentialsFile(JSON.stringify(config, null, 2));
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
  await withCredentialsLock(() => applyPlatformConfig(platformId, authConfig, platformInfo));
}

async function applyPlatformConfig(platformId: string, authConfig: AuthConfig, platformInfo: PlatformInfo): Promise<void> {
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
  return withCredentialsLock(() => applySwitchPlatform(platformId));
}

async function applySwitchPlatform(platformId: string): Promise<boolean> {
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
  return withCredentialsLock(() => applyRemovePlatform(platformId));
}

async function applyRemovePlatform(platformId: string): Promise<boolean> {
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

// Helper to save updates to a named platform
export async function savePlatformUpdates(platformId: string, updates: Partial<AuthConfig>): Promise<void> {
  await withCredentialsLock(() => applyPlatformUpdates(platformId, updates));
}

/** savePlatformUpdates for a caller that already holds the credentials lock. */
export async function applyPlatformUpdates(platformId: string, updates: Partial<AuthConfig>): Promise<void> {
  const multiConfig = await loadMultiPlatformConfig();
  const current = multiConfig.platforms[platformId];
  if (!current) {
    throw new Error(`Platform configuration not found: ${platformId}`);
  }

  const { platformInfo, ...currentAuthConfig } = current;
  multiConfig.platforms[platformId] = { ...currentAuthConfig, ...updates, platformInfo };
  await saveMultiPlatformConfig(multiConfig);
}

// Helper to save updates to the active platform
export async function saveActivePlatformConfig(updates: Partial<AuthConfig>): Promise<void> {
  const multiConfig = await loadMultiPlatformConfig();

  if (!multiConfig.activePlatform) {
    throw new Error('No active platform set');
  }

  await savePlatformUpdates(multiConfig.activePlatform, updates);
}

// Backward compatibility - update existing functions to use active platform
export async function loadAuthConfigCompat(): Promise<AuthConfig | null> {
  return await getActivePlatformConfig();
}

// VRT configuration management

// Load a VRT config from an explicit file path. Returns null if the file
// cannot be read or parsed (same null-on-failure semantics as loadVRTConfig).
export async function loadVRTConfigFrom(filePath: string): Promise<VRTConfig | null> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function loadVRTConfig(): Promise<VRTConfig | null> {
  return loadVRTConfigFrom(VRT_CONFIG_FILE);
}

export interface ResolvedVRTConfig {
  config: VRTConfig | null;
  /** Absolute path to an explicit --config file, when one was provided. */
  explicitPath?: string;
}

/**
 * Selects the VRT config source. When an explicit --config path is given it is
 * resolved against the cwd and loaded from there; otherwise the default
 * ~/.quant/vrt-config.json is used. The loaders are injectable for testing.
 */
export async function resolveVRTConfig(
  configPath: string | undefined,
  loaders: {
    loadDefault: typeof loadVRTConfig;
    loadFrom: typeof loadVRTConfigFrom;
  } = { loadDefault: loadVRTConfig, loadFrom: loadVRTConfigFrom },
  cwd: string = process.cwd()
): Promise<ResolvedVRTConfig> {
  if (configPath) {
    const explicitPath = resolve(cwd, configPath);
    const config = await loaders.loadFrom(explicitPath);
    return { config, explicitPath };
  }
  return { config: await loaders.loadDefault() };
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