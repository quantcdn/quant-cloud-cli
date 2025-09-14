import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AuthConfig } from '../types/auth.js';

const CONFIG_DIR = join(homedir(), '.quant');
export const CONFIG_FILE = join(CONFIG_DIR, 'credentials');

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