import { getActivePlatformConfig } from './config.js';
import { resolveEffectiveContext, ContextOverrides, EffectiveContext } from './context.js';
import { Logger } from './logger.js';
import { ApplicationsApi, EnvironmentsApi, SSHAccessApi, BackupManagementApi, ProjectsApi, CrawlersApi, Configuration } from '@quantcdn/quant-client';

const logger = new Logger('API');

export interface ApiOptions {
  organizationId?: string;
  applicationId?: string;
  environmentId?: string;
}

export class ApiClient {
  private applicationsApi: ApplicationsApi;
  public environmentsApi: EnvironmentsApi;
  public sshAccessApi: SSHAccessApi;
  public backupManagementApi: BackupManagementApi;
  private projectsApi: ProjectsApi;
  public crawlersApi: CrawlersApi;
  public baseUrl: string;
  private defaultOrganizationId?: string;
  private defaultApplicationId?: string;
  private defaultEnvironmentId?: string;
  private token: string;

  constructor(baseUrl: string, token: string, defaultOrganizationId?: string, defaultApplicationId?: string, defaultEnvironmentId?: string) {
    // Set authentication headers
    const defaultHeaders = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(defaultOrganizationId && { 'X-Organization': defaultOrganizationId }),
      ...(defaultApplicationId && { 'X-Application': defaultApplicationId }),
      ...(defaultEnvironmentId && { 'X-Environment': defaultEnvironmentId }),
    };

    // Configure the APIs with Configuration object
    const config = new Configuration({
      basePath: baseUrl,
      accessToken: token,
      baseOptions: {
        headers: defaultHeaders
      }
    });

    this.applicationsApi = new ApplicationsApi(config);
    this.environmentsApi = new EnvironmentsApi(config);
    this.sshAccessApi = new SSHAccessApi(config);
    this.backupManagementApi = new BackupManagementApi(config);
    this.projectsApi = new ProjectsApi(config);
    this.crawlersApi = new CrawlersApi(config);
    
