import type { Argv } from 'yargs'
import { ServerError } from '#errors'
import { createOutput } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import { DEFAULT_BIND, lanUrlFor, lanUrlMember, lanUrlSuffix } from '#server/address'
import { readLastBind, rememberBind } from '#server/last-address'
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
 * `--bind` reaches the spawned `serve` (F1). It used to be declared, accepted and
 * dropped, so `up --bind 0.0.0.0` exited 0 having bound loopback — the worst of
 * the three possible outcomes, because it looked like it worked.
 *
 * And a bare `up` re-uses the address this stage last ran on, because a restart
 * is `retro down && retro up` and the bind used to live only in a flag and in a
 * lock the `down` deletes. The stage remembers so that nobody has to remember
 * for it (retro-6 `r-restart-drops-bind`).
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
          describe: `Address to bind — 0.0.0.0 for the LAN [default: the address this stage last ran on, else ${DEFAULT_BIND}]`,
        }),
    async (args) => {
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
      // Precedence: the flag always wins; then the server that is already
      // running, whose address is a fact rather than a request; then the address
      // the last server on this stage took; then loopback. Nothing here ever
      // widens a stage on its own — only a `--bind` you once typed can, and this
      // is the stage remembering that you typed it (`DEFAULT_BIND`'s header).
      const bind = args.bind ?? already?.bind ?? readLastBind(stage.lastBindFile) ?? DEFAULT_BIND

      if (already !== undefined) {
        const url = `http://localhost:${already.port}`
        // The address that matters here is the one the running server took, not
        // the one this invocation asked for: `up` started nothing, so `--bind`
        // has not been applied and must not be reported as though it had.
        const lanUrl = lanUrlFor(already.bind, already.port, runtime.hostAddresses)
        if (already.bind !== bind) {
          output.note(
            `Note: the running server is bound to ${already.bind}; --bind ${bind} needs a restart (retroloop down, then retroloop up --bind ${bind}).`,
          )
        }
        output.result(
          { url, port: already.port, pid: already.pid, started: false, ...lanUrlMember(lanUrl) },
          () => `Already running — ${url} (pid ${already.pid})${lanUrlSuffix(lanUrl)}`,
        )
        return
      }

      await runtime.spawnServe(stage, { port: stage.port, bind })

      const lock = await waitForServer(stage.lockFile, runtime.serverReadyTimeoutMs)
      if (lock === undefined) {
        throw new ServerError(`the server did not come up on ${stage.url}`)
      }

      // Read back off the lock the server itself wrote, and only now that there
      // is a server to write it: an address that failed to bind must not become
      // the one every later `retro up` inherits.
      rememberBind(stage.lastBindFile, lock.bind)

      const url = `http://localhost:${lock.port}`
      const lanUrl = lanUrlFor(lock.bind, lock.port, runtime.hostAddresses)
      output.result(
        { url, port: lock.port, pid: lock.pid, started: true, ...lanUrlMember(lanUrl) },
        () => `Started — ${url} (pid ${lock.pid})${lanUrlSuffix(lanUrl)}`,
      )
    },
  )
}
