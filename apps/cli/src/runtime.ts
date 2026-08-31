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
  data: string | undefined
  quiet: boolean
}

export type GlobalArgs = {
  readonly json?: boolean
  readonly data?: string
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
  const stage = resolveStage({ data: args.data, env: runtime.env, cwd: runtime.cwd })
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

export function createDefaultRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  const env = overrides.env ?? process.env
  return {
    env,
    cwd: overrides.cwd ?? process.cwd(),
    out: overrides.out ?? ((line) => process.stdout.write(`${line}\n`)),
    err: overrides.err ?? ((line) => process.stderr.write(`${line}\n`)),
    clock: resolveClock(env, overrides.clock),
    pollIntervalMs: overrides.pollIntervalMs ?? 500,
    serverReadyTimeoutMs: overrides.serverReadyTimeoutMs ?? 10_000,
    serverStopTimeoutMs: overrides.serverStopTimeoutMs ?? 5_000,
    stdin: overrides.stdin ?? (() => Bun.stdin.text()),
    openStore: overrides.openStore ?? ((stage) => openSqliteStore({ dataDir: stage.dataDir })),
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
            '--data',
            stage.dataDir,
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
