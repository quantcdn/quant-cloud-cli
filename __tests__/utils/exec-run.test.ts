import { describe, it, expect, jest } from '@jest/globals';
import { isTerminalRun, pollCommandRun } from '../../src/utils/exec-run.js';

describe('isTerminalRun', () => {
  it('is terminal when exitCode is present (including 0)', () => {
    expect(isTerminalRun({ exitCode: 0 })).toBe(true);
    expect(isTerminalRun({ exitCode: 137 })).toBe(true);
  });

  it('is terminal when endTime is present', () => {
    expect(isTerminalRun({ endTime: '2026-07-16T00:00:00Z' })).toBe(true);
  });

  it('is terminal for terminal-looking statuses, case-insensitively', () => {
    expect(isTerminalRun({ status: 'COMPLETED' })).toBe(true);
    expect(isTerminalRun({ status: 'failed' })).toBe(true);
    expect(isTerminalRun({ status: 'Stopped' })).toBe(true);
  });

  it('is terminal for the platform terminal states', () => {
    expect(isTerminalRun({ status: 'SUCCEEDED' })).toBe(true);
    expect(isTerminalRun({ status: 'FAILED' })).toBe(true);
    expect(isTerminalRun({ status: 'TIMED_OUT' })).toBe(true);
    expect(isTerminalRun({ status: 'UNKNOWN' })).toBe(true);
    expect(isTerminalRun({ status: 'PENDING' })).toBe(false);
    expect(isTerminalRun({ status: 'RUNNING' })).toBe(false);
  });

  it('is not terminal while running', () => {
    expect(isTerminalRun({ status: 'RUNNING', startTime: '2026-07-16T00:00:00Z' })).toBe(false);
    expect(isTerminalRun({})).toBe(false);
  });
});

describe('pollCommandRun', () => {
  it('resolves immediately when the first fetch is terminal, emitting all output', async () => {
    const onOutputLines = jest.fn();
    const run = { exitCode: 0, output: ['line 1', 'line 2'] };
    const result = await pollCommandRun(async () => run, {
      intervalMs: 1,
      onOutputLines,
    });
    expect(result).toEqual(run);
    expect(onOutputLines).toHaveBeenCalledTimes(1);
    expect(onOutputLines).toHaveBeenCalledWith(['line 1', 'line 2']);
  });

  it('emits only new output lines across polls', async () => {
    const onOutputLines = jest.fn();
    const responses = [
      { status: 'RUNNING', output: ['a'] },
      { status: 'RUNNING', output: ['a', 'b', 'c'] },
      { exitCode: 0, output: ['a', 'b', 'c', 'd'] },
    ];
    let i = 0;
    await pollCommandRun(async () => responses[i++], {
      intervalMs: 1,
      onOutputLines,
    });
    expect(onOutputLines.mock.calls).toEqual([[['a']], [['b', 'c']], [['d']]]);
  });

  it('tolerates missing or shrinking output arrays', async () => {
    const onOutputLines = jest.fn();
    const responses = [
      { status: 'RUNNING', output: ['a', 'b'] },
      { status: 'RUNNING' },
      { exitCode: 0, output: ['a'] },
    ];
    let i = 0;
    const result = await pollCommandRun(async () => responses[i++], {
      intervalMs: 1,
      onOutputLines,
    });
    expect(result).toEqual({ exitCode: 0, output: ['a'] });
    expect(onOutputLines.mock.calls).toEqual([[['a', 'b']]]);
  });

  it('rejects after maxConsecutiveFailures consecutive fetch errors', async () => {
    const onPollError = jest.fn();
    const fetchRun = async () => {
      throw new Error('network down');
    };
    await expect(
      pollCommandRun(fetchRun, { intervalMs: 1, maxConsecutiveFailures: 3, onPollError })
    ).rejects.toThrow('Polling aborted after 3 consecutive failures');
    expect(onPollError).toHaveBeenCalledTimes(3);
    expect(onPollError).toHaveBeenLastCalledWith(expect.any(Error), 3);
  });

  it('resets the failure counter after a successful fetch', async () => {
    const responses: Array<(() => never) | { status?: string; exitCode?: number }> = [
      () => { throw new Error('blip 1'); },
      () => { throw new Error('blip 2'); },
      { status: 'RUNNING' },
      () => { throw new Error('blip 3'); },
      () => { throw new Error('blip 4'); },
      { exitCode: 0 },
    ];
    let i = 0;
    const fetchRun = async () => {
      const r = responses[i++];
      if (typeof r === 'function') return r();
      return r;
    };
    const result = await pollCommandRun(fetchRun, {
      intervalMs: 1,
      maxConsecutiveFailures: 3,
    });
    expect(result).toEqual({ exitCode: 0 });
  });

  it('defaults to aborting after 5 consecutive failures', async () => {
    let attempts = 0;
    const fetchRun = async () => {
      attempts++;
      throw new Error('down');
    };
    await expect(pollCommandRun(fetchRun, { intervalMs: 1 })).rejects.toThrow(
      'Polling aborted after 5 consecutive failures'
    );
    expect(attempts).toBe(5);
  });

  it('resolves null promptly when cancelled, even with a long interval', async () => {
    let polls = 0;
    const fetchRun = async () => {
      polls++;
      return { status: 'RUNNING' };
    };
    const started = Date.now();
    const result = await pollCommandRun(fetchRun, {
      intervalMs: 60_000,
      isCancelled: () => polls >= 1,
    });
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
