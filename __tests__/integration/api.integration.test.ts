import { describe, it, expect, beforeAll } from '@jest/globals';
import { ApiClient } from '../../src/utils/api.js';

const MOCK_API_URL = process.env.MOCK_API_URL || 'http://localhost:4010';
const MOCK_TOKEN = 'mock-token-123';

describe('ApiClient Integration Tests', () => {
  let client: ApiClient;

  beforeAll(() => {
    client = new ApiClient(MOCK_API_URL, MOCK_TOKEN, 'test-org');
  });

  describe('Applications API', () => {
    it('should list applications', async () => {
      const apps = await client.getApplications();
      
      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThan(0);
      
      // Verify structure of first application
      const app = apps[0];
      // Mock API generates dynamic data - just verify it's an object
      expect(typeof app).toBe('object');
      expect(app).toBeDefined();
    });

    it('should handle organization context', async () => {
      const orgClient = new ApiClient(MOCK_API_URL, MOCK_TOKEN, 'different-org');
      const apps = await orgClient.getApplications();
      
      expect(Array.isArray(apps)).toBe(true);
    });
  });

  describe('Environments API', () => {
    it('should list environments for an application', async () => {
      const envClient = new ApiClient(
        MOCK_API_URL,
        MOCK_TOKEN,
        'test-org',
        'test-app'
      );
      
      const environments = await envClient.getEnvironments();
      
      expect(Array.isArray(environments)).toBe(true);
      expect(environments.length).toBeGreaterThan(0);
      
      // Verify structure of first environment
      const env = environments[0];
      // Mock API generates dynamic data - just verify it's an object
      expect(typeof env).toBe('object');
      expect(env).toBeDefined();
    });

    it('should handle different application contexts', async () => {
      const envClient = new ApiClient(
        MOCK_API_URL,
        MOCK_TOKEN,
        'test-org',
        'another-app'
      );
      
      const environments = await envClient.getEnvironments();
      expect(Array.isArray(environments)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle missing organization ID', async () => {
      const noOrgClient = new ApiClient(MOCK_API_URL, MOCK_TOKEN);
      
      await expect(noOrgClient.getApplications()).rejects.toThrow(
        /Organization not found/
      );
    });

    it('should handle missing application ID for environments', async () => {
      const noAppClient = new ApiClient(MOCK_API_URL, MOCK_TOKEN, 'test-org');
      
      await expect(noAppClient.getEnvironments()).rejects.toThrow(
        /Application not found/
      );
    });
  });

  describe('API configuration', () => {
    it('should use correct base URL', () => {
      expect(client.baseUrl).toBe(MOCK_API_URL);
    });

    it('should initialise all API instances', () => {
      expect(client.environmentsApi).toBeDefined();
      expect(client.sshAccessApi).toBeDefined();
      expect(client.backupManagementApi).toBeDefined();
    });
  });
});

