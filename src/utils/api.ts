import { resolveEffectiveContext, ContextOverrides, EffectiveContext, TokenRenewer } from './context.js';
import { Logger } from './logger.js';
import { createRenewingAxios } from './auth-retry.js';
import { ApplicationsApi, EnvironmentsApi, SSHAccessApi, BackupManagementApi, ProjectsApi, CrawlersApi, CommandsApi, VariablesApi, SecretsApi, Configuration } from '@quantcdn/quant-client';

const logger = new Logger('API');

export interface ApiOptions {
  organizationId?: string;
  applicationId?: string;
  environmentId?: string;
}

/** The HTTP status of an SDK error: axios sets response.status, older clients set statusCode. */
function httpStatus(error: any): number | undefined {
  return error?.statusCode ?? error?.response?.status;
}

function environmentsNotFoundMessage(error: { body?: { message?: string } }, organizationId: string, applicationId: string): string {
  const message: string = error.body?.message ?? '';
  if (message.includes('Application') && message.includes('not found')) {
    return `Application '${organizationId}/${applicationId}' not found.`;
  }
  return `Organization '${organizationId}' not found or no access to environments.`;
}

export class ApiClient {
  private applicationsApi: ApplicationsApi;
  public environmentsApi: EnvironmentsApi;
  public sshAccessApi: SSHAccessApi;
  public backupManagementApi: BackupManagementApi;
  private projectsApi: ProjectsApi;
  public crawlersApi: CrawlersApi;
  public commandsApi: CommandsApi;
  public variablesApi: VariablesApi;
  public secretsApi: SecretsApi;
  public baseUrl: string;
  private defaultOrganizationId?: string;
  private defaultApplicationId?: string;
  private defaultEnvironmentId?: string;
  private token: string;
  private renewToken?: TokenRenewer;

  constructor(baseUrl: string, token: string, defaultOrganizationId?: string, defaultApplicationId?: string, defaultEnvironmentId?: string, renewToken?: TokenRenewer) {
    this.token = token;
    this.renewToken = renewToken;

    // The client reads accessToken for every request, so a renewed token is used at once.
    const config = new Configuration({
      basePath: baseUrl,
      accessToken: () => this.token
    });
    // Legacy logins (no refresh token) keep the default axios and never retry.
    const http = renewToken ? createRenewingAxios((sent) => this.renew(sent)) : undefined;

    this.applicationsApi = new ApplicationsApi(config, undefined, http);
    this.environmentsApi = new EnvironmentsApi(config, undefined, http);
    this.sshAccessApi = new SSHAccessApi(config, undefined, http);
    this.backupManagementApi = new BackupManagementApi(config, undefined, http);
    this.projectsApi = new ProjectsApi(config, undefined, http);
    this.crawlersApi = new CrawlersApi(config, undefined, http);
    this.commandsApi = new CommandsApi(config, undefined, http);
    this.variablesApi = new VariablesApi(config, undefined, http);
    this.secretsApi = new SecretsApi(config, undefined, http);

    this.baseUrl = baseUrl;
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
      context.activeEnvironment,
      context.renewToken
    );
  }

  /** Renews the token after a 401 for sentToken. Returns the new token, or null. */
  private async renew(sentToken: string): Promise<string | null> {
    if (!this.renewToken) {
      return null;
    }
    const token = await this.renewToken(sentToken);
    if (token) {
      this.token = token;
    }
    return token;
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
      const status = httpStatus(error);
      // Provide friendly error messages instead of debug dumps
      if (status === 404) {
        throw new Error(`Organization '${organizationId}' not found or no access to applications.`);
      } else if (status === 403) {
        throw new Error(`Access denied to applications in organization '${organizationId}'.`);
      } else if (status === 401) {
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
      const status = httpStatus(error);
      // Provide friendly error messages instead of debug dumps
      if (status === 404) {
        throw new Error(environmentsNotFoundMessage(error, organizationId, applicationId));
      } else if (status === 403) {
        throw new Error(`Access denied to environments in '${organizationId}/${applicationId}'.`);
      } else if (status === 401) {
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

  private fetchUserInfo(token: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api/oauth/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
  }

  /** fetchUserInfo, renewed and sent again once after a 401. */
  private async fetchUserInfoWithRenewal(): Promise<Response> {
    const sent = this.token;
    const response = await this.fetchUserInfo(sent);
    if (response.status !== 401) {
      return response;
    }
    const token = await this.renew(sent);
    return token ? this.fetchUserInfo(token) : response;
  }

  async getUserInfo(): Promise<any> {
    // OAuth user info is fetched directly, not through the TypeScript client
    // This endpoint is not part of the v3 API, it's part of the OAuth system
    try {
      const response = await this.fetchUserInfoWithRenewal();

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
      // getEnvironmentMetrics has many optional parameters before options
      const response = await this.environmentsApi.getEnvironmentMetrics(
        organizationId, 
        applicationId, 
        options.environmentId
      );
      return response.data;
    } catch (error: any) {
      const status = httpStatus(error);
      // Provide friendly error messages instead of debug dumps
      if (status === 404) {
        throw new Error(`Environment '${organizationId}/${applicationId}/${options.environmentId}' not found or metrics unavailable.`);
      } else if (status === 403) {
        throw new Error(`Access denied to metrics for '${organizationId}/${applicationId}/${options.environmentId}'.`);
      } else if (status === 401) {
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
      return (response.data as any) || [];
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