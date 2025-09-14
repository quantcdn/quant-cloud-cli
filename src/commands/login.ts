import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../utils/spinner.js';
import open from 'open';
import inquirer from 'inquirer';
import { createServer } from 'http';
import { URL } from 'url';
import { createHash, randomBytes } from 'crypto';
import { AuthConfig, UserInfo } from '../types/auth.js';
import { saveAuthConfig, loadAuthConfig } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Login');

export function loginCommand(program: Command) {
  program
    .command('login')
    .description('Authenticate with Quant Cloud Platform')
    .option('-p, --port <port>', 'callback port for OAuth flow', '8090')
    .option('--endpoint <url>', 'override API endpoint')
    .action(async (options) => {
      await handleLogin(options);
    });
}

interface LoginOptions {
  port: string;
  endpoint?: string;
}

interface ServiceOption {
  name: string;
  value: string;
  host: string;
  description: string;
}

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

async function handleLogin(options: LoginOptions) {
  const spinner = createSpinner('Initializing authentication flow...');
  
  try {
    // Check if already authenticated
    const existingAuth = await loadAuthConfig();
    if (existingAuth && existingAuth.token && !isTokenExpired(existingAuth)) {
  spinner.succeed('Already authenticated');
      logger.info(`Logged in as: ${chalk.cyan(existingAuth.email || 'Unknown User')}`);
      return;
    }
    
    let service: ServiceOption;
    
    // Check for endpoint override
    if (options.endpoint) {
      service = {
        name: 'Custom Endpoint',
        value: 'custom',
        host: options.endpoint,
        description: options.endpoint
      };
      logger.info(`Using custom endpoint: ${chalk.cyan(options.endpoint)}`);
    } else {
      // Stop spinner for interactive prompt
      spinner.stop();
      
      // Interactive service selection
      const services: ServiceOption[] = [
        {
          name: 'QuantGov Cloud - Government & Enterprise Platform',
          value: 'quantgov',
          host: 'https://dash.quantgov.cloud',
          description: 'dash.quantgov.cloud'
        },
        {
          name: 'Quant Cloud - Content Delivery Platform', 
          value: 'quantcdn',
          host: 'https://dashboard.quantcdn.io',
          description: 'dashboard.quantcdn.io'
        }
      ];
      
      const { selectedService } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedService',
          message: 'Select your Quant Cloud service:',
          choices: services.map(svc => ({
            name: `${svc.name} ${chalk.gray(`(${svc.description})`)}`,
            value: svc.value
          }))
        }
      ]);
      
      service = services.find(s => s.value === selectedService)!;
    }
    
    // Resume spinner
    spinner.start('Setting up secure authentication...');
    
    const callbackPort = parseInt(options.port);
    const callbackUrl = `http://localhost:${callbackPort}/callback`;
    const clientId = 'quant-cli';
    
    // Generate PKCE challenge
    const pkce = generatePKCE();
    const state = randomBytes(16).toString('hex');
    
    logger.debug('Generated PKCE challenge for secure OAuth flow');
    
    // Build authorization URL with full access scope
    const authUrl = generateAuthUrl(service.host, callbackUrl, clientId, ['full_access'], state, pkce);
    
    // Start callback server and get authorization code
    spinner.text = 'Starting local callback server...';
    const authCode = await startCallbackServer(callbackPort, state, authUrl);
    
    if (!authCode) {
      throw new Error('Failed to receive authorization code');
    }
    
    // Exchange code for token
    spinner.text = 'Exchanging code for access token...';
    const tokenData = await exchangeCodeForToken(authCode, pkce.codeVerifier, service.host, callbackUrl, clientId);
    
    // Get user info with organizations from API
    spinner.text = 'Loading organization data...';
    const userInfo = await getUserInfo(tokenData.access_token, service.host);
    
    // Save authentication config
    const authConfig: AuthConfig = {
      token: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
      email: userInfo.email,
      host: service.host,
      organizations: userInfo.organizations,
      activeOrganization: userInfo.organizations.length > 0 ? userInfo.organizations[0].machine_name : undefined
    };
    
    await saveAuthConfig(authConfig);
    
    spinner.succeed('Authentication successful');
    logger.info(`${chalk.green('Platform:')} ${chalk.cyan(service.name.split(' - ')[0])}`);
    logger.info(`${chalk.green('Logged in as:')} ${chalk.cyan(userInfo.name)} (${chalk.cyan(userInfo.email)})`);
    logger.info(`${chalk.green('Access token:')} ${chalk.gray(tokenData.access_token.substring(0, 20) + '...')}`);
    logger.info(`${chalk.green('Expires in:')} ${chalk.cyan(Math.floor(tokenData.expires_in / 86400) + ' days')}`);
    
    if (userInfo.organizations?.length) {
      logger.info(`${chalk.green('Organizations:')} ${chalk.cyan(userInfo.organizations.length.toString())}`);
      if (userInfo.organizations.length > 1) {
        logger.info(`${chalk.green('Active organization:')} ${chalk.cyan(userInfo.organizations[0].name)} (${chalk.gray(userInfo.organizations[0].machine_name)})`);
        logger.info(`${chalk.gray('Use')} ${chalk.cyan('quant-cloud org switch')} ${chalk.gray('to change organizations')}`);
      }
    }
    
    // Test API call
    spinner.start('Testing API access...');
    try {
      await testApiCall(tokenData.access_token, service.host);
      spinner.succeed('API access confirmed');
    } catch (error) {
      spinner.warn('API test failed, but authentication was successful');
      logger.debug('API test error:', error);
    }
    
    // Exit successfully after authentication is complete
    process.exit(0);
    
  } catch (error) {
    spinner.fail('Authentication failed');
    logger.error('Login error:', error);
    process.exit(1);
  }
}

