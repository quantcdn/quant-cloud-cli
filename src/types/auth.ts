export interface AuthConfig {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  email?: string;
  host: string;
  organizations?: Organization[];
  activeOrganization?: string;
  activeApplication?: string;
  activeEnvironment?: string;
}

export interface Organization {
  id: number;
  name: string;
  machine_name: string;
  roles: Array<{
    name: string;
    display_name: string;
  }>;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  user?: {
    id: string;
    email: string;
    name?: string;
    organizations?: Organization[];
  };
}

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  organizations: Organization[];
  scope: string;
  created_at: string;
}

export interface Application {
  id: number;
  name: string;
  machine_name: string;
  description?: string;
  status?: string;
  url?: string;
  lastDeployed?: string;
  environments?: Environment[];
}

export interface Environment {
  id: number;
  name: string;
  machine_name: string;
  status?: string;
  url?: string;
  description?: string;
}

export interface OAuthUser {
  id: string;
  email: string;
  name: string;
  organizations?: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  created_at?: string;
}