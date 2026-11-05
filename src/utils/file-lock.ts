import { promises as fs, readFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * A lock older than this (by the holder's own timestamp) belongs to a process
 * that died, and is taken over. It must be longer than the refresh timeout.
 */
export const LOCK_STALE_MS = 90_000;

const POLL_MS = 100;
const MAX_WAIT_MS = 2 * LOCK_STALE_MS;
const DEFERRED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** What a holder writes into the lock file. `time` is the holder's own clock. */
interface LockRecord {
  nonce: string;
  pid: number;
  time: number;
}

/** Passed to the locked function. */
export interface HeldLock {
  /** Throws when another process has taken the lock over. */
  verify(): Promise<void>;
  /**
   * Verifies ownership and writes a new timestamp, so a holder that must keep
   * the lock longer than LOCK_STALE_MS is not taken over.
   */
  touch(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function parseRecord(content: string): LockRecord | null {
  try {
    const record = JSON.parse(content) as LockRecord;
    return typeof record.nonce === 'string' && typeof record.time === 'number' ? record : null;
  } catch {
    return null;
  }
}

/** The lock file content, or null when there is no lock file. */
async function readLock(lockFile: string): Promise<string | null> {
  try {
    return await fs.readFile(lockFile, 'utf-8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Staleness comes from the holder's timestamp in the file, not from mtime. A file
 * without a valid record (a holder between create and write) uses its mtime.
 */
async function isStale(lockFile: string, content: string): Promise<boolean> {
  const record = parseRecord(content);
  if (record) {
    return Date.now() - record.time > LOCK_STALE_MS;
  }
  const { mtimeMs } = await fs.stat(lockFile);
  return Date.now() - mtimeMs > LOCK_STALE_MS;
}

/** Puts a lock file that was moved aside back, unless a new lock exists now. */
async function restoreLock(aside: string, lockFile: string): Promise<void> {
  try {
    await fs.link(aside, lockFile);
    await fs.unlink(aside);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      await fs.unlink(aside).catch(() => undefined);
      return;
    }
    await fs.rename(aside, lockFile).catch(() => undefined);
  }
}

/**
 * Removes a stale lock. The file is first moved to a unique name, so only one
 * process can take it. If the moved file is not the stale lock that was
 * inspected (another process replaced it), it is put back.
 */
async function breakStaleLock(lockFile: string, inspected: string): Promise<void> {
  const aside = `${lockFile}.stale.${randomBytes(6).toString('hex')}`;
  try {
    await fs.rename(lockFile, aside);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
  if ((await readLock(aside)) === inspected) {
    await fs.unlink(aside).catch(() => undefined);
    return;
  }
  await restoreLock(aside, lockFile);
}

async function removeIfStale(lockFile: string): Promise<void> {
  const content = await readLock(lockFile);
  if (content !== null && (await isStale(lockFile, content))) {
    await breakStaleLock(lockFile, content);
  }
}

/** Writes the record. On failure the half-made lock file is removed. */
async function writeRecord(handle: fs.FileHandle, lockFile: string, record: LockRecord): Promise<void> {
  try {
    await handle.writeFile(JSON.stringify(record));
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.unlink(lockFile).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

/** Creates the lock file. Returns the record, or null when another process holds it. */
async function tryAcquire(lockFile: string): Promise<LockRecord | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(lockFile, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return null;
    }
    throw error;
  }
  const record = { nonce: randomBytes(16).toString('hex'), pid: process.pid, time: Date.now() };
  await writeRecord(handle, lockFile, record);
  return record;
}

async function acquire(lockFile: string): Promise<LockRecord> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const record = await tryAcquire(lockFile);
    if (record) {
      return record;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lockFile}. If no other qc command is running, delete that file.`);
    }
    await removeIfStale(lockFile);
    await sleep(POLL_MS);
  }
}

function ownsSync(lockFile: string, nonce: string): boolean {
  try {
    return parseRecord(readFileSync(lockFile, 'utf-8'))?.nonce === nonce;
  } catch {
    return false;
  }
}

async function owns(lockFile: string, nonce: string): Promise<boolean> {
  const content = await readLock(lockFile).catch(() => null);
  return content !== null && parseRecord(content)?.nonce === nonce;
}

/** Releases the lock only if this holder still owns it. */
async function release(lockFile: string, nonce: string): Promise<void> {
  if (await owns(lockFile, nonce)) {
    await fs.unlink(lockFile).catch(() => undefined);
  }
}

/**
 * Removes the lock on process.exit, and defers SIGINT/SIGTERM until the locked
 * work is done, so a refresh is not cut off between the request and the save.
 */
function guardProcess(lockFile: string, nonce: string): () => void {
  const pending: NodeJS.Signals[] = [];
  const onExit = () => {
    if (ownsSync(lockFile, nonce)) {
      try {
        unlinkSync(lockFile);
      } catch {
        // Nothing more can be done while the process exits.
      }
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    pending.push(signal);
  };
  process.on('exit', onExit);
  DEFERRED_SIGNALS.forEach((signal) => process.on(signal, onSignal));
  return () => {
    process.off('exit', onExit);
    DEFERRED_SIGNALS.forEach((signal) => process.off(signal, onSignal));
    if (pending.length > 0) {
      process.kill(process.pid, pending[0]);
    }
  };
}

/**
 * Runs fn while this process holds an exclusive lock file. Every qc process that
 * uses the same lock file waits for the others, in this process and in others.
 */
export async function withFileLock<T>(lockFile: string, fn: (lock: HeldLock) => Promise<T>): Promise<T> {
  const { nonce } = await acquire(lockFile);
  const unguard = guardProcess(lockFile, nonce);
  const verify = async () => {
    if (!(await owns(lockFile, nonce))) {
      throw new Error(`Lost the lock ${lockFile} to another process`);
    }
  };
  const lock: HeldLock = {
    verify,
    touch: async () => {
      await verify();
      await fs.writeFile(lockFile, JSON.stringify({ nonce, pid: process.pid, time: Date.now() }));
    },
  };
  try {
    return await fn(lock);
  } finally {
    await release(lockFile, nonce);
    unguard();
  }
}
