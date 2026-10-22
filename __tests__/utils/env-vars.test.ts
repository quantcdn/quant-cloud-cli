import { describe, it, expect, beforeEach } from '@jest/globals';
import { Readable } from 'stream';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { Configuration, VariablesApi } from '@quantcdn/quant-client';
import {
  describeApiError,
  listVariables,
  maskValue,
  normaliseVariables,
  parseEnvFile,
  readStreamValue,
  resolveSetInput,
  sanitizeForTerminal,
  scanEnvFile,
  setVariables,
  unsetVariable,
  validateVariableName,
  validateVariableValue,
  SetInputDeps,
} from '../../src/utils/env-vars.js';

const BASE = 'https://dashboard.example.test';
const TARGET = { orgId: 'acme', appId: 'web', envId: 'production' };
const VARS_PATH = '/api/v3/organizations/acme/applications/web/environments/production/variables';

interface Recorded {
  method?: string;
  url?: string;
  data?: unknown;
  auth?: unknown;
}

type Responder = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

// A mocked HTTP layer: the real generated VariablesApi runs, and this
// adapter records each request instead of sending it.
function createApi(respond: Responder): { api: VariablesApi; calls: Recorded[] } {
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
  const api = new VariablesApi(new Configuration({ basePath: BASE, accessToken: 'test-token' }), BASE, instance);
  return { api, calls };
}

const ok = (data?: unknown) => () => ({ status: 200, data });

describe('validateVariableName', () => {
  it('accepts names the portal accepts', () => {
    for (const name of ['APP_KEY', '_x', 'a.b-c', 'DB_HOST2']) {
      expect(validateVariableName(name)).toBeNull();
    }
  });

  it('rejects names the portal rejects', () => {
    for (const name of ['', '1ABC', 'A B', 'A/B', '../x', 'A=B']) {
      expect(validateVariableName(name)).toMatch(/Invalid variable name/);
    }
  });
});

describe('validateVariableValue', () => {
  it('rejects an empty value and points at unset', () => {
    expect(validateVariableValue('K', '')).toMatch(/qc env vars unset K/);
    expect(validateVariableValue('K', 'v')).toBeNull();
  });
});

describe('normaliseVariables', () => {
  it('maps the v3 { key, value } shape and sorts by name', () => {
    expect(normaliseVariables([{ key: 'B', value: '2' }, { key: 'A', value: '1' }])).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]);
  });

  it('accepts the upstream { environment: [{ name, value }] } shape', () => {
    expect(normaliseVariables({ environment: [{ name: 'X', value: 'y' }] })).toEqual([{ name: 'X', value: 'y' }]);
  });

  it('drops malformed rows and tolerates empty responses', () => {
    expect(normaliseVariables([null, 3, { value: 'no-name' }, { key: 'K', value: null }])).toEqual([
      { name: 'K', value: '' },
    ]);
    expect(normaliseVariables('')).toEqual([]);
    expect(normaliseVariables(undefined)).toEqual([]);
  });
});

describe('parseEnvFile', () => {
  it('parses comments, quotes and export-free lines', () => {
    const { variables, errors } = parseEnvFile('# comment\nA=1\nB="two words"\nC=\'x=y\'\n');
    expect(errors).toEqual([]);
    expect(variables).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: 'two words' },
      { name: 'C', value: 'x=y' },
    ]);
  });

  it('reports empty values', () => {
    const { variables, errors } = parseEnvFile('A=1\nEMPTY=\n');
    expect(variables).toEqual([{ name: 'A', value: '1' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/EMPTY/);
  });

  it('refuses the whole file when a line has no KEY=', () => {
    // dotenv drops DB_PASSWORD without a word; the run must not go ahead without it.
    const { variables, errors } = parseEnvFile('DB_HOST=db\nDB_PASSWORD\nDB_USER=root\n');
    expect(variables).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^Line 2: .*KEY=VALUE/)]);
  });

  it('keeps multi-line quoted values', () => {
    const { variables, errors } = parseEnvFile('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1\n');
    expect(errors).toEqual([]);
    expect(variables.map((v) => v.name)).toEqual(['KEY', 'NEXT']);
    expect(variables[0].value).toContain('abc');
  });
});

