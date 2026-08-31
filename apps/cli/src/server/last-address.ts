import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * `last-bind.json` — the address the last server on this stage was listening on.
 *
 * The lock cannot carry this. `serve` deletes it on the way out and `readLock`
 * refuses one whose process is gone, both on purpose: a crashed server must not
 * hold a stage forever. So a restart — `retro down && retro up`, which is what
 * the restart rule says — had nothing to read the previous address back from and
 * rebound to loopback, silently, every time (retro-6 `r-restart-drops-bind`).
 *
 * Not a config file, and the difference is the whole point of `resolveStage`'s
 * header ("the URL describes what is running, not what someone once
 * configured"). Nobody writes this by hand and nothing consults it except `up`
 * when no `--bind` was given: it records what happened, and a flag outranks it.
 */
type LastBind = {
  readonly bind: string
}

/**
 * The remembered address, or `undefined` when there is none to be had — no file
 * yet, or a file that says nothing usable. A stage that cannot remember is the
 * first-start case, which is loopback; there is no reading of this file that
 * should stop a server from coming up.
 */
export function readLastBind(lastBindFile: string): string | undefined {
  let text: string
  try {
    text = readFileSync(lastBindFile, 'utf8')
  } catch {
    return undefined
  }

  try {
    const parsed = JSON.parse(text) as Partial<LastBind>
    if (typeof parsed.bind !== 'string' || parsed.bind === '') return undefined
    return parsed.bind
  } catch {
    return undefined
  }
}

/**
 * Records the address a server on this stage actually took.
 *
 * Best effort: this is a convenience for the *next* start, so a stage that will
 * not accept the write still gets the server it was asked for. Failing `up` over
 * it would be the tail wagging the dog.
 */
export function rememberBind(lastBindFile: string, bind: string): void {
  try {
    mkdirSync(dirname(lastBindFile), { recursive: true })
    writeFileSync(lastBindFile, `${JSON.stringify({ bind } satisfies LastBind, null, 2)}\n`)
  } catch {
    // Nothing to say and nothing to do: the server is up either way, and the
    // only cost is that the start after this one asks for the default again.
  }
}
