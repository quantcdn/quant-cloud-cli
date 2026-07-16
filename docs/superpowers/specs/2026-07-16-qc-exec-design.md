# `qc exec` — server-side command execution

**Date:** 2026-07-16
**Status:** Approved

## Problem

`qc ssh --command` runs commands through an interactive `aws ecs execute-command`
(SSM) session pinned to the user's machine. When the laptop sleeps or the network
drops, the session dies and the remote command is killed with it. Users need a way
to run long-running commands that does not depend on the host staying awake.

## Solution

Expose the platform's existing Commands API (`CommandsApi` in
`@quantcdn/quant-client`: `createCommand` / `getCommand` / `listCommands`) as a new
`qc exec` command. Execution happens server-side; the CLI only *observes* the run
by polling, so a sleeping laptop pauses the watching, not the work. On wake (or in
a fresh terminal) the user reattaches by run ID.

## Command surface

New file `src/commands/exec.ts`, registered in `src/index.ts`, using the
subcommand pattern established by `backup`/`env`:

```
qc exec run "<command>" [--detach] [--interval <sec>]
                        [--org <org>] [--app <app>] [--env <env>] [--platform <p>]
qc exec status <runId> [--watch] [context flags as above]
qc exec list            [context flags as above]
```

- `run` — create the command server-side, print the `runId` immediately, then poll
  until the run reaches a terminal state. `--detach` skips polling and returns
  right after printing the `runId`.
- `status <runId>` — print current state and output once; `--watch` enters the
  same polling loop as `run` (this is the reattach path).
- `list` — table of runs: `runId`, command (truncated), `status`, `runType`,
  start/end times.

## Data flow

1. Resolve auth + org/app/env context exactly as `src/commands/ssh.ts` does
   (explicit flags override the active config; fail with the same messages when
   unauthenticated or context is missing).
2. `run`: `commandsApi.createCommand(org, env, { command })` → print `runId`.
3. Poll `commandsApi.getCommand(org, env, runId)` every 15 s by default
   (`--interval <sec>` overrides; minimum 5 s).
4. Each poll prints only output lines not yet shown — `Command.output` is a
   `string[]`, so the loop tracks a printed-line count and prints the tail.
5. Terminal state = `endTime` or `exitCode` present, or `status` matching a
   terminal set (e.g. `COMPLETED`, `FAILED`, `STOPPED`, case-insensitive). On
   completion print a summary line (status, exit code, duration) and set
   `process.exitCode` to the remote `exitCode` so the command is scriptable.

### Integration

Add `commandsApi: CommandsApi` to the existing `ApiClient` wrapper
(`src/utils/api.ts`), following the pattern used for `sshAccessApi`,
`crawlersApi`, etc. Do not instantiate API classes inside the command file.

## Interrupt and error handling

- **Ctrl+C while polling**: nothing is killed server-side (the API has no cancel
  endpoint). Exit cleanly and print:
  `Run continues on the server. Reattach with: qc exec status <runId> --watch`
- **Transient poll failures** (network blip, machine just woke from sleep): retry
  on the next interval rather than aborting. Only after 5 *consecutive* failures
  abort, printing the reattach hint. A successful poll resets the counter. This is
  what makes the sleep/wake story robust.
- **API errors** (403/404 on create or get): fail the spinner with a friendly
  message, mirroring `ssh.ts` conventions.

## Out of scope

- `--container` targeting: `CreateCommandRequest` only accepts a `command` string.
  Display `targetContainerName` from responses when present, but don't accept it
  as input until the API does.
- Cancelling/killing a run (no API endpoint).
- Log streaming beyond what `getCommand().output` returns.

## Risks / to verify during implementation

- Whether `getCommand` returns partial `output` while a run is in progress. If it
  only returns output on completion, streaming naturally degrades to
  final-output-only with no code change.
- Whether the backend command runner has an execution time limit; document it in
  the command help if so.
- Actual `status` string values returned by the API (terminal-state set may need
  adjusting once observed).

## Testing

- Unit tests with a mocked `commandsApi`: new-line diffing across polls,
  terminal-state detection (via `exitCode`, `endTime`, and status strings),
  consecutive-failure abort + reset, exit-code propagation, `--detach` short-circuit.
- Manual end-to-end against a real environment: a `sleep 60 && echo done` style
  command, including a mid-run Ctrl+C followed by `qc exec status <runId> --watch`
  reattach.
