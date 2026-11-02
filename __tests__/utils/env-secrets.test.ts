import { describe, it, expect } from '@jest/globals';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { Configuration, SecretsApi } from '@quantcdn/quant-client';
import {
  MOVE_TO_SECRET_HINT,
  SECRET_LABELS,
  listSecretNames,
  normaliseSecretNames,
  setSecrets,
  unsetSecret,
} from '../../src/utils/env-secrets.js';
import { resolveSetInput, SetInputDeps } from '../../src/utils/env-vars.js';

const BASE = 'https://dashboard.example.test';
const TARGET = { orgId: 'acme', appId: 'web', envId: 'production' };
const SECRETS_PATH = '/api/v3/organizations/acme/applications/web/environments/production/secrets';

interface Recorded {
  method?: string;
  url?: string;
  data?: unknown;
  auth?: unknown;
}

type Responder = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

// The real generated SecretsApi runs; this adapter records each request instead of sending it.
function createApi(respond: Responder): { api: SecretsApi; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const instance = axios.create({
    adapter: async (config) => {
      calls.push({
        method: config.method?.toUpperCase(),
        url: config.url,
        data: config.data ? JSON.parse(config.data as string) : undefined,
        auth: config.headers?.Authorization,
      });
      const { status, data } = respond(config);
      const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
      if (status >= 400) {
        throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response);
      }
      return response;
    },
  });
  const api = new SecretsApi(new Configuration({ basePath: BASE, accessToken: 'test-token' }), BASE, instance);
  return { api, calls };
}

describe('normaliseSecretNames', () => {
  it('maps the v3 [{ key }] shape, sorts and removes duplicates', () => {
    expect(normaliseSecretNames([{ key: 'Z' }, { key: 'A' }, { key: 'A' }])).toEqual(['A', 'Z']);
  });

  it('accepts names, bare strings and a { secrets } wrapper; drops malformed rows', () => {
    expect(normaliseSecretNames({ secrets: [{ name: 'B' }, 'C', { key: '' }, null, 7] })).toEqual(['B', 'C']);
    expect(normaliseSecretNames(null)).toEqual([]);
    expect(normaliseSecretNames({})).toEqual([]);
  });
});

describe('listSecretNames', () => {
  it('sends an authenticated GET to the secrets endpoint and returns names only', async () => {
    const { api, calls } = createApi(() => ({ status: 200, data: [{ key: 'TOKEN' }, { key: 'DB_PASS' }] }));
    expect(await listSecretNames(api, TARGET)).toEqual(['DB_PASS', 'TOKEN']);
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}${SECRETS_PATH}`, data: undefined, auth: 'Bearer test-token' }]);
  });
});

describe('setSecrets', () => {
  it('sends one PUT per secret with the value in the body', async () => {
    const { api, calls } = createApi(() => ({ status: 200, data: { key: 'x' } }));
    const results = await setSecrets(api, TARGET, [
      { name: 'A', value: '1' },
      { name: 'PEM', value: '-----BEGIN KEY-----\nabc\n-----END KEY-----' },
    ]);
    expect(results).toEqual([{ name: 'A', ok: true }, { name: 'PEM', ok: true }]);
    expect(calls.map((c) => [c.method, c.url, c.data])).toEqual([
      ['PUT', `${BASE}${SECRETS_PATH}/A`, { value: '1' }],
      ['PUT', `${BASE}${SECRETS_PATH}/PEM`, { value: '-----BEGIN KEY-----\nabc\n-----END KEY-----' }],
    ]);
  });

  it('keeps going after a failure; a 409 name clash adds the move-to-secret hint', async () => {
    const clash = "Cannot create/update secret 'API_URL' as it already exists as an environment variable.";
    const { api, calls } = createApi((config) =>
      config.url?.endsWith('/API_URL') ? { status: 409, data: { message: clash } } : { status: 200, data: {} }
    );
    const results = await setSecrets(api, TARGET, [
      { name: 'API_URL', value: 'x' },
      { name: 'OK_KEY', value: 'y' },
    ]);
    expect(calls).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'API_URL', ok: false, error: `${clash} (HTTP 409) ${MOVE_TO_SECRET_HINT}` });
    expect(results[1]).toEqual({ name: 'OK_KEY', ok: true });
  });

  it('does not add the hint to other errors', async () => {
    const { api } = createApi(() => ({ status: 403, data: {} }));
    const [result] = await setSecrets(api, TARGET, [{ name: 'K', value: 'v' }]);
    expect(result.error).toMatch(/write_environments/);
    expect(result.error).not.toContain(MOVE_TO_SECRET_HINT);
  });
});

describe('unsetSecret', () => {
  it('sends DELETE to the secret path', async () => {
    const { api, calls } = createApi(() => ({ status: 204 }));
    await unsetSecret(api, TARGET, 'OLD_KEY');
    expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', `${BASE}${SECRETS_PATH}/OLD_KEY`]]);
  });
});

describe('resolveSetInput with secret labels', () => {
  const deps = (stdin = '', files: Record<string, string> = {}): SetInputDeps => ({
    readStdin: async () => stdin,
    readFile: (path) => {
      if (path in files) return files[path];
      throw new Error('ENOENT');
    },
  });

  it('says "secret" and points at qc env secrets in its messages', async () => {
    const missingKey = await resolveSetInput({ labels: SECRET_LABELS }, deps());
    expect(missingKey.errors?.[0]).toContain('qc env secrets set KEY VALUE');
    const empty = await resolveSetInput({ key: 'K', value: '', labels: SECRET_LABELS }, deps());
    expect(empty.errors?.[0]).toContain('To remove a secret, use `qc env secrets unset K`');
    const noStdin = await resolveSetInput({ key: 'K', stdin: true, labels: SECRET_LABELS }, deps());
    expect(noStdin.errors?.[0]).toContain('| qc env secrets set KEY --stdin');
    const emptyFile = await resolveSetInput({ file: 'e', labels: SECRET_LABELS }, deps('', { e: '# nothing\n' }));
    expect(emptyFile.errors?.[0]).toBe("No secrets found in 'e'.");
  });

  it('still says "variable" by default', async () => {
    const empty = await resolveSetInput({ key: 'K', value: '' }, deps());
    expect(empty.errors?.[0]).toContain('To remove a variable, use `qc env vars unset K`');
  });

  it('reads a multi-line value from stdin unchanged except one trailing newline removed upstream', async () => {
    const pem = '-----BEGIN KEY-----\nabc\n-----END KEY-----';
    expect(await resolveSetInput({ key: 'PEM', stdin: true, labels: SECRET_LABELS }, deps(pem))).toEqual({
      variables: [{ name: 'PEM', value: pem }],
    });
  });
});
