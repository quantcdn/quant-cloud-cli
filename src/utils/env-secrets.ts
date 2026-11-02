import type { SecretsApi } from '@quantcdn/quant-client';
import { EnvVariable, KindLabels, SetResult, VariablesTarget, describeApiError } from './env-vars.js';

// Secrets are write-only: the API returns names, never values.
export type SecretsClient = Pick<
  SecretsApi,
  'listEnvironmentSecrets' | 'updateEnvironmentSecret' | 'deleteEnvironmentSecret'
>;

export const SECRET_LABELS: KindLabels = { noun: 'secret', command: 'qc env secrets' };

export const SECRETS_REDEPLOY_NOTE =
  'Secret changes do not redeploy the environment. They take effect on the next redeploy.';

// A name is either a variable or a secret, never both. The API refuses the clash
// with a 409; this is the hint to move a value from a variable to a secret.
export const MOVE_TO_SECRET_HINT =
  'To move a variable to a secret: `qc env vars unset KEY`, then `qc env secrets set KEY --stdin`, then redeploy.';

function toSecretName(item: unknown): string | null {
  if (!item || typeof item !== 'object') return typeof item === 'string' && item !== '' ? item : null;
  const record = item as Record<string, unknown>;
  const name = typeof record.key === 'string' ? record.key : record.name;
  return typeof name === 'string' && name !== '' ? name : null;
}

// v3 returns [{ key }]; accept a bare string list or { secrets: [...] } too.
export function normaliseSecretNames(data: unknown): string[] {
  const list = Array.isArray(data) ? data : (data as { secrets?: unknown } | null)?.secrets;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(toSecretName).filter((n): n is string => n !== null))].sort((a, b) => a.localeCompare(b));
}

export async function listSecretNames(api: SecretsClient, target: VariablesTarget): Promise<string[]> {
  const response = await api.listEnvironmentSecrets(target.orgId, target.appId, target.envId);
  return normaliseSecretNames(response.data as unknown);
}

function isNameClash(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

// One PUT per secret, so one failure does not stop the others.
export async function setSecrets(
  api: SecretsClient,
  target: VariablesTarget,
  secrets: EnvVariable[]
): Promise<SetResult[]> {
  const results: SetResult[] = [];
  for (const secret of secrets) {
    try {
      await api.updateEnvironmentSecret(target.orgId, target.appId, target.envId, secret.name, { value: secret.value });
      results.push({ name: secret.name, ok: true });
    } catch (error) {
      const hint = isNameClash(error) ? ` ${MOVE_TO_SECRET_HINT}` : '';
      results.push({ name: secret.name, ok: false, error: describeApiError(error) + hint });
    }
  }
  return results;
}

export async function unsetSecret(api: SecretsClient, target: VariablesTarget, name: string): Promise<void> {
  await api.deleteEnvironmentSecret(target.orgId, target.appId, target.envId, name);
}
