import { writeSync } from 'node:fs'
import { join } from 'node:path'
import {
  type App,
  type Clock,
  createApp,
  openSqliteStore,
  type Store,
  systemClock,
} from '@retro/core'
import { createOutput, type Output, type Writer } from '#output'
import { type HostAddress, type ServeAddress, systemHostAddresses } from '#server/address'
import type { Environment, Stage } from '#stage'
import { resolveStage } from '#stage'

/** Everything a command needs, already resolved for the stage it was pointed at. */
export type CliContext = {
  readonly app: App
  readonly stage: Stage
  readonly output: Output
  readonly clock: Clock
}

/**
 * cli.md §Globals. Declared as a type so every command's `args` carries them:
 * yargs infers a command's arguments from its own builder, so without this the
 * global options would be invisible inside a handler.
 */
export type GlobalOptions = {
  json: boolean
  home: string | undefined
  quiet: boolean
}

export type GlobalArgs = {
  readonly json?: boolean
  readonly home?: string
  readonly quiet?: boolean
}

/**
 * The seams. Production wires the real ones; the suite injects a memory store, a
 * frozen clock and capturing writers, which is what lets testing.md's suite 3 run
 * the whole CLI in-process without a file on disk.
 */
export type CliRuntime = {
  readonly env: Environment
  readonly cwd: string
  readonly out: Writer
  readonly err: Writer
  readonly clock: Clock
  /** `review wait`'s poll interval — 500 ms in production (realtime.md §CLI waiting). */
  readonly pollIntervalMs: number
  /** How long `up` waits for a spawned `serve` to take the stage lock. */
  readonly serverReadyTimeoutMs: number
  /** How long `down` waits for a signalled server to let go of the stage. */
  readonly serverStopTimeoutMs: number
  readonly stdin: () => Promise<string>
  readonly openStore: (stage: Stage) => Store
  /** Starts a detached `serve` for `up`, at the address it was told to take. */
  readonly spawnServe: (stage: Stage, address: ServeAddress) => Promise<void>
  /** Asks a running server to stop — SIGTERM, which `serve` handles. */
  readonly stopProcess: (pid: number) => void
  /** This machine's addresses, for the LAN URL a non-loopback bind earns. */
  readonly hostAddresses: () => readonly HostAddress[]
}

/**
 * `RETRO_TEST_CLOCK` freezes time for a spawned process (testing.md §Determinism).
 * It is the only way a test that shells out can assert on a timestamp, and it is
 * ignored unless it parses — a typo must not silently move the ledger to 1970.
 */
export function resolveClock(env: Environment, injected?: Clock): Clock {
  if (injected !== undefined) return injected

  const fixed = env.RETRO_TEST_CLOCK
  if (fixed !== undefined && !Number.isNaN(Date.parse(fixed))) {
    const instant = new Date(fixed)
    return { now: () => new Date(instant) }
  }
  return systemClock
}

/**
 * Opens the stage, runs the command, and closes the store — even when the command
 * throws, because a CLI that leaves a SQLite handle open holds the write lock a
 * moment longer than it earned.
 */
export async function withContext<T>(
  runtime: CliRuntime,
  args: GlobalArgs,
  work: (context: CliContext) => Promise<T>,
): Promise<T> {
  const stage = resolveStage({ home: args.home, env: runtime.env, cwd: runtime.cwd })
  const store = runtime.openStore(stage)
  const output = createOutput({
    json: args.json === true,
    quiet: args.quiet === true,
    out: runtime.out,
    err: runtime.err,
  })

  try {
    return await work({
      app: createApp(store, { clock: runtime.clock }),
      stage,
      output,
      clock: runtime.clock,
    })
  } finally {
    await store.close()
  }
}

/** Something to sleep on: `Atomics.wait` is the one synchronous sleep there is. */
const pipeFullSleep = new Int32Array(new SharedArrayBuffer(4))