describe('scanEnvFile', () => {
  it('accepts blank lines, comments and export', () => {
    expect(scanEnvFile('\n# c\n  # indented\nexport A=1\nB = 2\n')).toEqual([]);
  });

  it('reports each line dotenv would drop, with its line number', () => {
    expect(scanEnvFile('OK=1\nA/B=v\nMY KEY=v\nA:B=v\nA[0]=v\nNOEQUALS\n')).toEqual([
      expect.stringMatching(/^Line 2: Invalid variable name 'A\/B'/),
      expect.stringMatching(/^Line 3: Invalid variable name 'MY KEY'/),
      expect.stringMatching(/^Line 4: Invalid variable name 'A:B'/),
      expect.stringMatching(/^Line 5: Invalid variable name 'A\[0\]'/),
      expect.stringMatching(/^Line 6: .*KEY=VALUE/),
    ]);
  });

  it('reports a duplicate key with the line of the first one', () => {
    expect(scanEnvFile('X=1\nY=2\nX=3\n')).toEqual([expect.stringMatching(/^Line 3: 'X' is already set on line 1/)]);
  });

  it('does not read lines inside a multi-line quoted value as keys', () => {
    expect(scanEnvFile("A='one\nnot a key line\ntwo'\nB=1\n")).toEqual([]);
  });

  it('reports a quoted value that never closes', () => {
    expect(scanEnvFile('A="open\nB=1\n')).toEqual([expect.stringMatching(/^Line 1: .*never closed/)]);
  });
});

describe('maskValue', () => {
  it('hides the value and its length', () => {
    expect(maskValue('s3cret')).toBe('********');
    expect(maskValue('x'.repeat(200))).toBe('********');
  });
});

describe('sanitizeForTerminal', () => {
  it('removes escape sequences and other control characters', () => {
    expect(sanitizeForTerminal('ok\u001b[2J\u001b]0;title\u0007\rfake')).toBe('ok[2J]0;titlefake');
    expect(sanitizeForTerminal('a\u009bb\u007fc')).toBe('abc');
  });

  it('keeps tabs, and keeps newlines only when asked', () => {
    expect(sanitizeForTerminal('a\tb\nc')).toBe('a\tbc');
    expect(sanitizeForTerminal('a\tb\nc', { keepNewlines: true })).toBe('a\tb\nc');
  });
});

describe('readStreamValue', () => {
  it('removes exactly one trailing newline', async () => {
    expect(await readStreamValue(Readable.from(['sec', 'ret\n']))).toBe('secret');
    expect(await readStreamValue(Readable.from(['a\r\n']))).toBe('a');
    expect(await readStreamValue(Readable.from(['a\n\n']))).toBe('a\n');
    expect(await readStreamValue(Readable.from(['no-newline']))).toBe('no-newline');
  });
});

describe('resolveSetInput', () => {
  let deps: SetInputDeps;
  let stdinReads: number;

  beforeEach(() => {
    stdinReads = 0;
    deps = {
      readStdin: async () => {
        stdinReads++;
        return 'from-stdin';
      },
      readFile: (path) => {
        if (path === '.env') return 'A=1\nB=2\n';
        if (path === 'bad.env') return 'A=1\nEMPTY=\n';
        if (path === 'blank.env') return '# nothing\n';
        if (path === 'dropped.env') return 'A=1\nB\nC=3\n';
        throw new Error('ENOENT: no such file');
      },
    };
  });

  it('takes KEY VALUE from argv', async () => {
    expect(await resolveSetInput({ key: 'K', value: 'v' }, deps)).toEqual({ variables: [{ name: 'K', value: 'v' }] });
    expect(stdinReads).toBe(0);
  });

  it('takes the value from stdin with --stdin', async () => {
    expect(await resolveSetInput({ key: 'K', stdin: true }, deps)).toEqual({
      variables: [{ name: 'K', value: 'from-stdin' }],
    });
  });

  it('reads every entry from --file', async () => {
    expect(await resolveSetInput({ file: '.env' }, deps)).toEqual({
      variables: [
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
      ],
    });
  });

  it('rejects ambiguous or incomplete input', async () => {
    const cases = [
      { input: {}, match: /Missing KEY/ },
      { input: { key: 'K' }, match: /Missing VALUE.*--stdin/ },
      { input: { key: 'K', value: 'v', stdin: true }, match: /not both/ },
      { input: { key: 'K', file: '.env' }, match: /--file cannot be combined/ },
      { input: { file: '.env', stdin: true }, match: /--file cannot be combined/ },
      { input: { key: 'bad key', value: 'v' }, match: /Invalid variable name/ },
      { input: { key: 'K', value: '' }, match: /empty/ },
      { input: { file: 'missing.env' }, match: /Cannot read 'missing.env'.*ENOENT/ },
      { input: { file: 'bad.env' }, match: /EMPTY/ },
      { input: { file: 'blank.env' }, match: /No variables found/ },
      { input: { file: 'dropped.env' }, match: /Line 2/ },
    ];
    for (const { input, match } of cases) {
      const result = await resolveSetInput(input, deps);
      expect(result.variables).toBeUndefined();
      expect(result.errors?.join('\n')).toMatch(match);
    }
  });

  it('says when nothing arrived on stdin', async () => {
    deps.readStdin = async () => '';
    const result = await resolveSetInput({ key: 'K', stdin: true }, deps);
    expect(result.errors).toEqual([expect.stringMatching(/No value received on stdin/)]);
  });

  it('does not read stdin when the input is invalid before the value', async () => {
    await resolveSetInput({ key: 'bad key', stdin: true }, deps);
    expect(stdinReads).toBe(0);
  });
});

