import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getActivePlatformConfig } from '../utils/config.js';
import { ApiClient } from '../utils/api.js';
import { createSpinner } from '../utils/spinner.js';
import {
  REDEPLOY_NOTE,
  EnvVariable,
  SetResult,
  VariablesTarget,
  describeApiError,
  listVariables,
  maskValue,
  resolveSetInput,
  sanitizeForTerminal,
  setVariables,
  unsetVariable,
  validateVariableName,
} from '../utils/env-vars.js';

interface VarsContextOptions {
  org?: string;
  app?: string;
  env?: string;
  platform?: string;
}

interface VarsListOptions extends VarsContextOptions {
  json?: boolean;
  showValues?: boolean;
}

interface VarsUnsetOptions extends VarsContextOptions {
  yes?: boolean;
}

interface VarsSetOptions extends VarsContextOptions {
  stdin?: boolean;
  file?: string;
}

interface VarsContext {
  client: ApiClient;
  target: VariablesTarget;
}

function fail(message: string): void {
  console.error(chalk.red(message));
  process.exitCode = 1;
}

function missingContextMessage(orgId?: string, appId?: string): string {
  if (!orgId) return 'No organization specified. Use --org or set active organization.';
  if (!appId) return 'No application specified. Use --app or set active application.';
  return 'No environment specified. Use --env or set active environment.';
}

async function resolveVarsContext(options: VarsContextOptions): Promise<VarsContext | null> {
  const auth = await getActivePlatformConfig();
  if (!auth || !auth.token) {
    fail('Not authenticated. Run `qc login` to authenticate.');
    return null;
  }

  // ApiClient.create resolves CLI flags > .quant.yml > active context.
  const client = await ApiClient.create({
    org: options.org,
    app: options.app,
    env: options.env,
    platform: options.platform,
  });
  const orgId: string | undefined = client['defaultOrganizationId'];
  const appId: string | undefined = client['defaultApplicationId'];
  const envId: string | undefined = client['defaultEnvironmentId'];

  if (!orgId || !appId || !envId) {
    fail(missingContextMessage(orgId, appId));
    return null;
  }
  return { client, target: { orgId, appId, envId } };
}

function targetLabel(target: VariablesTarget): string {
  return `${target.orgId}/${target.appId}/${target.envId}`;
}

function printRedeployHint(target: VariablesTarget): void {
  console.log(chalk.yellow(REDEPLOY_NOTE));
  console.log(
    chalk.gray('To apply now: ') +
      chalk.cyan(`qc env state redeploy --org ${target.orgId} --app ${target.appId} --env ${target.envId}`)
  );
}

// Values are masked unless --show-values, so a list in a CI log does not
// leak them. `get KEY` still prints one value on purpose.
function visibleVariables(variables: EnvVariable[], showValues?: boolean): EnvVariable[] {
  return showValues ? variables : variables.map((v) => ({ name: v.name, value: maskValue(v.value) }));
}

function printVariablesTable(variables: EnvVariable[], target: VariablesTarget, showValues?: boolean): void {
  // Sanitize first, so the column width is measured on what is printed.
  const rows = variables.map((v) => ({ name: sanitizeForTerminal(v.name), value: sanitizeForTerminal(v.value) }));
  const width = Math.max(4, ...rows.map((row) => row.name.length));
  console.log(chalk.bold(`${'NAME'.padEnd(width)}  VALUE`));
  for (const row of rows) {
    console.log(`${chalk.cyan(row.name.padEnd(width))}  ${row.value}`);
  }
  console.log(chalk.gray(`\n${variables.length} variable(s) on ${targetLabel(target)}`));
  if (!showValues) console.log(chalk.gray('Values are hidden. Use --show-values to print them.'));
}

async function handleList(options: VarsListOptions): Promise<void> {
  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  // No spinner with --json: the spinner writes to stdout and would corrupt the JSON.
  const spinner = options.json ? null : createSpinner('Fetching variables...');
  try {
    const variables = visibleVariables(await listVariables(client.variablesApi, target), options.showValues);
    spinner?.stop();
    if (options.json) {
      console.log(JSON.stringify(variables, null, 2));
      return;
    }
    if (variables.length === 0) {
      console.log(chalk.gray(`No variables set on ${targetLabel(target)}.`));
      return;
    }
    printVariablesTable(variables, target, options.showValues);
  } catch (error) {
    spinner?.stop();
    fail(`Failed to list variables: ${describeApiError(error)}`);
  }
}

async function handleGet(key: string, options: VarsContextOptions): Promise<void> {
  const nameError = validateVariableName(key);
  if (nameError) return fail(nameError);

  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  try {
    const variables = await listVariables(client.variablesApi, target);
    const match = variables.find((v) => v.name === key);
    if (!match) return fail(`Variable '${key}' is not set on ${targetLabel(target)}.`);
    // Raw value only, so `$(qc env vars get KEY)` works in scripts. On a
    // terminal, control characters are removed first.
    const value = process.stdout.isTTY ? sanitizeForTerminal(match.value, { keepNewlines: true }) : match.value;
    process.stdout.write(`${value}\n`);
  } catch (error) {
    fail(`Failed to get variable: ${describeApiError(error)}`);
  }
}

