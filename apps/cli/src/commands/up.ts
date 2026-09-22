import type { Argv } from 'yargs'
import { ServerError } from '#errors'
import { createOutput, type Output } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import {
  boundToSuffix,
  DEFAULT_BIND,
  humanUrlFor,
  remoteTunnelCommand,
  requireLoopbackBind,
  tunnelLine,
  tunnelMember,
} from '#server/address'
import { type LockInfo, readLock } from '#server/lock'
import { DEFAULT_PORT, resolveStage } from '#stage'

const READY_POLL_MS = 20

async function waitForServer(lockFile: string, timeoutMs: number): Promise<LockInfo | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lock = readLock(lockFile)
    if (lock !== undefined) return lock
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
}

/**
 * Prints the forwarding command beside the link, when there is one to print.
 *
 * A note rather than part of the result line, for the reason notes exist: in
 * `--json` the answer carries the `tunnel` field and no prose at all, and a
 * `--quiet` caller asked for nothing extra. Someone working over a secure shell
 * has the command in front of them without having asked a question.
 */
function noteTunnel(output: Output, tunnel: string | undefined, port: number): void {
  const line = tunnelLine(tunnel, port)
  if (line !== undefined) output.note(line)
}

/**
 * `up` — idempotent "make it run", and what humans, hooks and skills actually
 * call (architecture.md §Server lifecycle).
 *
 * Readiness is the **lock file**, not an HTTP probe: `serve` writes the lock after
 * it has the stage and before it serves, and the lock carries the port it actually
 * took. Polling it means `up` reports the port that is real rather than the one it
 * asked for, and it does not depend on what the placeholder handler answers.
 *
 * No OS service yet: this starts a detached `serve`. `service install` is Tier 3.
 *
 * The server listens on **this machine and nowhere else**. `--bind` still names
 * the address for one start and is carried over by no stage, file or lock, but
 * every address that is not loopback is refused before anything happens — there
 * is no flag and no environment variable that opens one. The way in from another
 * computer is a secure-shell tunnel, which the refusal spells out, and which a
 * start inside a remote login prints beside the link without being asked.
 */
export function registerUpCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'up',
    'Ensure the server is running; print the URL',
    (yargs) =>
      yargs
        .option('port', { type: 'number', describe: 'Port to listen on [default: 24100]' })
        .option('bind', {
          type: 'string',
          describe: `Address to bind. The review server only ever listens on this machine, so only 127.0.0.1, ::1 and localhost are accepted; reach it from another computer over an SSH tunnel. [default: ${DEFAULT_BIND}]`,
        }),
    async (args) => {
      // Before the stage, the lock and the output: a refused address must leave
      // the machine exactly as it found it. The port in the message is the one
      // the caller asked for, read off the flag rather than off the stage, so
      // that nothing on disk has to be consulted to write a refusal.
      const bind = args.bind ?? DEFAULT_BIND
      requireLoopbackBind(bind, args.port ?? DEFAULT_PORT)

      const stage = resolveStage({
        home: args.home,
        port: args.port,
        env: runtime.env,
        cwd: runtime.cwd,
      })
      const output = createOutput({
        json: args.json === true,
        quiet: args.quiet === true,
        out: runtime.out,
        err: runtime.err,
      })
      const already = readLock(stage.lockFile)

      if (already !== undefined) {
        // `url` is the link that gets handed over, so it is the address the
        // running server answers on. Reading its bind here describes that server;
        // it is not carried into any start (`bind` above is the flag or loopback).
        const url = humanUrlFor(already.bind, already.port)
        // The address that matters here is the one the running server took, not
        // the one this invocation asked for: `up` started nothing, so `--bind`
        // has not been applied and must not be reported as though it had. That
        // includes reporting a wildcard an older server bound — a fact about
        // what is serving, which is exactly what makes it worth printing.
        const tunnel = remoteTunnelCommand(runtime.env, already.port)
        if (args.bind !== undefined && already.bind !== args.bind) {
          output.note(
            `Note: the running server is bound to ${already.bind}; --bind ${args.bind} needs a restart (retroloop down, then retroloop up --bind ${args.bind}).`,
          )
        }
        output.result(
          {
            url,
            port: already.port,
            pid: already.pid,
            bind: already.bind,
            started: false,
            ...tunnelMember(tunnel),
          },
          () => `Already running — ${url} (pid ${already.pid})${boundToSuffix(already.bind)}`,
        )
        noteTunnel(output, tunnel, already.port)
        return
      }

      await runtime.spawnServe(stage, { port: stage.port, bind })

      const lock = await waitForServer(stage.lockFile, runtime.serverReadyTimeoutMs)
      if (lock === undefined) {
        throw new ServerError(`the server did not come up on ${stage.url}`)
      }

      // The address comes off the lock the server itself wrote, not off the flag:
      // what gets reported is what a listening socket actually took.
      const url = humanUrlFor(lock.bind, lock.port)
      const tunnel = remoteTunnelCommand(runtime.env, lock.port)
      output.result(
        {
          url,
          port: lock.port,
          pid: lock.pid,
          bind: lock.bind,
          started: true,
          ...tunnelMember(tunnel),
        },
        () => `Started — ${url} (pid ${lock.pid})${boundToSuffix(lock.bind)}`,
      )
      noteTunnel(output, tunnel, lock.port)
    },
  )
}
