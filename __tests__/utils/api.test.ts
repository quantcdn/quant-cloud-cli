import { describe, it, expect, jest, beforeEach, beforeAll, afterEach } from '@jest/globals';
import type { ApiClient as ApiClientType } from '../../src/utils/api.js';

// Create typed mock functions
const mockListApplications = jest.fn<(...args: any[]) => any>();
const mockListEnvironments = jest.fn<(...args: any[]) => any>();
const mockGetEnvironmentMetrics = jest.fn<(...args: any[]) => any>();
const mockGetEnvironmentLogs = jest.fn<(...args: any[]) => any>();
const mockGetSshAccessCredentials = jest.fn<(...args: any[]) => any>();
const mockListBackups = jest.fn<(...args: any[]) => any>();
const mockProjectsList = jest.fn<(...args: any[]) => any>();
const mockProjectsRead = jest.fn<(...args: any[]) => any>();
const mockCrawlersList = jest.fn<(...args: any[]) => any>();
const mockCrawlersRun = jest.fn<(...args: any[]) => any>();

// Mock the SDK module before importing
jest.unstable_mockModule('@quantcdn/quant-client', () => ({
  Configuration: jest.fn(),
  ApplicationsApi: jest.fn().mockImplementation(() => ({
    listApplications: mockListApplications,
  })),
  EnvironmentsApi: jest.fn().mockImplementation(() => ({
    listEnvironments: mockListEnvironments,
    getEnvironmentMetrics: mockGetEnvironmentMetrics,
    getEnvironmentLogs: mockGetEnvironmentLogs,
  })),
  SSHAccessApi: jest.fn().mockImplementation(() => ({
    getSshAccessCredentials: mockGetSshAccessCredentials,
  })),
  BackupManagementApi: jest.fn().mockImplementation(() => ({
    listBackups: mockListBackups,
  })),
  ProjectsApi: jest.fn().mockImplementation(() => ({
    projectsList: mockProjectsList,
    projectsRead: mockProjectsRead,
  })),
  CrawlersApi: jest.fn().mockImplementation(() => ({
    crawlersList: mockCrawlersList,
    crawlersRun: mockCrawlersRun,
  })),
}));

let ApiClient: typeof ApiClientType;

beforeAll(async () => {
  const mod = await import('../../src/utils/api.js');
  ApiClient = mod.ApiClient;
});

