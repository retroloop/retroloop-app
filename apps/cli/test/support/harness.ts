import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Clock, createMemoryStore, type Store } from '@retro/core'
import { run } from '#main'
import type { CliRuntime } from '#runtime'

export type CliResult = {
  readonly code: number
  readonly stdout: readonly string[]
  readonly stderr: readonly string[]
  /**
   * The single JSON object `--json` promises on stdout, for asserting the whole
   * shape at once.
   *
   * Deliberately not generic: `expect()` takes an optional parameter, so handing
   * it a generic call whose type argument nothing constrains makes TypeScript
   * resolve that argument to `undefined` and reject every `toEqual`. Reading one
   * field is `jsonAs` instead.
   */
  json(): Record<string, unknown>
  /** The same object, typed, for reading a field out of it. */
  jsonAs<T>(): T
  /** The `{"error":{code,message}}` document on stderr. */
  error(): { code: string; message: string }
}

export type Cli = {
  run(argv: readonly string[]): Promise<CliResult>
  readonly store: Store
  readonly clock: Clock
  /** The stage directory every command in this harness points at. */
  readonly dataDir: string
  /** Writes a file into the stage directory and returns its path. */
  file(name: string, contents: string): string
}

const stages: string[] = []

export function removeTempStages(): void {
  for (const dir of stages.splice(0)) rmSync(dir, { recursive: true, force: true })
}

function frozenClock(iso = '2026-08-23T09:00:00.000Z'): Clock {
  const instant = new Date(iso)
  return { now: () => new Date(instant) }
}

/**
 * The CLI, in process, over the memory store (testing.md suite 3).
 *
 * `run` is the same function the binary calls, so what these tests exercise is
 * the real argument parsing, the real exit-code mapping and the real output —
 * only the store, the clock and the two writers are swapped.
 *
 * The store is created once and handed back for every command, because a suite
 * that could not do `session create` then `note add` would be testing commands in
 * isolation from the thing that makes them a CLI. `close()` is a no-op on memory,
 * so the per-command close that production relies on costs nothing here.
 *
 * `RETROLOOP_HOME` points at a throwaway root: `resolveStage` reads the stage's
 * lock file to learn the running port, and a test must never read — or write —
 * the developer's real `~/.retroloop`.
 *
 * The environment is **built here, never inherited**, and an `env` override is
 * merged into it rather than replacing it. A replacement would drop
 * `RETROLOOP_HOME` and point the command at the developer's real root; an
 * inherited `process.env` would let the machine the suite happens to run on
 * decide the answer — a run over a secure shell would carry `SSH_CONNECTION`
 * into every test, and the tunnel line would appear where no test asked for it.
 */
export function createCli(overrides: Partial<CliRuntime> = {}): Cli {
  const home = mkdtempSync(join(tmpdir(), 'retro-cli-'))
  stages.push(home)

  const dataDir = join(home, 'data')
  mkdirSync(dataDir, { recursive: true })

  const store = overrides.openStore === undefined ? createMemoryStore() : undefined
  const clock = overrides.clock ?? frozenClock()

  return {
    store: store as Store,
    clock,
    dataDir,
    file(name, contents) {
      const path = join(dataDir, name)
      writeFileSync(path, contents)
      return path
    },
    async run(argv) {
      const stdout: string[] = []
      const stderr: string[] = []

      const code = await run(argv, {
        cwd: home,
        clock,
        out: (line) => stdout.push(line),
        err: (line) => stderr.push(line),
        pollIntervalMs: 5,
        serverReadyTimeoutMs: 200,
        serverStopTimeoutMs: 200,
        stdin: async () => '',
        openStore: overrides.openStore ?? (() => store as Store),
        spawnServe: overrides.spawnServe ?? (async () => undefined),
        // Never the real one: the default would SIGTERM whatever PID a fixture
        // lock file names, and the fixtures name this test process.
        stopProcess: overrides.stopProcess ?? (() => undefined),
        ...overrides,
        // Last, and merged: an override that named only `SSH_CONNECTION` would
        // otherwise take the whole environment with it, `RETROLOOP_HOME` included.
        env: { RETROLOOP_HOME: home, ...overrides.env },
      })

      const parseStdout = (): Record<string, unknown> => {
        if (stdout.length !== 1) {
          throw new Error(
            `expected exactly one JSON object on stdout, got ${stdout.length} line(s): ${stdout.join(' | ')}`,
          )
        }
        return JSON.parse(stdout[0] as string) as Record<string, unknown>
      }

      return {
        code,
        stdout,
        stderr,
        json: parseStdout,
        jsonAs<T>() {
          return parseStdout() as T
        },
        error() {
          const line = stderr.at(-1)
          if (line === undefined) throw new Error('nothing was written to stderr')
          return (JSON.parse(line) as { error: { code: string; message: string } }).error
        },
      }
    },
  }
}

/** A revision draft that satisfies every mechanical rule of the schema. */
export function aRevisionDraft(
  records: readonly { rid: string; num: number; title?: string; problem?: string }[] = [
    { rid: 'r-stale-lock', num: 1 },
  ],
): string {
  return JSON.stringify({
    records: records.map((record) => ({
      rid: record.rid,
      num: record.num,
      title: record.title ?? 'Deploy blocked on a stale lock file',
      type: 'issue',
      problem: record.problem ?? 'The deploy waited 40 minutes on a lock nothing held.',
      humanWords: [
        {
          verbatim: 'this thing has been sitting there for ages',
          cleaned: 'This has been sitting there for a long time.',
          context: 'while watching the deploy log',
        },
      ],
      rootCause: {
        whatHappened: 'The lock file outlived the process that took it.',
        whys: ['The process was killed', 'The lock had no owner check'],
        root: 'Locks are advisory with no liveness check.',
      },
      // Authored markdown, because that is what the field carries and what the
      // review page renders it as.
      diagnosticData:
        '- **The lock file:** `stage.lock`, 0 bytes, written 40 minutes before the deploy.\n' +
        '- **The holder:** `ps 8123` — no such process.',
      workaround: 'Delete the lock file by hand.',
      solutions: [
        {
          bullets: '- **Document the lock.** Say in the runbook which process owns it.',
          footprint: 'docs/runbook.md',
          level: 1,
          recommended: false,
        },
        {
          bullets: '- **Write the holder PID.** Check liveness before waiting on the lock.',
          footprint: '- scripts/deploy.sh\n- lib/lock.ts',
          level: 2,
          recommended: true,
        },
      ],
      requester: 'human',
      impacts: 'human',
      defaults: { severity: 3, involvement: 'pull-request' },
    })),
  })
}
