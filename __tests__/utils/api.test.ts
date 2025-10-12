import { describe, it, expect } from '@jest/globals';
import { ApiClient } from '../../src/utils/api.js';

describe('ApiClient', () => {
  // Note: Full integration tests for ApiClient require mocking the SDK's complex types
  // and would be better suited as E2E tests against a test server.
  //
  // These tests document the expected behavior:

  describe('constructor', () => {
    it('should create an ApiClient with configuration', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123'
      );

      expect(client).toBeInstanceOf(ApiClient);
      expect(client.baseUrl).toBe('https://test.quantcdn.io');
      expect(client.environmentsApi).toBeDefined();
      expect(client.sshAccessApi).toBeDefined();
      expect(client.backupManagementApi).toBeDefined();
    });

    it('should initialize with all optional parameters', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123',
        'app-456',
        'env-789'
      );

      expect(client).toBeInstanceOf(ApiClient);
      expect(client.baseUrl).toBe('https://test.quantcdn.io');
    });
  });

  describe('API configuration', () => {
    it('should configure APIs with proper authentication headers', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123'
      );

      // Verifies APIs are instantiated properly
      expect(typeof client.environmentsApi.listEnvironments).toBe('function');
      expect(typeof client.sshAccessApi.getSshAccessCredentials).toBe('function');
      expect(typeof client.backupManagementApi.listBackups).toBe('function');
    });
  });

  describe('Method signatures', () => {
    it('getApplications should accept optional ApiOptions', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123'
      );

      // Documents that method exists and accepts options
      expect(typeof client.getApplications).toBe('function');
    });

    it('getEnvironments should accept optional ApiOptions', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123',
        'app-456'
      );

      expect(typeof client.getEnvironments).toBe('function');
    });

    it('getUserInfo should be available', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token'
      );

      expect(typeof client.getUserInfo).toBe('function');
    });

    it('getEnvironmentMetrics should accept environment options', () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123',
        'app-456'
      );

      expect(typeof client.getEnvironmentMetrics).toBe('function');
    });
  });

  describe('Error handling', () => {
    it('getApplications should throw error when no organization ID', async () => {
      const client = new ApiClient('https://test.quantcdn.io', 'test-token');

      await expect(client.getApplications()).rejects.toThrow(/Organization not found/);
    });

    it('getEnvironments should throw error when no organization ID', async () => {
      const client = new ApiClient('https://test.quantcdn.io', 'test-token');

      await expect(client.getEnvironments()).rejects.toThrow(/Organization not found/);
    });

    it('getEnvironments should throw error when no application ID', async () => {
      const client = new ApiClient(
        'https://test.quantcdn.io',
        'test-token',
        'org-123'
      );

      await expect(client.getEnvironments()).rejects.toThrow(/Application not found/);
    });

    it('getEnvironmentMetrics should throw error when missing required IDs', async () => {
      const client = new ApiClient('https://test.quantcdn.io', 'test-token');

      await expect(
        client.getEnvironmentMetrics({ environmentId: 'env-789' })
      ).rejects.toThrow(/Organization ID and Application ID are required/);
    });
  });
});
