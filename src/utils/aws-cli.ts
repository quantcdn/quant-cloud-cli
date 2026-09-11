import { spawn, ChildProcess, SpawnOptions } from 'child_process';

/**
 * Human-readable explanations for failures to spawn the `aws` CLI binary.
 */

interface SpawnError extends Error {
  code?: string;
  errno?: number;
}

/** macOS errno for "Bad CPU type in executable"; Node reports it as EBADARCH or -86. */
const EBADARCH_ERRNO = -86;

const INSTALL_URL = 'https://aws.amazon.com/cli/';

const WRONG_ARCH_MESSAGE =
  'The installed aws CLI is built for a different CPU architecture than this machine ' +
  '(for example an x86_64 binary on Apple silicon without Rosetta). ' +
  'Reinstall the native arm64 AWS CLI: ' +
  'curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o AWSCLIV2.pkg && sudo installer -pkg AWSCLIV2.pkg -target /';

const NOT_FOUND_MESSAGE = `AWS CLI is required but not installed. Please install it first: ${INSTALL_URL}`;

function isBadArch(error: SpawnError): boolean {
  return error.code === 'EBADARCH' || error.errno === EBADARCH_ERRNO;
}

export function describeAwsCliSpawnError(error: SpawnError): string {
  if (isBadArch(error)) {
    return WRONG_ARCH_MESSAGE;
  }
  if (error.code === 'ENOENT') {
    return NOT_FOUND_MESSAGE;
  }
  return `Failed to execute AWS CLI: ${error.message}`;
}

/**
 * Spawn the aws CLI. Node throws synchronously for errnos it does not classify
 * (macOS EBADARCH is one), so a plain spawn() never reaches the 'error' handler.
 * This wrapper converts that synchronous throw into a descriptive Error.
 */
export function spawnAwsCli(
  args: string[],
  options: SpawnOptions,
  spawnFn: typeof spawn = spawn
): ChildProcess {
  try {
    return spawnFn('aws', args, options);
  } catch (error) {
    throw new Error(describeAwsCliSpawnError(error as SpawnError));
  }
}
