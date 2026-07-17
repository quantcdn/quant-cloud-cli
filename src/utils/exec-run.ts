import type { Command as CommandRun } from '@quantcdn/quant-client';

// SUCCEEDED / FAILED / TIMED_OUT / UNKNOWN are the platform's terminal
// states (see portal CommandStatusDisplay::TERMINAL_STATES); the rest are
// kept as a defensive superset.
const TERMINAL_STATUSES = new Set([
  'complete',
  'completed',
  'success',
  'succeeded',
  'failed',
  'failure',
  'error',
  'stopped',
  'cancelled',
  'timed_out',
  'unknown',
]);

export function isTerminalRun(run: CommandRun): boolean {
  if (typeof run.exitCode === 'number') return true;
  if (run.endTime) return true;
  if (run.status && TERMINAL_STATUSES.has(run.status.toLowerCase())) return true;
  return false;
}

export interface PollOptions {
  intervalMs: number;
  maxConsecutiveFailures?: number;
  fetchTimeoutMs?: number;
  onOutputLines?: (lines: string[]) => void;
  onPollError?: (error: Error, consecutiveFailures: number) => void;
  isCancelled?: () => boolean;
}

// Requests have no transport-level timeout by default (axios waits forever),
// so a socket that dies without an RST — e.g. after laptop suspend/resume —
// would hang the poll loop indefinitely. Racing each fetch against a deadline
// turns a hung request into an ordinary poll failure that retries on a fresh
// connection next interval.
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Poll request timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Sleep in short chunks so Ctrl+C (cancellation) is noticed quickly
// even with long poll intervals.
const CANCEL_CHECK_MS = 200;

async function sleepUnlessCancelled(ms: number, isCancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !isCancelled()) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(CANCEL_CHECK_MS, remaining)));
  }
}

export async function pollCommandRun(
  fetchRun: () => Promise<CommandRun>,
  options: PollOptions
): Promise<CommandRun | null> {
  const maxFailures = options.maxConsecutiveFailures ?? 5;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const isCancelled = options.isCancelled ?? (() => false);
  let printedLines = 0;
  let consecutiveFailures = 0;

  for (;;) {
    if (isCancelled()) return null;

    let run: CommandRun | undefined;
    try {
      run = await fetchWithTimeout(fetchRun(), fetchTimeoutMs);
      consecutiveFailures = 0;
    } catch (error: any) {
      consecutiveFailures++;
      options.onPollError?.(error, consecutiveFailures);
      if (consecutiveFailures >= maxFailures) {
        throw new Error(
          `Polling aborted after ${consecutiveFailures} consecutive failures: ${error?.message || error}`
        );
      }
    }

    if (run) {
      const output = run.output ?? [];
      if (output.length > printedLines) {
        options.onOutputLines?.(output.slice(printedLines));
        printedLines = output.length;
      }
      if (isTerminalRun(run)) return run;
    }

    await sleepUnlessCancelled(options.intervalMs, isCancelled);
  }
}
