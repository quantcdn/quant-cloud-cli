import { describe, it, expect } from '@jest/globals';
import { describeAwsCliSpawnError } from '../../src/utils/aws-cli.js';

describe('describeAwsCliSpawnError', () => {
  it('explains a wrong-architecture binary (macOS errno -86 / EBADARCH)', () => {
    const err = Object.assign(new Error('spawn Unknown system error -86'), { errno: -86, syscall: 'spawn aws' });
    const msg = describeAwsCliSpawnError(err);
    expect(msg).toMatch(/architecture/i);
    expect(msg).toMatch(/arm64|Apple silicon/i);
    expect(msg).toMatch(/aws/i);
  });

  it('recognises EBADARCH by code as well as errno', () => {
    const err = Object.assign(new Error('spawn aws EBADARCH'), { code: 'EBADARCH' });
    expect(describeAwsCliSpawnError(err)).toMatch(/architecture/i);
  });

  it('explains a missing binary (ENOENT)', () => {
    const err = Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' });
    const msg = describeAwsCliSpawnError(err);
    expect(msg).toMatch(/not installed|not found/i);
    expect(msg).toMatch(/https:\/\/aws\.amazon\.com\/cli/);
  });

  it('falls back to the raw message for other errors', () => {
    const err = Object.assign(new Error('spawn aws EACCES'), { code: 'EACCES' });
    expect(describeAwsCliSpawnError(err)).toContain('EACCES');
  });
});

import { spawnAwsCli } from '../../src/utils/aws-cli.js';

describe('spawnAwsCli', () => {
  it('rethrows a synchronous spawn failure with the descriptive message', () => {
    const badArch = Object.assign(new Error('spawn Unknown system error -86'), {
      errno: -86,
      code: 'Unknown system error -86',
    });
    const fakeSpawn = (() => { throw badArch; }) as unknown as typeof import('child_process').spawn;
    expect(() => spawnAwsCli(['--version'], {}, fakeSpawn)).toThrow(/architecture/i);
  });

  it('returns the child process when spawn succeeds', () => {
    const child = { fake: true };
    const fakeSpawn = (() => child) as unknown as typeof import('child_process').spawn;
    expect(spawnAwsCli(['--version'], {}, fakeSpawn)).toBe(child);
  });
});
