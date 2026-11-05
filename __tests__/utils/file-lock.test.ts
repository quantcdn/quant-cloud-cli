import { describe, it, expect, jest, afterEach, afterAll } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { withFileLock, LOCK_STALE_MS } from '../../src/utils/file-lock.js';

const dir = mkdtempSync(join(tmpdir(), 'qc-file-lock-'));
let n = 0;
const nextLock = () => join(dir, `credentials.${++n}.lock`);
const record = (time: number, nonce = 'other') => JSON.stringify({ nonce, pid: 1, time });

afterEach(() => jest.restoreAllMocks());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('withFileLock', () => {
  it('writes a nonce record while held and removes the file after', async () => {
    const lockFile = nextLock();
    const seen = await withFileLock(lockFile, async () => JSON.parse(readFileSync(lockFile, 'utf-8')));
    expect(typeof seen.nonce).toBe('string');
    expect(seen.pid).toBe(process.pid);
    expect(existsSync(lockFile)).toBe(false);
  });

  it('runs one holder at a time', async () => {
    const lockFile = nextLock();
    const events: string[] = [];
    const work = (name: string) => withFileLock(lockFile, async () => {
      events.push(`${name}-start`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push(`${name}-end`);
    });
    await Promise.all([work('a'), work('b')]);
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('takes over a lock whose holder timestamp is stale', async () => {
    const lockFile = nextLock();
    writeFileSync(lockFile, record(Date.now() - LOCK_STALE_MS - 1000));
    expect(await withFileLock(lockFile, async () => 'ran')).toBe('ran');
    expect(existsSync(lockFile)).toBe(false);
  });

  it('waits for a lock whose holder timestamp is fresh, even with an old mtime', async () => {
    const lockFile = nextLock();
    writeFileSync(lockFile, record(Date.now()));
    const old = new Date(Date.now() - 10 * LOCK_STALE_MS);
    await fsp.utimes(lockFile, old, old);
    let ran = false;
    const pending = withFileLock(lockFile, async () => { ran = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ran).toBe(false);
    rmSync(lockFile);
    await pending;
    expect(ran).toBe(true);
  });

  it('does not delete a lock that another process now owns, and verify() fails', async () => {
    const lockFile = nextLock();
    const taken = record(Date.now(), 'someone-else');
    let verifyError: unknown;
    await withFileLock(lockFile, async (lock) => {
      writeFileSync(lockFile, taken);
      verifyError = await lock.verify().catch((error) => error);
    });
    expect(verifyError).toBeInstanceOf(Error);
    expect(readFileSync(lockFile, 'utf-8')).toBe(taken);
  });

  it('removes the lock file when the record cannot be written', async () => {
    const lockFile = nextLock();
    const realOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, 'open').mockImplementationOnce(async (...args: any[]) => {
      const handle: any = await (realOpen as any)(...args);
      handle.writeFile = async () => { throw new Error('disk full'); };
      return handle;
    });
    await expect(withFileLock(lockFile, async () => 'ran')).rejects.toThrow('disk full');
    expect(existsSync(lockFile)).toBe(false);
  });

  it('adds an exit handler while held and removes it on release', async () => {
    const before = process.listenerCount('exit');
    const during = await withFileLock(nextLock(), async () => process.listenerCount('exit'));
    expect(during).toBe(before + 1);
    expect(process.listenerCount('exit')).toBe(before);
  });
});
