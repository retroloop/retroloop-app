import type { Argv } from 'yargs'
import { ServerError } from '#errors'
import { createOutput } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import { readLock } from '#server/lock'
import { resolveStage } from '#stage'

const STOP_POLL_MS = 20

/**
 * The stage is free once the lock is gone, the process that held it is gone, or
 * someone else has taken it. Anything else means the signal has not landed yet.
 *
 * Asking the lock rather than the PID alone covers the ordinary case exactly:
 * `serve` releases the lock in its shutdown path, so the file disappearing *is*
 * the server confirming it stopped.
 */
async function waitForStop(lockFile: string, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (readLock(lockFile)?.pid !== pid) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS))
  }
}

/**
 * `down` — stop this stage's server (cli.md §down), the other half of `up`.
 *
 * Until now stopping meant reading `server.lock` by hand and killing the PID,
 * which is a thing you can only do if you already know the lock file exists.
 *
 * Idempotent, in the same sense `up` is: nothing running is success, not an
 * error. It is SIGTERM, never SIGKILL — `serve` handles SIGTERM by closing the
 * listener, stopping the tailer and closing its SQLite handles, and a server
 * killed outright would leave the write lock to be cleaned up by the next
 * process to want it. Refusing to stop within the timeout is exit 7, and the
 * lock is left exactly where it is: it belongs to a process that is still alive.
 */
export function registerDownCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'down',
    'Stop the server for this stage',
    (yargs) => yargs,
    async (args) => {
      const stage = resolveStage({ data: args.data, env: runtime.env, cwd: runtime.cwd })
      const output = createOutput({
        json: args.json === true,
        quiet: args.quiet === true,
        out: runtime.out,
        err: runtime.err,
      })

      const lock = readLock(stage.lockFile)
      if (lock === undefined) {
        output.result({ stopped: false, pid: null }, () => 'Not running')
        return
      }

      try {
        runtime.stopProcess(lock.pid)
      } catch {
        // It exited between reading the lock and being signalled, or it is not
        // ours to signal. Either way the wait below is what decides the outcome,
        // so there is nothing to say here that it will not say more accurately.
      }

      if (!(await waitForStop(stage.lockFile, lock.pid, runtime.serverStopTimeoutMs))) {
        throw new ServerError(
          `the server (pid ${lock.pid}) did not stop within ${runtime.serverStopTimeoutMs}ms`,
        )
      }

      output.result({ stopped: true, pid: lock.pid }, () => `Stopped — pid ${lock.pid}`)
    },
  )
}