function reportSetResults(results: SetResult[], target: VariablesTarget): void {
  for (const result of results) {
    if (result.ok) console.log(`${chalk.green('✔')} Set ${chalk.cyan(result.name)} on ${targetLabel(target)}`);
    else console.error(`${chalk.red('✖')} ${chalk.cyan(result.name)}: ${result.error}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    fail(`${failed} of ${results.length} variable(s) failed. The others were saved.`);
  }
  if (failed < results.length) printRedeployHint(target);
}

async function handleSet(key: string | undefined, value: string | undefined, options: VarsSetOptions): Promise<void> {
  // Read and validate the input before any API call, so a bad file or
  // missing value never reaches the environment.
  const input = await resolveSetInput({ key, value, stdin: options.stdin, file: options.file });
  if (input.errors) {
    for (const error of input.errors) console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  const spinner = createSpinner(`Setting ${input.variables.length} variable(s) on ${targetLabel(target)}...`);
  const results = await setVariables(client.variablesApi, target, input.variables);
  spinner.stop();
  reportSetResults(results, target);
}

// Asks only on a terminal. Scripts and CI (no TTY) and --yes go ahead.
async function confirmUnset(key: string, target: VariablesTarget, options: VarsUnsetOptions): Promise<boolean> {
  if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) return true;
  const { confirmUnset: ok } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUnset',
      message: `Remove ${key} from ${targetLabel(target)}?`,
      default: false,
    },
  ]);
  return ok;
}

async function handleUnset(key: string, options: VarsUnsetOptions): Promise<void> {
  const nameError = validateVariableName(key);
  if (nameError) return fail(nameError);

  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  const spinner = createSpinner(`Checking ${key} on ${targetLabel(target)}...`);
  try {
    // DELETE is idempotent upstream (204 for a missing key), so check first
    // to tell the user when nothing changed.
    const variables = await listVariables(client.variablesApi, target);
    spinner.stop();
    if (!variables.some((v) => v.name === key)) {
      console.log(chalk.yellow(`Variable '${key}' is not set on ${targetLabel(target)}. Nothing changed.`));
      return;
    }
    if (!(await confirmUnset(key, target, options))) {
      console.log(chalk.gray('Cancelled. Nothing changed.'));
      return;
    }
    spinner.start(`Removing ${key} from ${targetLabel(target)}...`);
    await unsetVariable(client.variablesApi, target, key);
    spinner.succeed(`Removed ${chalk.cyan(key)} from ${targetLabel(target)}`);
    printRedeployHint(target);
  } catch (error) {
    spinner.stop();
    fail(`Failed to remove variable: ${describeApiError(error)}`);
  }
}

function withContextOptions(cmd: Command): Command {
  return cmd
    .option('--org <org>', 'organization machine name')
    .option('--app <app>', 'application machine name')
    .option('--env <env>', 'environment name')
    .option('--platform <platform>', 'platform to use (override active platform)');
}

const WRITE_HELP = `
${REDEPLOY_NOTE}
Apply them with: qc env state redeploy --env <env>`;

export function envVarsCommand(env: Command): void {
  const vars = env.command('vars').description('Manage environment variables');

  withContextOptions(
    vars
      .command('list')
      .description('List variables of an environment (values are hidden unless --show-values)')
      .option('--json', 'Output as JSON')
      .option('--show-values', 'print the values, not a mask')
  ).action(handleList);

  withContextOptions(
    vars.command('get').description('Print the value of one variable').argument('<key>', 'variable name')
  ).action(handleGet);

  withContextOptions(
    vars
      .command('set')
      .description('Set one variable, or every variable in a .env file')
      .argument('[key]', 'variable name')
      .argument('[value]', 'variable value (prefer --stdin for sensitive values)')
      .option('--stdin', 'read the value from stdin, so it is not in argv or shell history')
      .option('--file <path>', 'set each variable in a .env file; variables not in the file are kept')
      .addHelpText(
        'after',
        `
Examples:
  qc env vars set APP_DEBUG false --env staging
  printf '%s' "$TOKEN" | qc env vars set API_TOKEN --stdin --env production
  qc env vars set --file .env.production --env production
${WRITE_HELP}`
      )
  ).action(handleSet);

  withContextOptions(
    vars
      .command('unset')
      .description('Remove a variable')
      .argument('<key>', 'variable name')
      .option('-y, --yes', 'do not ask for confirmation')
      .addHelpText('after', WRITE_HELP)
  ).action(handleUnset);
}