    this.baseUrl = baseUrl;
    this.token = token;
    this.defaultOrganizationId = defaultOrganizationId;
    this.defaultApplicationId = defaultApplicationId;
    this.defaultEnvironmentId = defaultEnvironmentId;
  }

  static async create(contextOverrides: ContextOverrides = {}): Promise<ApiClient> {
    const context = await resolveEffectiveContext(contextOverrides);
    
    return new ApiClient(
      context.host, 
      context.token, 
      context.activeOrganization, 
      context.activeApplication, 
      context.activeEnvironment
    );
  }

  // Old request method removed - now using TypeScript client

  // Using TypeScript client methods directly instead of manual HTTP calls

  // Convenience methods for common API patterns
  
  async getApplications(apiOptions?: ApiOptions): Promise<any[]> {
    const organizationId = apiOptions?.organizationId || this.defaultOrganizationId;
    
    if (!organizationId) {
      throw new Error('Organization not found or no access to applications.\nUse quant-cloud org list to see available organizations');
    }

    try {
      const response = await this.applicationsApi.listApplications(organizationId);
      return response.data;
    } catch (error: any) {
      // Provide friendly error messages instead of debug dumps
      if (error.statusCode === 404) {
        throw new Error(`Organization '${organizationId}' not found or no access to applications.`);
      } else if (error.statusCode === 403) {
        throw new Error(`Access denied to applications in organization '${organizationId}'.`);
      } else if (error.statusCode === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch applications: ${error.message || 'Network error'}`);
      }
    }
  }

  async getEnvironments(apiOptions?: ApiOptions): Promise<any[]> {
    const organizationId = apiOptions?.organizationId || this.defaultOrganizationId;
    const applicationId = apiOptions?.applicationId || this.defaultApplicationId;
    
    if (!organizationId) {
      throw new Error('Organization not found or no access to environments.\nUse quant-cloud org list to see available organizations');
    }
    
    if (!applicationId) {
      throw new Error('Application not found or no access to environments.\nUse quant-cloud app list to see available applications');
    }

    try {
      const response = await this.environmentsApi.listEnvironments(organizationId, applicationId);
      return response.data;
    } catch (error: any) {
      // Provide friendly error messages instead of debug dumps
      if (error.statusCode === 404) {
        if (error.body?.message?.includes('Application') && error.body?.message?.includes('not found')) {
          throw new Error(`Application '${organizationId}/${applicationId}' not found.`);
        } else {
          throw new Error(`Organization '${organizationId}' not found or no access to environments.`);
        }
      } else if (error.statusCode === 403) {
        throw new Error(`Access denied to environments in '${organizationId}/${applicationId}'.`);
      } else if (error.statusCode === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch environments: ${error.message || 'Network error'}`);
      }
    }
  }

  async getOrganizations(): Promise<any[]> {
    // TODO: Organizations are fetched via getUserInfo from OAuth endpoint
    throw new Error('getOrganizations not yet implemented - use getUserInfo instead');
  }

  async getUserInfo(): Promise<any> {
    // OAuth user info is fetched directly, not through the TypeScript client
    // This endpoint is not part of the v3 API, it's part of the OAuth system
    try {
      const response = await fetch(`${this.baseUrl}/api/oauth/user`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
        } else if (response.status === 403) {
          throw new Error('Access denied to user information.');
        } else {
          throw new Error(`Failed to get user info: ${response.status} ${response.statusText}`);
        }
      }

      return await response.json();
    } catch (error: any) {
      if (error.message?.includes('Authentication expired') || error.message?.includes('Access denied')) {
        throw error; // Re-throw our friendly errors
      } else {
        throw new Error(`Failed to get user info: ${error.message || 'Network error'}`);
      }
    }
  }

  async getEnvironmentMetrics(options: { organizationId?: string, applicationId?: string, environmentId: string }): Promise<any> {
    const organizationId = options.organizationId || this.defaultOrganizationId;
    const applicationId = options.applicationId || this.defaultApplicationId;
    
    if (!organizationId || !applicationId) {
      throw new Error('Organization ID and Application ID are required');
    }

    try {
      const response = await this.environmentsApi.getEnvironmentMetrics(organizationId, applicationId, options.environmentId);
      return response.data;
    } catch (error: any) {
      // Provide friendly error messages instead of debug dumps
      if (error.statusCode === 404) {
        throw new Error(`Environment '${organizationId}/${applicationId}/${options.environmentId}' not found or metrics unavailable.`);
      } else if (error.statusCode === 403) {
        throw new Error(`Access denied to metrics for '${organizationId}/${applicationId}/${options.environmentId}'.`);
      } else if (error.statusCode === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch metrics: ${error.message || 'Network error'}`);
      }
    }
  }

  async getProjects(apiOptions?: ApiOptions): Promise<any[]> {
    const organizationId = apiOptions?.organizationId || this.defaultOrganizationId;
    
    if (!organizationId) {
      throw new Error('Organization not found or no access to projects.\nUse quant-cloud org list to see available organizations');
    }

    try {
      const response = await this.projectsApi.projectsList(organizationId);
      return response.data;
    } catch (error: any) {
      // Provide friendly error messages
      if (error.statusCode === 404 || error.response?.status === 404) {
        throw new Error(`Organization '${organizationId}' not found or no access to projects.`);
      } else if (error.statusCode === 403 || error.response?.status === 403) {
        throw new Error(`Access denied to projects in organization '${organizationId}'.`);
      } else if (error.statusCode === 401 || error.response?.status === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch projects: ${error.message || 'Network error'}`);
      }
    }
  }

  async getProjectDetails(projectName: string): Promise<any> {
    const organizationId = this.defaultOrganizationId;
    
    if (!organizationId) {
      throw new Error('Organization not found. Use quant-cloud org list to see available organizations');
    }

    try {
      // Fetch project details - for standard Quant projects, this will return the project domain
      // withToken=false means we don't need the project token in the response
      const response = await this.projectsApi.projectsRead(organizationId, projectName, false);
      return response.data;
    } catch (error: any) {
      // Provide friendly error messages
      if (error.statusCode === 404 || error.response?.status === 404) {
        throw new Error(`Project '${projectName}' not found in organization '${organizationId}'.`);
      } else if (error.statusCode === 403 || error.response?.status === 403) {
        throw new Error(`Access denied to project '${projectName}'.`);
      } else if (error.statusCode === 401 || error.response?.status === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch project details: ${error.message || 'Network error'}`);
      }
    }
  }

  async getCrawlers(projectName: string): Promise<any[]> {
    const organizationId = this.defaultOrganizationId;
    
    if (!organizationId) {
      throw new Error('Organization not found. Use quant-cloud org list to see available organizations');
    }

    try {
      const response = await this.crawlersApi.crawlersList(organizationId, projectName);
      return response.data;
    } catch (error: any) {
      if (error.statusCode === 404 || error.response?.status === 404) {
        throw new Error(`Project '${projectName}' not found or has no crawlers.`);
      } else if (error.statusCode === 403 || error.response?.status === 403) {
        throw new Error(`Access denied to crawlers for project '${projectName}'.`);
      } else if (error.statusCode === 401 || error.response?.status === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to fetch crawlers: ${error.message || 'Network error'}`);
      }
    }
  }

  async runCrawler(projectName: string, crawlerId: string, urls?: string[]): Promise<any> {
    const organizationId = this.defaultOrganizationId;
    
    if (!organizationId) {
      throw new Error('Organization not found. Use quant-cloud org list to see available organizations');
    }

    try {
      const payload = urls && urls.length > 0 ? { urls } : {};
      const response = await this.crawlersApi.crawlersRun(organizationId, projectName, crawlerId, payload);
      return response.data;
    } catch (error: any) {
      if (error.statusCode === 404 || error.response?.status === 404) {
        throw new Error(`Crawler '${crawlerId}' not found in project '${projectName}'.`);
      } else if (error.statusCode === 403 || error.response?.status === 403) {
        throw new Error(`Access denied to run crawler '${crawlerId}'.`);
      } else if (error.statusCode === 401 || error.response?.status === 401) {
        throw new Error('Authentication expired. Please run `qc login` to re-authenticate.');
      } else {
        throw new Error(`Failed to run crawler: ${error.message || 'Network error'}`);
      }
    }
  }
}