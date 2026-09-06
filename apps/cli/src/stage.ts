import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { readLock } from '#server/lock'

/** cli.md §Globals: `--data <dir>` [default: ~/.ai-team/retro], env `RETROLOOP_HOME` (alias `RETRO_HOME`). */
export const DEFAULT_DATA_DIR = join('.ai-team', 'retro')
/** architecture.md §Network — never 5000/7000, which macOS AirPlay takes. */
export const DEFAULT_PORT = 24100
export const LOCK_FILENAME = 'server.lock'

export type Environment = Readonly<Record<string, string | undefined>>

export type Stage = {
  /** The data directory that *is* the stage (KC-0013). */
  readonly dataDir: string
  readonly lockFile: string
  readonly port: number
  /** Base URL of this stage's server. */
  readonly url: string
  urlForSession(sessionId: number): string
  urlForRetro(retroId: number, revision?: number): string
}

export type StageOptions = {
  readonly data?: string
  readonly port?: number
  readonly env?: Environment
  /** Where a relative `--data` is resolved from. */
  readonly cwd?: string
}

export function resolveDataDir(options: StageOptions = {}): string {
  const env = options.env ?? {}
  const chosen = options.data ?? env.RETROLOOP_HOME ?? env.RETRO_HOME
  if (chosen === undefined) return join(homedir(), DEFAULT_DATA_DIR)
  return isAbsolute(chosen) ? chosen : resolve(options.cwd ?? process.cwd(), chosen)
}

/**
 * Resolves the stage a command acts on.
 *
 * The port matters because several commands print a URL, and a URL with the
 * wrong port is worse than none. Precedence: an explicit `--port`, then
 * `RETRO_PORT`, then **the port the running server actually holds** — read from
 * its lock file — then the default. Asking the lock rather than a config file
 * means the URL describes what is running, not what someone once configured.
 *
 * The host is always `localhost`: it is correct for whoever is running the CLI.
 * The LAN address an iPad needs is `setup`'s business (Tier 3), not a link
 * printed by `session create`.
 */
export function resolveStage(options: StageOptions = {}): Stage {
  const env = options.env ?? {}
  const dataDir = resolveDataDir(options)
  const lockFile = join(dataDir, LOCK_FILENAME)

  const fromEnv = Number.parseInt(env.RETRO_PORT ?? '', 10)
  const running = readLock(lockFile)
  const port =
    options.port ??
    (Number.isInteger(fromEnv) ? fromEnv : undefined) ??
    running?.port ??
    DEFAULT_PORT

  const url = `http://localhost:${port}`
  return {
    dataDir,
    lockFile,
    port,
    url,
    urlForSession: (sessionId) => `${url}/sessions/${sessionId}`,
    // Route contract per KC-0011: /retros/:retroId?rev=k
    urlForRetro: (retroId, revision) =>
      revision === undefined
        ? `${url}/retros/${retroId}`
        : `${url}/retros/${retroId}?rev=${revision}`,
  }
}
