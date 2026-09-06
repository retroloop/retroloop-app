import type { Argv } from 'yargs'
import { ServerError } from '#errors'
import { createOutput } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import {
  boundToSuffix,
  DEFAULT_BIND,
  lanUrlFor,
  lanUrlMember,
  lanUrlSuffix,
  refuseWildcardBind,
} from '#server/address'
import { type LockInfo, readLock } from '#server/lock'
import { resolveStage } from '#stage'

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
 * `up` — idempotent "make it run", and what humans, hooks and skills actually
 * call (architecture.md §Server lifecycle).
 *
 * Readiness is the **lock file**, not an HTTP probe: `serve` writes the lock after
 * it has the stage and before it serves, and the lock carries the port it actually
 * took. Polling it means `up` reports the port that is real rather than the one it
 * asked for, and it does not depend on what the placeholder handler answers —
 * which item 5 is going to replace.
 *
 * No OS service yet: this starts a detached `serve`. `service install` is Tier 3.
 *
 * The address is a per-start choice and nothing else: a bare `up` binds loopback,
 * `--bind <ip>` binds that one interface for that one start, and no stage, file
 * or lock carries an address into the next start. A wildcard (`0.0.0.0`, `::`) is
 * refused outright — the reach it grants is a decision to be typed each time it
 * is wanted, not one to be inherited. The address that was bound is printed on
 * every start, so the terminal always says where the server can be reached from.
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
          describe: `Address to bind. A specific interface IP (e.g. 192.168.1.9) exposes the server on that network; 0.0.0.0 and :: are refused. [default: ${DEFAULT_BIND}]`,
        }),
    async (args) => {
      // Before the stage, the lock and the output: a refused address must leave
      // the machine exactly as it found it.
      const bind = args.bind ?? DEFAULT_BIND
      refuseWildcardBind(bind)

      const stage = resolveStage({
        data: args.data,
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
        const url = `http://localhost:${already.port}`
        // The address that matters here is the one the running server took, not
        // the one this invocation asked for: `up` started nothing, so `--bind`
        // has not been applied and must not be reported as though it had. That
        // includes reporting a wildcard an older server bound — a fact about
        // what is serving, which is exactly what makes it worth printing.
        const lanUrl = lanUrlFor(already.bind, already.port, runtime.hostAddresses)
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
            ...lanUrlMember(lanUrl),
          },
          () =>
            `Already running — ${url} (pid ${already.pid})${boundToSuffix(already.bind)}${lanUrlSuffix(lanUrl)}`,
        )
        return
      }

      await runtime.spawnServe(stage, { port: stage.port, bind })

      const lock = await waitForServer(stage.lockFile, runtime.serverReadyTimeoutMs)
      if (lock === undefined) {
        throw new ServerError(`the server did not come up on ${stage.url}`)
      }

      // The address comes off the lock the server itself wrote, not off the flag:
      // what gets reported is what a listening socket actually took.
      const url = `http://localhost:${lock.port}`
      const lanUrl = lanUrlFor(lock.bind, lock.port, runtime.hostAddresses)
      output.result(
        {
          url,
          port: lock.port,
          pid: lock.pid,
          bind: lock.bind,
          started: true,
          ...lanUrlMember(lanUrl),
        },
        () =>
          `Started — ${url} (pid ${lock.pid})${boundToSuffix(lock.bind)}${lanUrlSuffix(lanUrl)}`,
      )
    },
  )
}
