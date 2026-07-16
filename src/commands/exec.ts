import { Command } from 'commander';
import chalk from 'chalk';
import { getActivePlatformConfig } from '../utils/config.js';
import { ApiClient } from '../utils/api.js';
import { createSpinner } from '../utils/spinner.js';
import { pollCommandRun } from '../utils/exec-run.js';
import type { Command as CommandRun } from '@quantcdn/quant-client';

interface ExecContextOptions {
  org?: string;
  app?: string;
  env?: string;
  platform?: string;
}

interface ExecRunOptions extends ExecContextOptions {
  detach?: boolean;
  interval?: string;
}

interface ExecStatusOptions extends ExecContextOptions {
  watch?: boolean;
  interval?: string;
}

const DEFAULT_INTERVAL_SEC = 15;
const MIN_INTERVAL_SEC = 5;

function resolveIntervalMs(interval?: string): number {
  const parsed = parseInt(interval ?? '', 10);
  const seconds = Number.isFinite(parsed) ? Math.max(MIN_INTERVAL_SEC, parsed) : DEFAULT_INTERVAL_SEC;
  return seconds * 1000;
}

async function resolveExecContext(
  options: ExecContextOptions
): Promise<{ client: ApiClient; orgId: string; envId: string } | null> {
  const auth = await getActivePlatformConfig();
  if (!auth || !auth.token) {
    console.log(chalk.red('Not authenticated. Run `quant-cloud login` to authenticate.'));
    process.exitCode = 1;
    return null;
  }

  const client = await ApiClient.create({
    org: options.org,
    app: options.app,
    env: options.env,
    platform: options.platform,
  });

  const orgId = options.org || auth.activeOrganization;
  const envId = options.env || auth.activeEnvironment;

  if (!orgId) {
    console.log(chalk.red('No organization specified. Use --org or set active organization.'));
    process.exitCode = 1;
    return null;
  }
  if (!envId) {
    console.log(chalk.red('No environment specified. Use --env or set active environment.'));
    process.exitCode = 1;
    return null;
  }

  return { client, orgId, envId };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function reattachHint(runId: string): string {
  return chalk.yellow(`Run continues on the server. Reattach with: qc exec status ${runId} --watch`);
}

function printRunSummary(run: CommandRun): void {
  console.log(`${chalk.gray('Run ID:')} ${chalk.cyan(run.runId || 'unknown')}`);
  if (run.command) console.log(`${chalk.gray('Command:')} ${run.command}`);
  console.log(`${chalk.gray('Status:')} ${run.status || 'unknown'}`);
  if (run.targetContainerName) console.log(`${chalk.gray('Container:')} ${run.targetContainerName}`);
  if (run.startTime) console.log(`${chalk.gray('Started:')} ${new Date(run.startTime).toLocaleString()}`);
  if (run.endTime) console.log(`${chalk.gray('Ended:')} ${new Date(run.endTime).toLocaleString()}`);
  if (typeof run.exitCode === 'number') console.log(`${chalk.gray('Exit code:')} ${run.exitCode}`);
}

async function watchRun(
  client: ApiClient,
  orgId: string,
  envId: string,
  runId: string,
  intervalMs: number
): Promise<void> {
  let cancelled = false;
  const sigintHandler = () => {
    cancelled = true;
  };
  process.on('SIGINT', sigintHandler);

  const startedAt = Date.now();
  const spinner = createSpinner(`Running (runId: ${runId})`);
  const ticker = setInterval(() => {
    spinner.text = `Running (runId: ${runId}, ${formatElapsed(Date.now() - startedAt)})`;
  }, 1000);

  try {
    const finalRun = await pollCommandRun(
      async () => (await client.commandsApi.getCommand(orgId, envId, runId)).data,
      {
        intervalMs,
        onOutputLines: (lines) => {
          spinner.stop();
          for (const line of lines) console.log(line);
          spinner.start(spinner.text);
        },
        isCancelled: () => cancelled,
      }
    );

    if (!finalRun) {
      spinner.warn('Detached.');
      console.log(reattachHint(runId));
      return;
    }

    const elapsed = formatElapsed(Date.now() - startedAt);
    if (finalRun.exitCode === 0) {
      spinner.succeed(`Completed (exit 0) in ${elapsed}`);
    } else if (typeof finalRun.exitCode === 'number') {
      spinner.fail(`Completed (exit ${finalRun.exitCode}) in ${elapsed}`);
    } else {
      spinner.warn(`Finished with status '${finalRun.status || 'unknown'}' in ${elapsed}`);
    }
    if (typeof finalRun.exitCode === 'number') {
      process.exitCode = finalRun.exitCode;
    }
  } catch (error: any) {
    spinner.fail(`Stopped polling: ${error.message || String(error)}`);
    console.log(reattachHint(runId));
    process.exitCode = 1;
  } finally {
    clearInterval(ticker);
    process.removeListener('SIGINT', sigintHandler);
  }
}

async function handleRun(cmd: string, options: ExecRunOptions): Promise<void> {
  const context = await resolveExecContext(options);
  if (!context) return;
  const { client, orgId, envId } = context;

  const spinner = createSpinner('Creating command run...');
  let runId: string | undefined;
  try {
    const created = (await client.commandsApi.createCommand(orgId, envId, { command: cmd })).data;
    runId = created.runId;
  } catch (error: any) {
    spinner.fail(`Failed to create command run: ${error.message || String(error)}`);
    if (error.response?.status === 403) {
      console.log(chalk.yellow('\n💡 You may not have access to run commands on this environment.'));
    }
    process.exitCode = 1;
    return;
  }

  if (!runId) {
    spinner.fail('API did not return a run ID.');
    process.exitCode = 1;
    return;
  }

  spinner.succeed(`Command created (runId: ${chalk.cyan(runId)})`);

  if (options.detach) {
    console.log(chalk.gray(`Check progress with: qc exec status ${runId} --watch`));
    return;
  }

  await watchRun(client, orgId, envId, runId, resolveIntervalMs(options.interval));
}

async function handleStatus(runId: string, options: ExecStatusOptions): Promise<void> {
  const context = await resolveExecContext(options);
  if (!context) return;
  const { client, orgId, envId } = context;

  if (options.watch) {
    await watchRun(client, orgId, envId, runId, resolveIntervalMs(options.interval));
    return;
  }

  const spinner = createSpinner('Fetching run status...');
  try {
    const run = (await client.commandsApi.getCommand(orgId, envId, runId)).data;
    spinner.stop();
    printRunSummary(run);
    const output = run.output ?? [];
    if (output.length > 0) {
      console.log();
      for (const line of output) console.log(line);
    }
  } catch (error: any) {
    spinner.fail(`Failed to fetch run: ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}

async function handleList(options: ExecContextOptions): Promise<void> {
  const context = await resolveExecContext(options);
  if (!context) return;
  const { client, orgId, envId } = context;

  const spinner = createSpinner('Fetching command runs...');
  try {
    const response = await client.commandsApi.listCommands(orgId, envId);
    const runs: CommandRun[] = Array.isArray(response.data) ? response.data : [response.data];
    spinner.stop();

    if (runs.length === 0 || (runs.length === 1 && !runs[0]?.runId)) {
      console.log(chalk.gray('No command runs found for this environment.'));
      return;
    }

    const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    console.log(
      chalk.bold(
        `${'RUN ID'.padEnd(38)} ${'STATUS'.padEnd(12)} ${'STARTED'.padEnd(22)} COMMAND`
      )
    );
    for (const run of runs) {
      const started = run.startTime ? new Date(run.startTime).toLocaleString() : '-';
      console.log(
        `${(run.runId || '-').padEnd(38)} ${(run.status || '-').padEnd(12)} ${started.padEnd(22)} ${truncate(run.command || '-', 40)}`
      );
    }
  } catch (error: any) {
    spinner.fail(`Failed to list runs: ${error.message || String(error)}`);
    process.exitCode = 1;
  }
}

function withContextOptions(cmd: Command): Command {
  return cmd
    .option('--org <org>', 'organization machine name')
    .option('--app <app>', 'application machine name')
    .option('--env <env>', 'environment name')
    .option('--platform <platform>', 'platform to use (override active platform)');
}

export const execCommand = new Command('exec').description(
  'Run commands server-side on an environment (survives laptop sleep/disconnect)'
);

withContextOptions(
  execCommand
    .command('run <cmd>')
    .description('Run a command server-side and watch it until it completes')
    .option('--detach', 'start the run and return immediately')
    .option('--interval <sec>', `poll interval in seconds (default ${DEFAULT_INTERVAL_SEC}, min ${MIN_INTERVAL_SEC})`)
).action(handleRun);

withContextOptions(
  execCommand
    .command('status <runId>')
    .description('Show status and output for a command run')
    .option('--watch', 'poll until the run completes (reattach)')
    .option('--interval <sec>', `poll interval in seconds (default ${DEFAULT_INTERVAL_SEC}, min ${MIN_INTERVAL_SEC})`)
).action(handleStatus);

withContextOptions(
  execCommand.command('list').description('List command runs for the environment')
).action(handleList);
