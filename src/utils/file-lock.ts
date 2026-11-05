import { promises as fs } from 'fs';

/** A lock older than this belongs to a process that died, and is taken over. */
export const LOCK_STALE_MS = 30_000;

const POLL_MS = 100;
const MAX_WAIT_MS = 2 * LOCK_STALE_MS;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

/** Removes the lock file if its owner has held it for longer than LOCK_STALE_MS. */
async function removeIfStale(lockFile: string): Promise<void> {
  try {
    const { mtimeMs } = await fs.stat(lockFile);
    if (Date.now() - mtimeMs > LOCK_STALE_MS) {
      await fs.unlink(lockFile);
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}

/** Creates the lock file. Returns false when another process holds it. */
async function tryAcquire(lockFile: string): Promise<boolean> {
  try {
    const handle = await fs.open(lockFile, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

async function acquire(lockFile: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (!(await tryAcquire(lockFile))) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lockFile}. If no other qc command is running, delete that file.`);
    }
    await removeIfStale(lockFile);
    await sleep(POLL_MS);
  }
}

/**
 * Runs fn while this process holds an exclusive lock file. Every qc process that
 * uses the same lock file waits for the others, in this process and in others.
 */
export async function withFileLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T> {
  await acquire(lockFile);
  try {
    return await fn();
  } finally {
    await fs.unlink(lockFile).catch(() => undefined);
  }
}
