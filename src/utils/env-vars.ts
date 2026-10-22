import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import type { VariablesApi } from '@quantcdn/quant-client';

export interface EnvVariable {
  name: string;
  value: string;
}

export interface VariablesTarget {
  orgId: string;
  appId: string;
  envId: string;
}

export type VariablesClient = Pick<
  VariablesApi,
  'listEnvironmentVariables' | 'updateEnvironmentVariable' | 'deleteEnvironmentVariable'
>;

export interface SetResult {
  name: string;
  ok: boolean;
  error?: string;
}

// Same rule the portal UI enforces when a variable is added by hand
// (ViewEnvironmentDetails::setVariable). The v3 API itself does not check it.
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export const REDEPLOY_NOTE =
  'Variable changes do not redeploy the environment. They take effect on the next redeploy.';

export function validateVariableName(name: string): string | null {
  if (VARIABLE_NAME_PATTERN.test(name)) return null;
  return `Invalid variable name '${name}'. Use a letter or '_' first, then letters, digits, '_', '.' or '-'.`;
}

// The v3 API validates `value` as required|string, so an empty value is a 422.
export function validateVariableValue(name: string, value: string): string | null {
  if (value.length > 0) return null;
  return `The value for '${name}' is empty. The API rejects empty values. To remove a variable, use \`qc env vars unset ${name}\`.`;
}

function toEnvVariable(item: unknown): EnvVariable | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  // v3 returns { key, value }; the upstream cloud API uses { name, value }.
  const name = typeof record.key === 'string' ? record.key : record.name;
  if (typeof name !== 'string' || name === '') return null;
  const value = record.value === undefined || record.value === null ? '' : String(record.value);
  return { name, value };
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const wrapped = (data as { environment?: unknown } | null)?.environment;
  return Array.isArray(wrapped) ? wrapped : [];
}

export function normaliseVariables(data: unknown): EnvVariable[] {
  return extractList(data)
    .map(toEnvVariable)
    .filter((v): v is EnvVariable => v !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseEnvFile(content: string): { variables: EnvVariable[]; errors: string[] } {
  const parsed = dotenv.parse(content);
  const variables: EnvVariable[] = [];
  const errors: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    const error = validateVariableName(name) ?? validateVariableValue(name, value);
    if (error) errors.push(error);
    else variables.push({ name, value });
  }
  return { variables, errors };
}

// Reads the whole stream. One trailing newline is removed, so
// `echo value | qc env vars set KEY --stdin` stores "value".
export async function readStreamValue(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export interface SetCommandInput {
  key?: string;
  value?: string;
  stdin?: boolean;
  file?: string;
}

export interface SetInputDeps {
  readStdin: () => Promise<string>;
  readFile: (path: string) => string;
}

export type SetInputResult = { variables: EnvVariable[]; errors?: undefined } | { variables?: undefined; errors: string[] };

const defaultDeps: SetInputDeps = {
  readStdin: () => readStreamValue(process.stdin),
  readFile: (path) => readFileSync(path, 'utf8'),
};

function resolveFileInput(input: SetCommandInput, deps: SetInputDeps): SetInputResult {
  if (input.key || input.value !== undefined || input.stdin) {
    return { errors: ['--file cannot be combined with KEY, VALUE or --stdin.'] };
  }
  let content: string;
  try {
    content = deps.readFile(input.file as string);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { errors: [`Cannot read '${input.file}': ${reason}`] };
  }
  const { variables, errors } = parseEnvFile(content);
  if (errors.length > 0) return { errors };
  if (variables.length === 0) return { errors: [`No variables found in '${input.file}'.`] };
  return { variables };
}

async function resolveSingleValue(input: SetCommandInput, deps: SetInputDeps): Promise<string | SetInputResult> {
  if (input.stdin && input.value !== undefined) {
    return { errors: ['Give VALUE or --stdin, not both.'] };
  }
  if (input.stdin) return deps.readStdin();
  if (input.value === undefined) {
    return { errors: ['Missing VALUE. To keep the value off the command line, use --stdin.'] };
  }
  return input.value;
}

export async function resolveSetInput(
  input: SetCommandInput,
  deps: SetInputDeps = defaultDeps
): Promise<SetInputResult> {
  if (input.file) return resolveFileInput(input, deps);
  if (!input.key) {
    return { errors: ['Missing KEY. Use `qc env vars set KEY VALUE`, `KEY --stdin`, or `--file <path>`.'] };
  }
  const nameError = validateVariableName(input.key);
  if (nameError) return { errors: [nameError] };

  const value = await resolveSingleValue(input, deps);
  if (typeof value !== 'string') return value;

  const valueError = validateVariableValue(input.key, value);
  if (valueError) return { errors: [valueError] };
  return { variables: [{ name: input.key, value }] };
}

export async function listVariables(api: VariablesClient, target: VariablesTarget): Promise<EnvVariable[]> {
  const response = await api.listEnvironmentVariables(target.orgId, target.appId, target.envId);
  return normaliseVariables(response.data as unknown);
}

// Each variable is written with its own PUT /variables/{key}. The bulk
// PUT /variables endpoint replaces the whole set and deletes every key it
// does not receive, so it is not safe for a merge from a .env file.
export async function setVariables(
  api: VariablesClient,
  target: VariablesTarget,
  variables: EnvVariable[]
): Promise<SetResult[]> {
  const results: SetResult[] = [];
  for (const variable of variables) {
    try {
      await api.updateEnvironmentVariable(target.orgId, target.appId, target.envId, variable.name, {
        value: variable.value,
      });
      results.push({ name: variable.name, ok: true });
    } catch (error) {
      results.push({ name: variable.name, ok: false, error: describeApiError(error) });
    }
  }
  return results;
}

export async function unsetVariable(api: VariablesClient, target: VariablesTarget, name: string): Promise<void> {
  await api.deleteEnvironmentVariable(target.orgId, target.appId, target.envId, name);
}

const STATUS_HINTS: Record<number, string> = {
  401: 'Authentication expired. Run `qc login` to re-authenticate.',
  403: 'Access denied. Changing variables needs the write_environments permission.',
  404: 'Environment not found. Check --org, --app and --env.',
};

export function describeApiError(error: unknown): string {
  const err = error as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  const status = err?.response?.status;
  const apiMessage = err?.response?.data?.message;
  if (typeof apiMessage === 'string' && apiMessage !== '') {
    return status ? `${apiMessage} (HTTP ${status})` : apiMessage;
  }
  if (status && STATUS_HINTS[status]) return STATUS_HINTS[status];
  return err?.message || String(error);
}
