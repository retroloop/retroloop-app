import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/**
 * Playwright runs this suite under **Node**, not Bun — so nothing here may use a
 * `Bun.*` global or `import.meta.dir`, however natural they look in this repo.
 * The processes it spawns are Bun; the code that spawns them is not. Anything
 * needing `bun:sqlite` goes through `stage-tool.ts`, which is a Bun script.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../..')
const CLI_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const STAGE_TOOL = join(HERE, 'stage-tool.ts')

/**
 * One frozen instant for every process in a scenario — CLI, server and the page
 * they both feed (testing.md §Determinism). Suite 5 is the only place the clock
 * crosses process boundaries, and pinning it is what makes a timestamp an
 * assertable fact rather than a moving target.
 */
export const TEST_CLOCK = '2026-08-24T09:00:00.000Z'

export type CliResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  json<T>(): T
}

export type BackgroundCli = {
  /** Resolves when the process exits. */
  readonly finished: Promise<CliResult>
}

export type WorldState = {
  sessionId?: number
  retroId?: number
  rids: string[]
  waiting?: BackgroundCli
  exportPath?: string
}

export type RetroWorld = {
  /** The root folder `--home` names; the stage is `<home>/data`. */
  readonly home: string
  readonly dataDir: string
  readonly state: WorldState
  /** Runs the real binary against this stage and waits for it. */
  cli(...args: string[]): Promise<CliResult>
  /** Runs the real binary without waiting — for `review wait`. */
  background(...args: string[]): BackgroundCli
  /** Runs the Bun-side stage tool (anything needing `bun:sqlite`). */
  tool(...args: string[]): Promise<CliResult>
  /** Starts `retro serve` as a real process; idempotent. Returns the base URL. */
  startServer(): Promise<string>
  url(path: string): string
  writeFile(name: string, contents: string): string
  backups(): string[]
  stop(): Promise<void>
}

function collect(child: ChildProcess): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        json<T>() {
          const line = stdout.trim()
          if (line === '') {
            throw new Error(`expected JSON on stdout; got nothing. stderr: ${stderr}`)
          }
          return JSON.parse(line) as T
        },
      })
    })
  })
}

/** Asks the OS for a port nobody is using, then gives it straight back. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export function createWorld(): RetroWorld {
  const home = mkdtempSync(join(tmpdir(), 'retro-e2e-'))
  const dataDir = join(home, 'data')
  mkdirSync(dataDir, { recursive: true })
  const state: WorldState = { rids: [] }
  const environment = { ...process.env, RETRO_TEST_CLOCK: TEST_CLOCK }

  let server: ChildProcess | undefined
  let baseUrl = ''

  const runBun = (script: string, args: readonly string[]): ChildProcess =>
    spawn('bun', ['run', script, ...args], { env: environment, stdio: 'pipe' })

  return {
    home,
    dataDir,
    state,

    async cli(...args) {
      return collect(runBun(CLI_BIN, [...args, '--home', home]))
    },

    background(...args) {
      return { finished: collect(runBun(CLI_BIN, [...args, '--home', home])) }
    },

    async tool(...args) {
      return collect(runBun(STAGE_TOOL, [...args, dataDir]))
    },

    async startServer() {
      if (baseUrl !== '') return baseUrl

      const port = await freePort()
      baseUrl = `http://127.0.0.1:${port}`
      let exited: number | undefined
      let serverStderr = ''

      server = runBun(CLI_BIN, ['serve', '--home', home, '--port', String(port), '--json'])
      server.stderr?.on('data', (chunk: Buffer) => {
        serverStderr += chunk.toString()
      })
      server.on('close', (code) => {
        exited = code ?? -1
      })

      // Ready when it answers, not when the process exists: `serve` takes the
      // stage lock and applies pending migrations before it binds.
      const deadline = Date.now() + 30_000
      for (;;) {
        if (exited !== undefined) {
          throw new Error(`retro serve exited with ${exited}: ${serverStderr}`)
        }
        try {
          const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })
          if (response.ok) return baseUrl
        } catch {
          // not up yet
        }
        if (Date.now() >= deadline) {
          throw new Error(`retro serve never answered on ${baseUrl}: ${serverStderr}`)
        }
        await delay(50)
      }
    },

    url(path) {
      if (baseUrl === '') throw new Error('the server has not been started in this scenario')
      return `${baseUrl}${path}`
    },

    writeFile(name, contents) {
      const path = join(dataDir, name)
      writeFileSync(path, contents)
      return path
    },

    backups() {
      const directory = join(home, 'backups', 'db')
      return existsSync(directory) ? readdirSync(directory) : []
    },

    async stop() {
      if (server !== undefined) {
        // SIGTERM is what the boot service sends and what `serve` shuts down
        // cleanly on, releasing the stage lock on its way out.
        const stopped = new Promise<void>((resolve) => server?.on('close', () => resolve()))
        server.kill('SIGTERM')
        await Promise.race([stopped, delay(5000)])
        server = undefined
      }
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/** A revision draft satisfying every mechanical rule of the schema (D5). */
export function aRevisionDraft(rids: readonly string[]): string {
  return JSON.stringify({
    records: rids.map((rid, index) => ({
      rid,
      num: index + 1,
      title: `Deploy blocked on ${rid}`,
      type: 'issue',
      problem: 'The deploy waited 40 minutes on a lock nothing held.',
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
      // The evidence the AI diagnosed from — required of every record since
      // RL-52, and read back off the page and out of the export file at the end
      // of the loop.
      diagnosticData:
        '- **The lock file:** `deploy.lock`, 0 bytes, mtime 40 minutes before the deploy.\n' +
        '- **The holder:** the file records no pid, and `ps 8123` returns nothing.',
      workaround: 'Delete the lock file by hand.',
      // Two solutions rather than one, at different levels: the loop this drives
      // proves the new shape end to end, and a single-solution record would make
      // "the first" and "the recommended" the same answer everywhere the export
      // and the page are checked.
      solutions: [
        {
          bullets: '- **Document the lock.** Say in the runbook which process owns it.',
          footprint: 'docs/runbook.md',
          level: 1,
          recommended: false,
        },
        {
          bullets: '- **Write the holder PID** into the lock and check liveness. (agreed)',
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