describe('listVariables', () => {
  it('sends an authenticated GET to the variables endpoint', async () => {
    const { api, calls } = createApi(ok([{ key: 'Z', value: '26' }, { key: 'A', value: '1' }]));
    const variables = await listVariables(api, TARGET);
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}${VARS_PATH}`, data: undefined, auth: 'Bearer test-token' }]);
    expect(variables.map((v) => v.name)).toEqual(['A', 'Z']);
  });
});

describe('setVariables', () => {
  it('sends one PUT per variable with the value in the body, never the bulk endpoint', async () => {
    const { api, calls } = createApi(ok({ key: 'x', value: 'y' }));
    const results = await setVariables(api, TARGET, [
      { name: 'A', value: '1' },
      { name: 'B', value: 'two words' },
    ]);
    expect(results).toEqual([
      { name: 'A', ok: true },
      { name: 'B', ok: true },
    ]);
    expect(calls.map((c) => [c.method, c.url, c.data])).toEqual([
      ['PUT', `${BASE}${VARS_PATH}/A`, { value: '1' }],
      ['PUT', `${BASE}${VARS_PATH}/B`, { value: 'two words' }],
    ]);
    expect(calls.some((c) => c.url === `${BASE}${VARS_PATH}`)).toBe(false);
  });

  it('keeps going after a failure and reports the API message', async () => {
    const { api, calls } = createApi((config) =>
      config.url?.endsWith('/DB_HOST')
        ? { status: 409, data: { message: "'DB_HOST' is managed by the platform" } }
        : { status: 200, data: {} }
    );
    const results = await setVariables(api, TARGET, [
      { name: 'DB_HOST', value: 'x' },
      { name: 'OTHER', value: 'y' },
    ]);
    expect(calls).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'DB_HOST', ok: false, error: "'DB_HOST' is managed by the platform (HTTP 409)" });
    expect(results[1]).toEqual({ name: 'OTHER', ok: true });
  });

  it('URL-encodes the variable name in the path', async () => {
    const { api, calls } = createApi(ok());
    await setVariables(api, TARGET, [{ name: 'a.b-c', value: 'v' }]);
    expect(calls[0].url).toBe(`${BASE}${VARS_PATH}/a.b-c`);
  });
});

describe('unsetVariable', () => {
  it('sends DELETE to the variable path', async () => {
    const { api, calls } = createApi(() => ({ status: 204 }));
    await unsetVariable(api, TARGET, 'OLD_KEY');
    expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', `${BASE}${VARS_PATH}/OLD_KEY`]]);
  });

  it('propagates API errors', async () => {
    const { api } = createApi(() => ({ status: 403, data: {} }));
    await expect(unsetVariable(api, TARGET, 'K')).rejects.toBeInstanceOf(AxiosError);
  });
});

describe('describeApiError', () => {
  it('prefers the API message, then a status hint, then the error message', () => {
    expect(describeApiError({ response: { status: 422, data: { message: 'The value field is required.' } } })).toBe(
      'The value field is required. (HTTP 422)'
    );
    expect(describeApiError({ response: { status: 403, data: {} } })).toMatch(/write_environments/);
    expect(describeApiError({ response: { status: 401 } })).toMatch(/qc login/);
    expect(describeApiError(new Error('socket hang up'))).toBe('socket hang up');
  });
});