describe('ApiClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an ApiClient with required parameters', () => {
      const client = new ApiClient('https://api.quantcdn.io', 'test-token');
      expect(client).toBeInstanceOf(ApiClient);
      expect(client.baseUrl).toBe('https://api.quantcdn.io');
    });

    it('should expose public API instances', () => {
      const client = new ApiClient('https://api.quantcdn.io', 'test-token', 'org-1');
      expect(client.environmentsApi).toBeDefined();
      expect(client.sshAccessApi).toBeDefined();
      expect(client.backupManagementApi).toBeDefined();
      expect(client.crawlersApi).toBeDefined();
    });
  });

  describe('getApplications', () => {
    it('should return applications using default org ID', async () => {
      const apps = [{ name: 'app-1' }, { name: 'app-2' }];
      mockListApplications.mockResolvedValue({ data: apps });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getApplications();

      expect(result).toEqual(apps);
      expect(mockListApplications).toHaveBeenCalledWith('org-1');
    });

    it('should use override org ID from apiOptions', async () => {
      const apps = [{ name: 'app-1' }];
      mockListApplications.mockResolvedValue({ data: apps });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getApplications({ organizationId: 'org-override' });

      expect(result).toEqual(apps);
      expect(mockListApplications).toHaveBeenCalledWith('org-override');
    });

    it('should throw when no organization ID available', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getApplications()).rejects.toThrow(/Organization not found/);
    });

    it('should throw friendly error on 404', async () => {
      mockListApplications.mockRejectedValue({ statusCode: 404 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getApplications()).rejects.toThrow(/not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockListApplications.mockRejectedValue({ statusCode: 403 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getApplications()).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockListApplications.mockRejectedValue({ statusCode: 401 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getApplications()).rejects.toThrow(/Authentication expired/);
    });

    it('should throw generic error for other failures', async () => {
      mockListApplications.mockRejectedValue(new Error('Network timeout'));

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getApplications()).rejects.toThrow(/Failed to fetch applications/);
    });
  });

  describe('getEnvironments', () => {
    it('should return environments using default org and app IDs', async () => {
      const envs = [{ envName: 'staging' }, { envName: 'production' }];
      mockListEnvironments.mockResolvedValue({ data: envs });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      const result = await client.getEnvironments();

      expect(result).toEqual(envs);
      expect(mockListEnvironments).toHaveBeenCalledWith('org-1', 'app-1');
    });

    it('should use override IDs from apiOptions', async () => {
      const envs = [{ envName: 'staging' }];
      mockListEnvironments.mockResolvedValue({ data: envs });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      const result = await client.getEnvironments({
        organizationId: 'org-2',
        applicationId: 'app-2',
      });

      expect(result).toEqual(envs);
      expect(mockListEnvironments).toHaveBeenCalledWith('org-2', 'app-2');
    });

    it('should throw when no organization ID available', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getEnvironments()).rejects.toThrow(/Organization not found/);
    });

    it('should throw when no application ID available', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getEnvironments()).rejects.toThrow(/Application not found/);
    });

    it('should throw friendly error on 404 with application not found', async () => {
      mockListEnvironments.mockRejectedValue({
        statusCode: 404,
        body: { message: 'Application app-1 not found' },
      });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(client.getEnvironments()).rejects.toThrow(/Application.*not found/);
    });

    it('should throw friendly error on 404 without application message', async () => {
      mockListEnvironments.mockRejectedValue({ statusCode: 404 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(client.getEnvironments()).rejects.toThrow(/Organization.*not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockListEnvironments.mockRejectedValue({ statusCode: 403 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(client.getEnvironments()).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockListEnvironments.mockRejectedValue({ statusCode: 401 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(client.getEnvironments()).rejects.toThrow(/Authentication expired/);
    });
  });

  describe('getUserInfo', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should fetch user info from OAuth endpoint', async () => {
      const userInfo = { name: 'Test User', email: 'test@example.com', organizations: ['org-1'] };
      globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(userInfo),
      } as Response);

      const client = new ApiClient('https://api.quantcdn.io', 'my-token');
      const result = await client.getUserInfo();

      expect(result).toEqual(userInfo);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.quantcdn.io/api/oauth/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer my-token',
          }),
        }),
      );
    });

    it('should throw on 401 response', async () => {
      globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getUserInfo()).rejects.toThrow(/Authentication expired/);
    });

    it('should throw on 403 response', async () => {
      globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getUserInfo()).rejects.toThrow(/Access denied/);
    });

    it('should throw on other HTTP errors', async () => {
      globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getUserInfo()).rejects.toThrow(/Failed to get user info.*500/);
    });

    it('should throw on network failure', async () => {
      globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('fetch failed'));

      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getUserInfo()).rejects.toThrow(/Failed to get user info.*fetch failed/);
    });
  });

  describe('getEnvironmentMetrics', () => {
    it('should fetch metrics with default org and app IDs', async () => {
      const metrics = { cpu: 50, memory: 1024 };
      mockGetEnvironmentMetrics.mockResolvedValue({ data: metrics });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      const result = await client.getEnvironmentMetrics({ environmentId: 'env-1' });

      expect(result).toEqual(metrics);
      expect(mockGetEnvironmentMetrics).toHaveBeenCalledWith('org-1', 'app-1', 'env-1');
    });

    it('should use override IDs', async () => {
      const metrics = { cpu: 75 };
      mockGetEnvironmentMetrics.mockResolvedValue({ data: metrics });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      const result = await client.getEnvironmentMetrics({
        organizationId: 'org-2',
        applicationId: 'app-2',
        environmentId: 'env-2',
      });

      expect(result).toEqual(metrics);
      expect(mockGetEnvironmentMetrics).toHaveBeenCalledWith('org-2', 'app-2', 'env-2');
    });

    it('should throw when missing org or app ID', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(
        client.getEnvironmentMetrics({ environmentId: 'env-1' })
      ).rejects.toThrow(/Organization ID and Application ID are required/);
    });

    it('should throw friendly error on 404', async () => {
      mockGetEnvironmentMetrics.mockRejectedValue({ statusCode: 404 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(
        client.getEnvironmentMetrics({ environmentId: 'env-1' })
      ).rejects.toThrow(/not found.*metrics unavailable/);
    });

    it('should throw friendly error on 401', async () => {
      mockGetEnvironmentMetrics.mockRejectedValue({ statusCode: 401 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(
        client.getEnvironmentMetrics({ environmentId: 'env-1' })
      ).rejects.toThrow(/Authentication expired/);
    });

    it('should throw friendly error on 403', async () => {
      mockGetEnvironmentMetrics.mockRejectedValue({ statusCode: 403 });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1', 'app-1');
      await expect(
        client.getEnvironmentMetrics({ environmentId: 'env-1' })
      ).rejects.toThrow(/Access denied/);
    });
  });

  describe('getProjects', () => {
    it('should return projects using default org ID', async () => {
      const projects = [{ machine_name: 'proj-1' }, { machine_name: 'proj-2' }];
      mockProjectsList.mockResolvedValue({ data: projects });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getProjects();

      expect(result).toEqual(projects);
      expect(mockProjectsList).toHaveBeenCalledWith('org-1');
    });

    it('should use override org ID', async () => {
      const projects = [{ machine_name: 'proj-1' }];
      mockProjectsList.mockResolvedValue({ data: projects });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getProjects({ organizationId: 'org-override' });

      expect(result).toEqual(projects);
      expect(mockProjectsList).toHaveBeenCalledWith('org-override');
    });

    it('should throw when no organization ID', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getProjects()).rejects.toThrow(/Organization not found/);
    });

    it('should throw friendly error on 404', async () => {
      mockProjectsList.mockRejectedValue({ statusCode: 404, response: { status: 404 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjects()).rejects.toThrow(/not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockProjectsList.mockRejectedValue({ statusCode: 403, response: { status: 403 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjects()).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockProjectsList.mockRejectedValue({ statusCode: 401, response: { status: 401 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjects()).rejects.toThrow(/Authentication expired/);
    });
  });

  describe('getProjectDetails', () => {
    it('should fetch project details with withToken=false', async () => {
      const project = { machine_name: 'proj-1', domain: 'example.com' };
      mockProjectsRead.mockResolvedValue({ data: project });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getProjectDetails('proj-1');

      expect(result).toEqual(project);
      expect(mockProjectsRead).toHaveBeenCalledWith('org-1', 'proj-1', false);
    });

    it('should throw when no organization ID', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getProjectDetails('proj-1')).rejects.toThrow(/Organization not found/);
    });

    it('should throw friendly error on 404', async () => {
      mockProjectsRead.mockRejectedValue({ statusCode: 404, response: { status: 404 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjectDetails('proj-1')).rejects.toThrow(/not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockProjectsRead.mockRejectedValue({ statusCode: 403, response: { status: 403 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjectDetails('proj-1')).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockProjectsRead.mockRejectedValue({ statusCode: 401, response: { status: 401 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getProjectDetails('proj-1')).rejects.toThrow(/Authentication expired/);
    });
  });

  describe('getCrawlers', () => {
    it('should return crawlers for a project', async () => {
      const crawlers = [{ uuid: 'c-1', name: 'Crawler 1' }];
      mockCrawlersList.mockResolvedValue({ data: crawlers });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.getCrawlers('proj-1');

      expect(result).toEqual(crawlers);
      expect(mockCrawlersList).toHaveBeenCalledWith('org-1', 'proj-1');
    });

    it('should throw when no organization ID', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getCrawlers('proj-1')).rejects.toThrow(/Organization not found/);
    });

    it('should throw friendly error on 404', async () => {
      mockCrawlersList.mockRejectedValue({ statusCode: 404, response: { status: 404 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getCrawlers('proj-1')).rejects.toThrow(/not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockCrawlersList.mockRejectedValue({ statusCode: 403, response: { status: 403 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getCrawlers('proj-1')).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockCrawlersList.mockRejectedValue({ statusCode: 401, response: { status: 401 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.getCrawlers('proj-1')).rejects.toThrow(/Authentication expired/);
    });
  });

  describe('runCrawler', () => {
    it('should run crawler with URLs', async () => {
      const response = { status: 'started', jobId: 'job-1' };
      mockCrawlersRun.mockResolvedValue({ data: response });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.runCrawler('proj-1', 'crawler-1', ['https://example.com']);

      expect(result).toEqual(response);
      expect(mockCrawlersRun).toHaveBeenCalledWith(
        'org-1', 'proj-1', 'crawler-1', { urls: ['https://example.com'] }
      );
    });

    it('should run crawler without URLs (empty payload)', async () => {
      const response = { status: 'started' };
      mockCrawlersRun.mockResolvedValue({ data: response });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      const result = await client.runCrawler('proj-1', 'crawler-1');

      expect(result).toEqual(response);
      expect(mockCrawlersRun).toHaveBeenCalledWith('org-1', 'proj-1', 'crawler-1', {});
    });

    it('should send empty payload for empty URLs array', async () => {
      mockCrawlersRun.mockResolvedValue({ data: {} });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await client.runCrawler('proj-1', 'crawler-1', []);

      expect(mockCrawlersRun).toHaveBeenCalledWith('org-1', 'proj-1', 'crawler-1', {});
    });

    it('should throw when no organization ID', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.runCrawler('proj-1', 'crawler-1')).rejects.toThrow(/Organization not found/);
    });

    it('should throw friendly error on 404', async () => {
      mockCrawlersRun.mockRejectedValue({ statusCode: 404, response: { status: 404 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.runCrawler('proj-1', 'crawler-1')).rejects.toThrow(/not found/);
    });

    it('should throw friendly error on 403', async () => {
      mockCrawlersRun.mockRejectedValue({ statusCode: 403, response: { status: 403 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.runCrawler('proj-1', 'crawler-1')).rejects.toThrow(/Access denied/);
    });

    it('should throw friendly error on 401', async () => {
      mockCrawlersRun.mockRejectedValue({ statusCode: 401, response: { status: 401 } });

      const client = new ApiClient('https://api.quantcdn.io', 'token', 'org-1');
      await expect(client.runCrawler('proj-1', 'crawler-1')).rejects.toThrow(/Authentication expired/);
    });
  });

  describe('getOrganizations', () => {
    it('should throw not implemented error', async () => {
      const client = new ApiClient('https://api.quantcdn.io', 'token');
      await expect(client.getOrganizations()).rejects.toThrow(/not yet implemented/);
    });
  });
});