function generatePKCE(): PKCEChallenge {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256'
  };
}

function generateAuthUrl(host: string, callbackUrl: string, clientId: string, scopes: string[], state: string, pkce: PKCEChallenge): string {
  const authUrl = new URL('/oauth/authorize', host);
  
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  
  // Set OAuth scopes
  if (scopes.length > 0) {
    authUrl.searchParams.set('scope', scopes.join(' '));
  }
  
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
  authUrl.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  
  return authUrl.toString();
}

async function startCallbackServer(port: number, expectedState: string, authUrl: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        
        if (error) {
          res.writeHead(400, {'Content-Type': 'text/html'});
          res.end(`
            <html>
              <body style="font-family: system-ui; background: linear-gradient(135deg, #0a0a0a, #1a1a2e); color: #ff4444; text-align: center; padding: 50px; min-height: 100vh; margin: 0; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="color: #ff4444; margin-bottom: 1rem;">Authorization Failed</h1>
                <p style="font-size: 1.1rem;">Error: ${error}</p>
                <p style="color: #aaa;">You can close this window and try again.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        
        if (state !== expectedState) {
          res.writeHead(400, {'Content-Type': 'text/html'});
          res.end(`
            <html>
              <body style="font-family: system-ui; background: linear-gradient(135deg, #0a0a0a, #1a1a2e); color: #ff4444; text-align: center; padding: 50px; min-height: 100vh; margin: 0; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="color: #ff4444; margin-bottom: 1rem;">Invalid State</h1>
                <p style="font-size: 1.1rem;">Security validation failed. Please try again.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('Invalid state parameter'));
          return;
        }
        
        if (code) {
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end(`
            <html>
              <body style="font-family: system-ui; background: linear-gradient(135deg, #0a0a0a, #1a1a2e); color: #00ff88; text-align: center; padding: 50px; min-height: 100vh; margin: 0; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="color: #00ff88; margin-bottom: 1rem;">Authorization Successful</h1>
                <p style="font-size: 1.1rem;">You can now close this window and return to the CLI.</p>
                <p style="color: #aaa; margin-top: 2rem;">This window will close automatically in 3 seconds...</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);
          server.close();
          resolve(code);
        }
      }
    });
    
    server.listen(port, () => {
      logger.info(`\n${chalk.cyan('Opening browser for authentication...')}`);
      logger.info(`${chalk.gray('If browser doesn\'t open automatically, visit:')} ${chalk.underline(authUrl)}\n`);
      
      open(authUrl.toString()).catch(() => {
        logger.warn('Could not open browser automatically. Please visit the URL above.');
      });
    });
    
    server.on('error', (error) => {
      if ((error as any).code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try a different port with --port`));
      } else {
        reject(error);
      }
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout'));
    }, 300000);
  });
}

async function exchangeCodeForToken(code: string, codeVerifier: string, host: string, callbackUrl: string, clientId: string): Promise<any> {
  const tokenUrl = new URL('/oauth/token', host);
  
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: code,
    redirect_uri: callbackUrl,
    code_verifier: codeVerifier,
  });
  
  logger.debug('Token request details:');
  logger.debug(`  URL: ${tokenUrl.toString()}`);
  logger.debug(`  Body: ${body.toString()}`);
  
  const response = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const error = await response.json() as any;
      errorMessage = error.error || error.message || errorMessage;
      logger.debug('Full error response:', JSON.stringify(error, null, 2));
    } catch (e) {
      const text = await response.text();
      logger.debug('Raw error response:', text);
      errorMessage = text || errorMessage;
    }
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }
  
  return await response.json();
}

async function getUserInfo(accessToken: string, host: string): Promise<UserInfo> {
  const response = await fetch(`${host}/api/oauth/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status} ${response.statusText}`);
  }

  return await response.json() as UserInfo;
}

async function testApiCall(accessToken: string, host: string): Promise<any> {
  logger.debug('Testing API call...');
  
  const response = await fetch(`${host}/api/oauth/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API call failed: ${response.statusText}`);
  }
  
  const userData = await response.json();
  logger.debug('API Response:', JSON.stringify(userData, null, 2));
  
  return userData;
}

function isTokenExpired(auth: AuthConfig): boolean {
  if (!auth.expiresAt) return false;
  return new Date() >= new Date(auth.expiresAt);
}