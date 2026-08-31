import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ServerError } from '#errors'
import { DEFAULT_BIND } from '#server/address'

/**
 * `server.lock` — one server per stage (architecture.md §Stages).
 *
 * It holds the PID and the address, which makes it two things at once: the
 * mutual exclusion that stops a second `serve`, and the only record of where the
 * running server actually listens. `resolveStage` reads it for exactly that
 * reason, and `up` reads the bind for the same one: reporting the address this
 * invocation *asked* for rather than the one the running server took is the lie
 * the silently-ignored `--bind` flag used to tell.
 */
export type LockInfo = {
  readonly pid: number
  readonly port: number
  readonly bind: string
  readonly startedAt: string
}

function parseLock(text: string): LockInfo | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<LockInfo>
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return undefined
    return {
      pid: parsed.pid,
      port: parsed.port,
      // A lock written before the bind was recorded reads as loopback, which is
      // the reading that cannot invent a LAN URL for a server that has none.
      bind: typeof parsed.bind === 'string' ? parsed.bind : DEFAULT_BIND,
      startedAt: String(parsed.startedAt ?? ''),
    }
  } catch {
    return undefined
  }
}

/** Signal 0 asks "may I signal this process?" without sending anything. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists but belongs to someone else — alive for our purposes.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The lock as it stands, or `undefined` when there is none — including when the
 * file is left over from a process that died. A crashed server must not lock a
 * stage forever, so a lock whose PID is gone is no lock at all.
 */
export function readLock(lockFile: string): LockInfo | undefined {
  let text: string
  try {
    text = readFileSync(lockFile, 'utf8')
  } catch {
    return undefined
  }

  const lock = parseLock(text)
  if (lock === undefined) return undefined
  return isProcessAlive(lock.pid) ? lock : undefined
}

/**
 * Takes the stage lock, or refuses (exit 7).
 *
 * `wx` makes the create-or-fail atomic, so two servers racing to start cannot
 * both believe they won. A stale file is cleared and the attempt retried once —
 * once, not in a loop, because a second failure means someone genuinely got there
 * between our two calls and they are entitled to the stage.
 */
export function acquireLock(lockFile: string, info: LockInfo): void {
  mkdirSync(dirname(lockFile), { recursive: true })
  const contents = `${JSON.stringify(info, null, 2)}\n`

  try {
    writeFileSync(lockFile, contents, { flag: 'wx' })
    return
  } catch {
    const held = readLock(lockFile)
    if (held !== undefined) {
      throw new ServerError(
        `another server already holds this stage (pid ${held.pid}, port ${held.port}); stop it first`,
      )
    }
    rmSync(lockFile, { force: true })
  }

  try {
    writeFileSync(lockFile, contents, { flag: 'wx' })
  } catch {
    const held = readLock(lockFile)
    throw new ServerError(
      held === undefined
        ? `could not take the stage lock at ${lockFile}`
        : `another server already holds this stage (pid ${held.pid}, port ${held.port}); stop it first`,
    )
  }
}

export function releaseLock(lockFile: string): void {
  rmSync(lockFile, { force: true })
}
