import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSpinner } from '../utils/spinner.js';
import {
  SetResult,
  VariablesTarget,
  describeApiError,
  resolveSetInput,
  sanitizeForTerminal,
  validateVariableName,
} from '../utils/env-vars.js';
import {
  SECRETS_REDEPLOY_NOTE,
  SECRET_LABELS,
  listSecretNames,
  setSecrets,
  unsetSecret,
} from '../utils/env-secrets.js';
import { VarsContextOptions, fail, resolveVarsContext, targetLabel, withContextOptions } from './env-vars.js';

interface SecretsListOptions extends VarsContextOptions {
  json?: boolean;
}

interface SecretsSetOptions extends VarsContextOptions {
  stdin?: boolean;
  file?: string;
}

interface SecretsUnsetOptions extends VarsContextOptions {
  yes?: boolean;
}

function printRedeployHint(target: VariablesTarget): void {
  console.log(chalk.yellow(SECRETS_REDEPLOY_NOTE));
  console.log(
    chalk.gray('To apply now: ') +
      chalk.cyan(`qc env state redeploy --org ${target.orgId} --app ${target.appId} --env ${target.envId}`)
  );
}

async function handleList(options: SecretsListOptions): Promise<void> {
  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  // No spinner with --json: the spinner writes to stdout and would corrupt the JSON.
  const spinner = options.json ? null : createSpinner('Fetching secrets...');
  try {
    const names = await listSecretNames(client.secretsApi, target);
    spinner?.stop();
    if (options.json) {
      console.log(JSON.stringify(names.map((name) => ({ name })), null, 2));
      return;
    }
    if (names.length === 0) {
      console.log(chalk.gray(`No secrets set on ${targetLabel(target)}.`));
      return;
    }
    console.log(chalk.bold('NAME'));
    for (const name of names) console.log(chalk.cyan(sanitizeForTerminal(name)));
    console.log(chalk.gray(`\n${names.length} secret(s) on ${targetLabel(target)}. Secret values cannot be read back.`));
  } catch (error) {
    spinner?.stop();
    fail(`Failed to list secrets: ${describeApiError(error)}`);
  }
}

function reportSetResults(results: SetResult[], target: VariablesTarget): void {
  for (const result of results) {
    if (result.ok) console.log(`${chalk.green('✔')} Set secret ${chalk.cyan(result.name)} on ${targetLabel(target)}`);
    else console.error(`${chalk.red('✖')} ${chalk.cyan(result.name)}: ${result.error}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) fail(`${failed} of ${results.length} secret(s) failed. The others were saved.`);
  if (failed < results.length) printRedeployHint(target);
}

async function handleSet(key: string | undefined, value: string | undefined, options: SecretsSetOptions): Promise<void> {
  // Read and validate the input before any API call, so a bad file or a
  // missing value never reaches the environment.
  const input = await resolveSetInput({ key, value, stdin: options.stdin, file: options.file, labels: SECRET_LABELS });
  if (input.errors) {
    for (const error of input.errors) console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  if (value !== undefined) {
    console.error(chalk.yellow('The value is on the command line, so it can be in your shell history. Prefer --stdin.'));
  }

  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  const spinner = createSpinner(`Setting ${input.variables.length} secret(s) on ${targetLabel(target)}...`);
  const results = await setSecrets(client.secretsApi, target, input.variables);
  spinner.stop();
  reportSetResults(results, target);
}

// Asks only on a terminal. Scripts and CI (no TTY) and --yes go ahead.
async function confirmUnset(key: string, target: VariablesTarget, options: SecretsUnsetOptions): Promise<boolean> {
  if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) return true;
  const { confirmUnset: ok } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUnset',
      message: `Remove secret ${key} from ${targetLabel(target)}? Its value cannot be recovered.`,
      default: false,
    },
  ]);
  return ok;
}

async function handleUnset(key: string, options: SecretsUnsetOptions): Promise<void> {
  const nameError = validateVariableName(key);
  if (nameError) return fail(nameError);

  const context = await resolveVarsContext(options);
  if (!context) return;
  const { client, target } = context;

  const spinner = createSpinner(`Checking ${key} on ${targetLabel(target)}...`);
  try {
    // DELETE succeeds for a missing key too, so check first to tell the user when nothing changed.
    const names = await listSecretNames(client.secretsApi, target);
    spinner.stop();
    if (!names.includes(key)) {
      console.log(chalk.yellow(`Secret '${key}' is not set on ${targetLabel(target)}. Nothing changed.`));
      return;
    }
    if (!(await confirmUnset(key, target, options))) {
      console.log(chalk.gray('Cancelled. Nothing changed.'));
      return;
    }
    spinner.start(`Removing ${key} from ${targetLabel(target)}...`);
    await unsetSecret(client.secretsApi, target, key);
    spinner.succeed(`Removed secret ${chalk.cyan(key)} from ${targetLabel(target)}`);
    printRedeployHint(target);
  } catch (error) {
    spinner.stop();
    fail(`Failed to remove secret: ${describeApiError(error)}`);
  }
}

const WRITE_HELP = `
${SECRETS_REDEPLOY_NOTE}
Apply them with: qc env state redeploy --env <env>
A name is either a variable or a secret, never both. To move a variable to a
secret, unset the variable first, then set the secret, then redeploy.`;

export function envSecretsCommand(env: Command): void {
  const secrets = env.command('secrets').description('Manage environment secrets (values are write-only)');

  withContextOptions(
    secrets.command('list').description('List secret names of an environment').option('--json', 'Output as JSON')
  ).action(handleList);

  withContextOptions(
    secrets
      .command('set')
      .description('Set one secret, or every entry in a .env file')
      .argument('[key]', 'secret name')
      .argument('[value]', 'secret value (prefer --stdin)')
      .option('--stdin', 'read the value from stdin, so it is not in argv or shell history')
      .option('--file <path>', 'set each entry in a .env file as a secret; secrets not in the file are kept')
      .addHelpText(
        'after',
        `
Examples:
  printf '%s' "$TOKEN" | qc env secrets set API_TOKEN --stdin --env production
  qc env secrets set GITHUB_APP_PRIVATE_KEY --stdin --env production < key.pem
  qc env secrets set --file .env.secrets --env production
${WRITE_HELP}`
      )
  ).action(handleSet);

  withContextOptions(
    secrets
      .command('unset')
      .description('Remove a secret')
      .argument('<key>', 'secret name')
      .option('-y, --yes', 'do not ask for confirmation')
      .addHelpText('after', WRITE_HELP)
  ).action(handleUnset);
}
