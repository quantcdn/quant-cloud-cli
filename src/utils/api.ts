import { getActivePlatformConfig } from './config.js';
import { Logger } from './logger.js';
import { ApplicationsApi, EnvironmentsApi, SSHAccessApi } from 'quant-ts-client';

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
  public baseUrl: string;
  private defaultOrganizationId?: string;
  private defaultApplicationId?: string;
  private defaultEnvironmentId?: string;
  private token: string;

  constructor(baseUrl: string, token: string, defaultOrganizationId?: string, defaultApplicationId?: string, defaultEnvironmentId?: string) {
    // Configure the APIs
    this.applicationsApi = new ApplicationsApi(`${baseUrl}/api/v3`);
    this.environmentsApi = new EnvironmentsApi(`${baseUrl}/api/v3`);
    this.sshAccessApi = new SSHAccessApi(`${baseUrl}/api/v3`);
    
    this.baseUrl = baseUrl;
    this.token = token;
    this.defaultOrganizationId = defaultOrganizationId;
    this.defaultApplicationId = defaultApplicationId;
    this.defaultEnvironmentId = defaultEnvironmentId;

    // Set authentication headers
    const defaultHeaders = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(defaultOrganizationId && { 'X-Organization': defaultOrganizationId }),
      ...(defaultApplicationId && { 'X-Application': defaultApplicationId }),
      ...(defaultEnvironmentId && { 'X-Environment': defaultEnvironmentId }),
    };

    this.applicationsApi.defaultHeaders = defaultHeaders;
    this.environmentsApi.defaultHeaders = defaultHeaders;
    this.sshAccessApi.defaultHeaders = defaultHeaders;
  }

  static async create(): Promise<ApiClient> {
    const auth = await getActivePlatformConfig();
    
    if (!auth || !auth.token) {
      throw new Error('Not authenticated. Run `quant-cloud login` first.');
    }

    return new ApiClient(auth.host, auth.token, auth.activeOrganization, auth.activeApplication, auth.activeEnvironment);
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
      return response.body;
    } catch (error: any) {
      logger.error('Failed to fetch applications:', error);
      throw error;
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
      return response.body;
    } catch (error: any) {
      logger.error('Failed to fetch environments:', error);
      throw error;
    }
  }

  async getOrganizations(): Promise<any[]> {
    // TODO: Organizations are fetched via getUserInfo from OAuth endpoint
    throw new Error('getOrganizations not yet implemented - use getUserInfo instead');
  }

  async getUserInfo(): Promise<any> {
    // OAuth user info is fetched directly, not through the TypeScript client
    // This endpoint is not part of the v3 API, it's part of the OAuth system
    const response = await fetch(`${this.applicationsApi.basePath.replace('/api/v3', '')}/api/oauth/user`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async getEnvironmentMetrics(options: { organizationId?: string, applicationId?: string, environmentId: string }): Promise<any> {
    const organizationId = options.organizationId || this.defaultOrganizationId;
    const applicationId = options.applicationId || this.defaultApplicationId;
    
    if (!organizationId || !applicationId) {
      throw new Error('Organization ID and Application ID are required');
    }

    const response = await this.environmentsApi.getEnvironmentMetrics(organizationId, applicationId, options.environmentId);
    return response.body;
  }
}