/**
 * Writes all of `text` to `fd` before returning, waiting for the reader when it
 * has to. One `writeSync` is not enough, and neither is a loop that trusts it:
 *
 * - fd 1 is blocking when the process starts and **non-blocking as soon as
 *   anything touches `process.stdout`** — importing the CLI is enough (measured
 *   with `fcntl(1, F_GETFL)`, Bun 1.4.0). A three-line script that never touches
 *   it keeps a blocking fd, which is why `writeSync` looked sufficient in a probe.
 * - On that fd a `writeSync` to a pipe is a **short write**: it hands over what
 *   fits — 65,536 bytes, one pipe buffer — and returns that count, so a single
 *   call cuts a large answer just as the asynchronous writer did, only earlier.
 * - Called again before the reader has drained, it throws **`EAGAIN`**. That is
 *   not a failure, it is "the pipe is full": sleep a millisecond and try again.
 *   A reader that stalls two seconds costs about 1,500 of these; a file, none.
 *
 * - **`EPIPE`** is the reader having left — `… --json | head -c 10`, how an agent
 *   peeks at an answer. It got what it asked for, so the rest is dropped and the
 *   command ends as it would have: the asynchronous writer never heard a reader
 *   leave, and a writer that waits must not turn that into an `UNKNOWN` error.
 *
 * The count is in bytes, not characters, so the text is encoded once and the
 * loop resumes at a byte offset. Any other error is the caller's to hear about.
 */
function writeAllSync(fd: 1 | 2, text: string): void {
  const bytes = Buffer.from(text, 'utf8')
  let offset = 0
  while (offset < bytes.length) {
    try {
      offset += writeSync(fd, bytes, offset)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPIPE') return
      if (code !== 'EAGAIN') throw error
      Atomics.wait(pipeFullSleep, 0, 0, 1)
    }
  }
}

export function createDefaultRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  const env = overrides.env ?? process.env
  return {
    env,
    cwd: overrides.cwd ?? process.cwd(),
    // Synchronous on purpose, straight to fds 1 and 2. `bin.ts` ends the process
    // with `process.exit` the moment `run` returns, and while these wrote with
    // `process.stdout.write`, every `--json` answer over 128 KiB reached a reader
    // on a pipe cut at exactly 131,072 bytes — exit 0, nothing on stderr
    // (`r-cli-json-cut-at-128k-on-pipe`; measured under Bun 1.4.0). A writer added
    // beside these two has to keep the property; `test/bin-stdout-pipe.test.ts`
    // reads the real binary through a real pipe.
    out: overrides.out ?? ((line) => writeAllSync(1, `${line}\n`)),
    err: overrides.err ?? ((line) => writeAllSync(2, `${line}\n`)),
    clock: resolveClock(env, overrides.clock),
    pollIntervalMs: overrides.pollIntervalMs ?? 500,
    serverReadyTimeoutMs: overrides.serverReadyTimeoutMs ?? 10_000,
    serverStopTimeoutMs: overrides.serverStopTimeoutMs ?? 5_000,
    stdin: overrides.stdin ?? (() => Bun.stdin.text()),
    openStore:
      overrides.openStore ??
      ((stage) =>
        openSqliteStore({
          dataDir: stage.dataDir,
          // The snapshots belong to the root, not to the stage: `backups/db/` is
          // a sibling of `data/`, so a stage directory holds only live state.
          backupsDir: join(stage.home, 'backups', 'db'),
        })),
    spawnServe:
      overrides.spawnServe ??
      (async (stage, address) => {
        // Detached so the server outlives this short-lived CLI process. The boot
        // service that replaces this is Tier 3 (architecture.md §Server lifecycle).
        Bun.spawn(
          [
            'bun',
            'run',
            `${import.meta.dir}/bin.ts`,
            'serve',
            '--home',
            stage.home,
            '--port',
            String(address.port),
            '--bind',
            address.bind,
          ],
          {
            stdio: ['ignore', 'ignore', 'ignore'],
          },
        ).unref()
      }),
    stopProcess:
      overrides.stopProcess ??
      ((pid) => {
        process.kill(pid, 'SIGTERM')
      }),
    hostAddresses: overrides.hostAddresses ?? systemHostAddresses,
  }
}
