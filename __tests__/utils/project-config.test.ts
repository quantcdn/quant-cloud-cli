import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  findProjectConfigFile,
  loadProjectConfig,
  getProjectConfig
} from '../../src/utils/project-config.js';

describe('Project Config utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique test directory
    testDir = join(tmpdir(), `quant-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe('findProjectConfigFile', () => {
    it('should find .quant.yml in current directory', async () => {
      const configPath = join(testDir, '.quant.yml');
      await fs.writeFile(configPath, 'platform: quantcdn', 'utf8');

      const found = findProjectConfigFile(testDir);
      expect(found).toBe(configPath);
    });

    it('should find .quant.yml in parent directory', async () => {
      const subDir = join(testDir, 'subdir');
      await fs.mkdir(subDir, { recursive: true });

      const configPath = join(testDir, '.quant.yml');
      await fs.writeFile(configPath, 'platform: quantcdn', 'utf8');

      const found = findProjectConfigFile(subDir);
      expect(found).toBe(configPath);
    });

    it('should return null when no .quant.yml found', () => {
      const found = findProjectConfigFile(testDir);
      expect(found).toBeNull();
    });

    it('should stop at git root', async () => {
      const gitDir = join(testDir, '.git');
      await fs.mkdir(gitDir, { recursive: true });

      const subDir = join(testDir, 'subdir');
      await fs.mkdir(subDir, { recursive: true });

      // Put config above git root
      const parentDir = join(testDir, '..');
      const configPath = join(parentDir, '.quant.yml');
      
      const found = findProjectConfigFile(subDir);
      // Should not find config above git root
      expect(found).toBeNull();
    });
  });

  describe('loadProjectConfig', () => {
    it('should load valid YAML config', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
platform: quantcdn
org: my-org
app: my-app
env: production
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const config = loadProjectConfig(configPath);
      
      expect(config).toEqual({
        platform: 'quantcdn',
        org: 'my-org',
        app: 'my-app',
        env: 'production'
      });
    });

    it('should handle partial config', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
org: my-org
app: my-app
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const config = loadProjectConfig(configPath);
      
      expect(config).toEqual({
        org: 'my-org',
        app: 'my-app'
      });
    });

    it('should return empty object for invalid YAML', async () => {
      const configPath = join(testDir, '.quant.yml');
      await fs.writeFile(configPath, 'invalid: yaml: content:', 'utf8');

      const config = loadProjectConfig(configPath);
      expect(config).toEqual({});
    });

    it('should return empty object for non-existent file', () => {
      const configPath = join(testDir, 'nonexistent.yml');
      const config = loadProjectConfig(configPath);
      expect(config).toEqual({});
    });

    it('should ignore non-string values', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
platform: quantcdn
org: 123
app: true
env: production
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const config = loadProjectConfig(configPath);
      
      // Only string values should be included
      expect(config).toEqual({
        platform: 'quantcdn',
        env: 'production'
      });
    });

    it('should ignore unknown fields', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
platform: quantcdn
org: my-org
unknown_field: some-value
another_field: 123
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const config = loadProjectConfig(configPath);
      
      expect(config).toEqual({
        platform: 'quantcdn',
        org: 'my-org'
      });
      expect(config).not.toHaveProperty('unknown_field');
      expect(config).not.toHaveProperty('another_field');
    });

    it('should handle empty file', async () => {
      const configPath = join(testDir, '.quant.yml');
      await fs.writeFile(configPath, '', 'utf8');

      const config = loadProjectConfig(configPath);
      expect(config).toEqual({});
    });
  });

  describe('getProjectConfig', () => {
    it('should find and load config', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
platform: quantcdn
org: my-org
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const config = getProjectConfig(testDir);
      
      expect(config).toEqual({
        platform: 'quantcdn',
        org: 'my-org'
      });
    });

    it('should return empty object when no config found', () => {
      const config = getProjectConfig(testDir);
      expect(config).toEqual({});
    });

    it('should work from subdirectory', async () => {
      const configPath = join(testDir, '.quant.yml');
      const configContent = `
platform: quantcdn
org: my-org
`;
      await fs.writeFile(configPath, configContent, 'utf8');

      const subDir = join(testDir, 'deep', 'nested', 'path');
      await fs.mkdir(subDir, { recursive: true });

      const config = getProjectConfig(subDir);
      
      expect(config).toEqual({
        platform: 'quantcdn',
        org: 'my-org'
      });
    });
  });
});

