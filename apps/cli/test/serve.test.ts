import { afterAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WEB_BUILD_COMMAND, WEB_BUILD_INDEX } from '@retro/api'
import { EXIT, ServerError } from '#errors'
import { createDefaultRuntime } from '#runtime'
import {
  DEFAULT_BIND,
  humanUrlFor,
  isLoopbackBind,
  isWildcardBind,
  remoteTunnelCommand,
  type ServeAddress,
  tunnelCommandFor,
} from '#server/address'
import { acquireLock, type LockInfo, readLock, releaseLock } from '#server/lock'
import { startServer } from '#server/serve'
import { resolveStage } from '#stage'
import { APP_ROOT, buildReviewPage } from '#web-build'
import { type Cli, createCli, removeTempStages } from './support/harness'

/**
 * The one refusal, spelled out where a test can read it as a person would.
 *
 * The command sits on a line of its own because the terminal has no way to show
 * where it ends: a sentence that runs a comma straight into `you@your-server`
 * puts that comma inside the double-click a reader uses to copy the command.
 */
function refusalFor(bind: string, port = 24100): string {
  return (
    `--bind ${bind} is refused: the review server only ever listens on this machine.\n` +
    `To open it from another computer, forward the port over your SSH connection:\n` +
    `  ssh -N -L ${port}:127.0.0.1:${port} you@your-server\n` +
    `then open http://localhost:${port}`
  )
}

/** What `SSH_CONNECTION` carries: client address, client port, server address, server port. */
const SSH_CONNECTION = '198.51.100.4 54321 203.0.113.7 22'

afterAll(removeTempStages)

function writeLock(cli: Cli, info: Partial<LockInfo> = {}): string {
  const lockFile = join(cli.dataDir, 'server.lock')
  writeFileSync(
    lockFile,
    JSON.stringify({
      pid: info.pid ?? process.pid,
      port: info.port ?? 24242,
      bind: info.bind ?? DEFAULT_BIND,
      startedAt: info.startedAt ?? '2026-08-23T09:00:00.000Z',
    }),
  )
  return lockFile
}

/** `startServer` is the listener; what it serves is the API's business. */
const echo = () => new Response('served by the retro CLI', { status: 200 })

describe('startServer', () => {
  test('serves what the handler returns', async () => {
    const server = startServer({ port: 0, handler: echo })

    const response = await fetch(server.url)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toBe('served by the retro CLI')
    await server.stop()
  })

  test('binds a real port when asked for any port', () => {
    const server = startServer({ port: 0, handler: echo })

    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://localhost:${server.port}`)
    return server.stop()
  })
})

describe('the stage lock', () => {
  test('is taken once and refused after that', () => {
    const cli = createCli()
    const lockFile = join(cli.dataDir, 'server.lock')

    acquireLock(lockFile, { pid: process.pid, port: 24100, bind: DEFAULT_BIND, startedAt: 'now' })

    expect(() =>
      acquireLock(lockFile, {
        pid: process.pid,
        port: 24100,
        bind: DEFAULT_BIND,
        startedAt: 'now',
      }),
    ).toThrow(ServerError)
    releaseLock(lockFile)
    expect(existsSync(lockFile)).toBe(false)
  })

  test('carries the pid and the port, so the URL can describe what is running', () => {
    const cli = createCli()
    const lockFile = writeLock(cli, { port: 24242 })

    expect(readLock(lockFile)).toMatchObject({ pid: process.pid, port: 24242 })
  })

  test('carries the address the server took, and reads an older lock as loopback', () => {
    const cli = createCli()
    const lockFile = writeLock(cli, { bind: '0.0.0.0' })
    expect(readLock(lockFile)?.bind).toBe('0.0.0.0')

    // A lock written before the bind was recorded reads as loopback, so a server
    // with no recorded address is never reported as being on a network.
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, port: 24242, startedAt: '2026-08-23T09:00:00.000Z' }),
    )
    expect(readLock(lockFile)?.bind).toBe(DEFAULT_BIND)
  })

  test('a lock left by a dead process is no lock at all', () => {
    const cli = createCli()
    // PID 1 is init; a pid that cannot exist for us is what we need, so use a
    // very high one that is almost certainly unallocated.
    const lockFile = writeLock(cli, { pid: 2_147_483_646 })

    expect(readLock(lockFile)).toBeUndefined()
    // And the stage can be taken again, rather than being locked out forever.
    acquireLock(lockFile, { pid: process.pid, port: 24100, bind: DEFAULT_BIND, startedAt: 'now' })
    expect(readLock(lockFile)?.pid).toBe(process.pid)
  })

  test('a corrupt lock file is ignored rather than fatal', () => {
    const cli = createCli()
    const lockFile = join(cli.dataDir, 'server.lock')
    writeFileSync(lockFile, 'this is not json')

    expect(readLock(lockFile)).toBeUndefined()
  })
})

describe('serve', () => {
  test('is exit 7 when another server holds the stage', async () => {
    const cli = createCli()
    writeLock(cli)

    const result = await cli.run(['serve', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().code).toBe('SERVER')
    expect(result.error().message).toContain('already holds this stage')
  })
})

describe('the address that means this machine', () => {
  test('is every spelling of loopback, and nothing else', () => {
    for (const bind of ['127.0.0.1', '127.0.1.1', 'localhost', 'LocalHost', '::1', '[::1]']) {
      expect(isLoopbackBind(bind), bind).toBe(true)
    }
    for (const bind of ['0.0.0.0', '::', '192.168.1.9', '203.0.113.7', 'fe80::1', '10.0.0.4']) {
      expect(isLoopbackBind(bind), bind).toBe(false)
    }
  })

  test('is never a name that merely begins like one, because a name is resolved', () => {
    // `Bun.serve` hands the string to the resolver, and whoever owns a domain
    // decides what it answers. A name starting with "127." can point at the
    // machine's public address, so the allow-list has to be an address test:
    // `localhost`, `::1`, and a well-formed 127.x.x.x literal, nothing else.
    for (const bind of [
      '127.evil.example.com',
      '127.0.0.1.example.com',
      '127.',
      '127.0.0',
      '127.0.0.1.1',
      '127.0.0.256',
      '127.0.0.-1',
      '127.0.0.1a',
      'localhost.evil.example.com',
    ]) {
      expect(isLoopbackBind(bind), bind).toBe(false)
    }
  })
})

describe('the tunnel command', () => {
  test('forwards the review port to the same port on this machine', () => {
    expect(tunnelCommandFor(24100, '203.0.113.7')).toBe(
      'ssh -N -L 24100:127.0.0.1:24100 you@203.0.113.7',
    )
  })

  test('says “your-server” when the host is not known', () => {
    expect(tunnelCommandFor(24777, undefined)).toBe(
      'ssh -N -L 24777:127.0.0.1:24777 you@your-server',
    )
  })

  test('is nothing at all outside a remote login', () => {
    expect(remoteTunnelCommand({}, 24100)).toBeUndefined()
    expect(remoteTunnelCommand({ SSH_CONNECTION: '  ' }, 24100)).toBeUndefined()
  })

  test('takes the host from the server address inside SSH_CONNECTION', () => {
    expect(remoteTunnelCommand({ SSH_CONNECTION }, 24100)).toBe(
      'ssh -N -L 24100:127.0.0.1:24100 you@203.0.113.7',
    )
  })

  test('is still offered when only SSH_TTY says this is a remote login', () => {
    expect(remoteTunnelCommand({ SSH_TTY: '/dev/pts/0' }, 24100)).toBe(
      'ssh -N -L 24100:127.0.0.1:24100 you@your-server',
    )
  })
})

describe('a wildcard address', () => {
  test('is every spelling of “every interface”, and nothing else', () => {
    for (const bind of ['0.0.0.0', '::', '[::]', ' 0.0.0.0 ']) {
      expect(isWildcardBind(bind), bind).toBe(true)
    }
    for (const bind of ['127.0.0.1', '192.168.1.9', 'localhost', '::1']) {
      expect(isWildcardBind(bind), bind).toBe(false)
    }
  })
})

describe('the URL a person is handed', () => {
  test('is localhost for every spelling of loopback', () => {
    for (const bind of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) {
      expect(humanUrlFor(bind, 24100), bind).toBe('http://localhost:24100')
    }
  })

  test('is the address itself when one interface was named, because only that answers', () => {
    expect(humanUrlFor('192.168.1.9', 24100)).toBe('http://192.168.1.9:24100')
    expect(humanUrlFor('fe80::1', 24100)).toBe('http://[fe80::1]:24100')
  })

  test('is localhost for a wildcard an older server bound, which answers on loopback too', () => {
    for (const bind of ['0.0.0.0', '::', '[::]']) {
      expect(humanUrlFor(bind, 24100), bind).toBe('http://localhost:24100')
    }
  })
})

describe('the link a command prints', () => {
  // `revision create` and `session create` print `stage.urlForRetro` and
  // `stage.urlForSession`; the stage is where their host is decided.
  const stageOf = (cli: Cli) => {
    const home = dirname(cli.dataDir)
    return resolveStage({ env: { RETROLOOP_HOME: home }, cwd: home })
  }

  test('is localhost when no server is running', () => {
    const stage = stageOf(createCli())

    expect(stage.url).toBe('http://localhost:24100')
    expect(stage.urlForRetro(20, 1)).toBe('http://localhost:24100/retros/20?rev=1')
  })

  test('is localhost when the running server is on loopback', () => {
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: DEFAULT_BIND })

    expect(stageOf(cli).urlForRetro(20, 1)).toBe('http://localhost:24242/retros/20?rev=1')
  })

  test('is the named interface when that is the only place the running server answers', () => {
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '192.168.1.9' })
    const stage = stageOf(cli)

    expect(stage.url).toBe('http://192.168.1.9:24242')
    expect(stage.urlForRetro(20, 1)).toBe('http://192.168.1.9:24242/retros/20?rev=1')
    expect(stage.urlForRetro(20)).toBe('http://192.168.1.9:24242/retros/20')
    expect(stage.urlForSession(3)).toBe('http://192.168.1.9:24242/sessions/3')
  })
})

describe('up', () => {
  test('does nothing when the server is already running', async () => {
    let spawned = 0
    const cli = createCli({
      spawnServe: async () => {
        spawned += 1
      },
    })
    writeLock(cli, { port: 24242 })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({
      url: 'http://localhost:24242',
      port: 24242,
      pid: process.pid,
      bind: DEFAULT_BIND,
      started: false,
    })
    expect(spawned).toBe(0)
  })

  test('starts one and reports the port it actually took', async () => {
    const cli = createCli({
      spawnServe: async (stage) => {
        // Stands in for the detached `serve`, which takes the lock on startup.
        acquireLock(stage.lockFile, {
          pid: process.pid,
          port: 24999,
          bind: DEFAULT_BIND,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
      },
    })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({
      url: 'http://localhost:24999',
      port: 24999,
      pid: process.pid,
      bind: DEFAULT_BIND,
      started: true,
    })
  })

  test('hands the spawned serve the port and the address it is to take', async () => {
    const asked: ServeAddress[] = []
    const cli = createCli({
      spawnServe: async (stage, address) => {
        asked.push(address)
        acquireLock(stage.lockFile, {
          pid: process.pid,
          port: address.port,
          bind: address.bind,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
      },
    })

    await cli.run(['up', '--json'])
    releaseLock(join(cli.dataDir, 'server.lock'))
    await cli.run(['up', '--bind', 'localhost', '--port', '24777', '--json'])

    expect(asked).toEqual([
      { port: 24100, bind: '127.0.0.1' },
      { port: 24777, bind: 'localhost' },
    ])
  })

  test('never claims a link on the network, whatever it starts', async () => {
    const cli = createCli({
      spawnServe: async (stage, address) => {
        acquireLock(stage.lockFile, {
          pid: process.pid,
          port: address.port,
          bind: address.bind,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
      },
    })

    const loopback = await cli.run(['up', '--json'])

    expect(loopback.json()).not.toHaveProperty('lanUrl')
    expect(loopback.json()).toMatchObject({ url: 'http://localhost:24100', started: true })
  })

  test('hands over the address a running server answers on, not localhost', async () => {
    // The server was started earlier with `--bind 192.168.1.9`; this `up` is bare.
    // It starts nothing and binds nothing — it reads what is serving and says so.
    let spawned = 0
    const cli = createCli({
      spawnServe: async () => {
        spawned += 1
      },
    })
    writeLock(cli, { port: 24242, bind: '192.168.1.9' })

    const json = await cli.run(['up', '--json'])
    const line = await cli.run(['up'])

    expect(json.json()).toEqual({
      url: 'http://192.168.1.9:24242',
      port: 24242,
      pid: process.pid,
      bind: '192.168.1.9',
      started: false,
    })
    expect(line.stdout.join('\n')).toContain('Already running — http://192.168.1.9:24242 ')
    expect(spawned).toBe(0)
  })

  test('says out loud that a running server ignored the address it was handed', async () => {
    // An older server left a wildcard in the lock; this `up` asks for loopback
    // and starts nothing, so the address it asked for has not been applied.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '0.0.0.0' })

    const result = await cli.run(['up', '--bind', '127.0.0.1'])

    expect(result.stdout.join('\n')).toContain('the running server is bound to 0.0.0.0')
    expect(result.stdout.join('\n')).toContain('retroloop down')
  })

  test('is exit 7 when the server never comes up', async () => {
    const cli = createCli({ spawnServe: async () => undefined })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().message).toContain('did not come up')
  })
})

/**
 * The review page is the product; a link to a page that was never built is a
 * dead link. So `up` builds it before it hands over any link at all — on both
 * of the things it does, starting a server and reporting one that is already
 * running, because a newcomer whose first attempt failed re-runs the install and
 * lands on the second one. The server reads the page off the disk per request,
 * so a build reaches a server that is already up with no restart.
 *
 * **Stale means strictly newer.** The page is rebuilt when some source file's
 * modification time is *later* than the built index's — the same instant is the
 * build's own output and is current, or every start on a fast machine would
 * rebuild forever.
 *
 * Every case here drives the seams: no test ever runs a real `vite`.
 */
describe('the review page up hands over', () => {
  const areas: string[] = []
  afterAll(() => {
    for (const dir of areas.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  type Area = {
    /** Where the built page's index lives — `up`'s `webBuildIndex` seam. */
    readonly index: string
    /** A file of the page's source, one of the paths whose newest change counts. */
    readonly sourceFile: string
    readonly sourcePaths: readonly string[]
    readonly sourceRoot: string
  }

  function anArea(): Area {
    const dir = mkdtempSync(join(tmpdir(), 'retro-page-'))
    areas.push(dir)
    const sourceRoot = join(dir, 'source')
    mkdirSync(join(dir, 'dist'))
    mkdirSync(sourceRoot)
    const sourceFile = join(sourceRoot, 'main.tsx')
    writeFileSync(sourceFile, 'the page')
    return {
      index: join(dir, 'dist', 'index.html'),
      sourceFile,
      sourcePaths: [sourceRoot],
      sourceRoot,
    }
  }

  /** Seconds since the epoch, so a test says which file is newer and by how much. */
  function stamp(path: string, seconds: number): void {
    utimesSync(path, seconds, seconds)
  }

  function writeIndex(area: Area): void {
    writeFileSync(area.index, '<!doctype html><title>Retro</title>')
  }

  function builder(area: Area, calls: string[], result = { ok: true, output: '' }) {
    return async () => {
      calls.push('build')
      if (result.ok) writeIndex(area)
      return result
    }
  }

  function startingLock(stage: { lockFile: string }): void {
    acquireLock(stage.lockFile, {
      pid: process.pid,
      port: 24999,
      bind: DEFAULT_BIND,
      startedAt: '2026-08-23T09:00:00.000Z',
    })
  }

  test('is built when it is missing, and only then is a link handed over', async () => {
    const area = anArea()
    const calls: string[] = []
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async (stage) => {
        // The page has to exist before the server does: it is what the server serves.
        expect(calls).toEqual(['build'])
        startingLock(stage)
      },
    })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(calls).toEqual(['build'])
    expect(existsSync(area.index)).toBe(true)
    // The success answer is what it always was — not one field more.
    expect(result.json()).toEqual({
      url: 'http://localhost:24999',
      port: 24999,
      pid: process.pid,
      bind: DEFAULT_BIND,
      started: true,
    })
  })

  test('is left alone when it is there and newer than the page’s source', async () => {
    const area = anArea()
    const calls: string[] = []
    writeIndex(area)
    stamp(area.sourceFile, 1_000)
    stamp(area.index, 2_000)
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async (stage) => startingLock(stage),
    })

    const result = await cli.run(['up', '--json'])

    expect(calls).toEqual([])
    expect(result.json()).toEqual({
      url: 'http://localhost:24999',
      port: 24999,
      pid: process.pid,
      bind: DEFAULT_BIND,
      started: true,
    })
  })

  test('is left alone when the source changed in the very instant it was built', async () => {
    const area = anArea()
    const calls: string[] = []
    writeIndex(area)
    stamp(area.sourceFile, 2_000)
    stamp(area.index, 2_000)
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async (stage) => startingLock(stage),
    })

    await cli.run(['up', '--json'])

    expect(calls).toEqual([])
  })

  test('is rebuilt when a source file is newer than it', async () => {
    const area = anArea()
    const calls: string[] = []
    writeIndex(area)
    stamp(area.index, 2_000)
    stamp(area.sourceFile, 2_001)
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async (stage) => startingLock(stage),
    })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(calls).toEqual(['build'])
  })

  test('does not read installed packages or earlier builds as the page’s source', async () => {
    // `node_modules` is touched by every install and holds tens of thousands of
    // files; a build's own output is newer than the build by definition. Reading
    // either as source would rebuild on every start, and walking the first would
    // cost more than the build it is deciding about.
    const area = anArea()
    const calls: string[] = []
    writeIndex(area)
    stamp(area.sourceFile, 1_000)
    stamp(area.index, 2_000)
    for (const ignored of ['node_modules', 'dist', 'dist-mocked', 'test-results']) {
      const dir = join(area.sourceRoot, ignored)
      mkdirSync(dir)
      const file = join(dir, 'newer.js')
      writeFileSync(file, 'newer than the build')
      stamp(file, 9_000)
    }
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async (stage) => startingLock(stage),
    })

    await cli.run(['up', '--json'])

    expect(calls).toEqual([])
  })

  test('says one plain line while it builds, and nothing at all in --json', async () => {
    const area = anArea()
    const calls: string[] = []
    const seams = {
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      spawnServe: async (stage: { lockFile: string }) => startingLock(stage),
    }

    const line = await createCli({ ...seams, buildWeb: builder(area, calls) }).run(['up'])
    rmSync(area.index)
    const json = await createCli({ ...seams, buildWeb: builder(area, calls) }).run(['up', '--json'])

    expect(calls).toEqual(['build', 'build'])
    expect(line.stdout[0]).toBe('Building the review page…')
    expect(line.stdout.join('\n')).toContain('Started — http://localhost:24999')
    // `--json` is one object on stdout and nothing else: `json()` throws otherwise.
    expect(json.stdout.length).toBe(1)
    expect(json.json()).toHaveProperty('started', true)
  })

  test('is built for a server that is already running too', async () => {
    const area = anArea()
    const calls: string[] = []
    let spawned = 0
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
      spawnServe: async () => {
        spawned += 1
      },
    })
    writeLock(cli, { port: 24242 })

    const result = await cli.run(['up', '--json'])

    expect(calls).toEqual(['build'])
    expect(spawned).toBe(0)
    expect(result.json()).toEqual({
      url: 'http://localhost:24242',
      port: 24242,
      pid: process.pid,
      bind: DEFAULT_BIND,
      started: false,
    })
  })

  test('stops with the build’s own words when the build fails, and hands over no link', async () => {
    const area = anArea()
    const calls: string[] = []
    let spawned = 0
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls, { ok: false, output: 'error: Cannot find module "react"' }),
      spawnServe: async () => {
        spawned += 1
      },
    })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().code).toBe('SERVER')
    expect(result.error().message).toContain('error: Cannot find module "react"')
    expect(result.error().message).toContain('Run bun run build in the app folder.')
    // No link, no `started`, and nothing started: the only error a newcomer sees.
    expect(result.stdout).toEqual([])
    expect(spawned).toBe(0)
    expect(calls).toEqual(['build'])
  })

  test('hands over no link for a running server either, when the build fails', async () => {
    const area = anArea()
    const calls: string[] = []
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls, { ok: false, output: 'error: out of memory' }),
    })
    writeLock(cli, { port: 24242 })

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().message).toContain('error: out of memory')
    expect(result.stdout).toEqual([])
  })

  test('a build that cannot even start is a failed build, not a crash', async () => {
    // `Bun.spawn` throws — synchronously, before anything is awaited — when the
    // executable is not on `$PATH`, and again when the folder it was told to run
    // in does not exist. Unguarded, that throw is not a build result at all: it
    // leaves `up` as an unclassified exit 1 reading `Executable not found in
    // $PATH: "bun"`, which names neither the build nor the command to run. The
    // machine this whole item is about is exactly that one — Bun installed and
    // not resolvable by name from the shell a script gets.
    const missing = await buildReviewPage('definitely-not-a-command-xyz run build')

    expect(missing.ok).toBe(false)
    expect(missing.output).toContain('definitely-not-a-command-xyz')

    const noSuchFolder = await buildReviewPage(
      WEB_BUILD_COMMAND,
      join(tmpdir(), 'retro-no-such-folder-xyz'),
    )

    expect(noSuchFolder.ok).toBe(false)
    expect(noSuchFolder.output).not.toBe('')
  })

  test('gives back everything a real build printed, and whether it worked', async () => {
    // A real child process, and still not `vite`: what is being checked is that
    // both streams come back joined and that the exit status is the verdict.
    const dir = mkdtempSync(join(tmpdir(), 'retro-build-'))
    areas.push(dir)
    writeFileSync(join(dir, 'say.sh'), 'echo on stdout\necho on stderr >&2\nexit 3\n')

    const failed = await buildReviewPage('bash say.sh', dir)

    expect(failed.ok).toBe(false)
    expect(failed.output).toContain('on stdout')
    expect(failed.output).toContain('on stderr')

    writeFileSync(join(dir, 'say.sh'), 'echo built\n')
    const worked = await buildReviewPage('bash say.sh', dir)

    expect(worked.ok).toBe(true)
    expect(worked.output).toBe('built')
  })

  test('stops the way a failed build stops when the build command is not on the path', async () => {
    const area = anArea()
    let spawned = 0
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: () => buildReviewPage('definitely-not-a-command-xyz run build'),
      spawnServe: async () => {
        spawned += 1
      },
    })

    const result = await cli.run(['up', '--json'])

    // The documented failure, not a crash: exit 7, the code a script reads, the
    // build's own words, and the one command to run by hand.
    expect(result.code).toBe(EXIT.server)
    expect(result.error().code).toBe('SERVER')
    expect(result.error().message).toContain('the review page could not be built')
    expect(result.error().message).toContain('definitely-not-a-command-xyz')
    expect(result.error().message).toContain('Run bun run build in the app folder.')
    expect(result.stdout).toEqual([])
    expect(spawned).toBe(0)
  })

  test('builds into the very file the server serves from, out of the folder it is in', async () => {
    // Three places could drift apart into a start that builds one page, a server
    // that serves another, and a staleness check that reads neither. They are the
    // same constants: the index out of `@retro/api`, the sources off this
    // package's own location.
    const runtime = createDefaultRuntime()

    expect(runtime.webBuildIndex).toBe(WEB_BUILD_INDEX)
    expect(runtime.webBuildIndex.endsWith('/apps/web/dist/index.html')).toBe(true)
    // Pinned, because an `APP_ROOT` off by one level is silent: every source path
    // would stat as absent, nothing would ever read stale, and the feature would
    // quietly shrink back to "build only when missing" with the suite still green.
    expect(runtime.webSourcePaths.map((path) => path.replace(APP_ROOT, ''))).toEqual([
      join('apps', 'web'),
      'bun.lock',
    ])
    for (const path of runtime.webSourcePaths) expect(existsSync(path), path).toBe(true)
  })

  test('is never built by serve, which is the developer’s own command', async () => {
    // Deliberate: `serve` is run by hand and by the end-to-end suite, which builds
    // before it starts. Pinned all the same, because a later change that moves the
    // build into a helper both commands call would otherwise pass unnoticed.
    const area = anArea()
    const calls: string[] = []
    const cli = createCli({
      webBuildIndex: area.index,
      webSourcePaths: area.sourcePaths,
      buildWeb: builder(area, calls),
    })
    writeLock(cli)

    const result = await cli.run(['serve', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(calls).toEqual([])
    expect(existsSync(area.index)).toBe(false)
  })
})

/**
 * The review server listens on this machine and nowhere else. It holds a human's
 * frictions in their own words and has no password of any kind, so every address
 * that is not loopback is refused before anything is started, written or locked —
 * public, private and wildcard alike, one rule, with no flag and no environment
 * variable that undoes it. The way in from another computer is the secure-shell
 * tunnel, and the refusal is where that is taught.
 */
describe('the bind address', () => {
  /**
   * A stage that can be restarted the way `up` and `down` see one: the spawned
   * `serve` takes the lock and records in it the address it actually took, and
   * the signalled one releases the lock on its way out. Every address `up` asked
   * for lands in `asked`, in order.
   */
  function restartableStage(): { cli: Cli; asked: ServeAddress[] } {
    const asked: ServeAddress[] = []
    let lockFile = ''
    const cli = createCli({
      spawnServe: async (stage, address) => {
        asked.push(address)
        acquireLock(stage.lockFile, {
          pid: process.pid,
          port: address.port,
          bind: address.bind,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
      },
      stopProcess: () => releaseLock(lockFile),
    })
    lockFile = join(cli.dataDir, 'server.lock')
    return { cli, asked }
  }

  test('a file left on the stage by an older version cannot widen the bind', async () => {
    const { cli, asked } = restartableStage()
    const stale = join(cli.dataDir, 'last-bind.json')
    const contents = JSON.stringify({ bind: '0.0.0.0' })
    writeFileSync(stale, contents)

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(asked.map((address) => address.bind)).toEqual([DEFAULT_BIND])
    // Not read, and not written either: the file is inert, not maintained.
    expect(readFileSync(stale, 'utf8')).toBe(contents)
  })

  test('no --bind means loopback, every time', async () => {
    const { cli, asked } = restartableStage()

    await cli.run(['up', '--json'])
    await cli.run(['down', '--json'])
    await cli.run(['up', '--bind', 'localhost', '--json'])
    await cli.run(['down', '--json'])
    await cli.run(['up', '--json'])

    expect(asked.map((address) => address.bind)).toEqual([DEFAULT_BIND, 'localhost', DEFAULT_BIND])
  })

  test('a stage that has never run a server starts on loopback', async () => {
    const { cli, asked } = restartableStage()

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(asked).toEqual([{ port: 24100, bind: DEFAULT_BIND }])
    expect(result.json()).not.toHaveProperty('lanUrl')
  })

  test('up writes nothing down about the address it was given', async () => {
    const { cli } = restartableStage()

    await cli.run(['up', '--bind', 'localhost', '--json'])

    expect(existsSync(join(cli.dataDir, 'last-bind.json'))).toBe(false)
  })

  test('every spelling of loopback still starts a server', async () => {
    for (const loopback of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) {
      const { cli, asked } = restartableStage()

      const result = await cli.run(['up', '--bind', loopback, '--json'])

      expect(result.code, loopback).toBe(EXIT.ok)
      expect(
        asked.map((address) => address.bind),
        loopback,
      ).toEqual([loopback])
    }
  })

  test('up refuses every address that is not this machine, and starts nothing', async () => {
    // Public, private and wildcard alike — one rule, and the same message.
    for (const address of ['203.0.113.7', '192.168.1.9', '10.0.0.4', '0.0.0.0', '::', '[::]']) {
      const { cli, asked } = restartableStage()

      const result = await cli.run(['up', '--bind', address, '--json'])

      expect(result.code, address).toBe(EXIT.usage)
      expect(result.error().code).toBe('USAGE')
      expect(result.error().message, address).toBe(refusalFor(address))
      expect(asked, address).toEqual([])
      expect(existsSync(join(cli.dataDir, 'server.lock')), address).toBe(false)
    }
  })

  test('up refuses a name that merely begins like loopback, and starts nothing', async () => {
    // The string goes to the resolver, not to a comparison, so a domain whose
    // owner points it at the machine's public address would bind there — and
    // the link printed beside it would still say localhost.
    for (const address of ['127.evil.example.com', '127.0.0.1.example.com', '127.0.0.256']) {
      const { cli, asked } = restartableStage()

      const result = await cli.run(['up', '--bind', address, '--json'])

      expect(result.code, address).toBe(EXIT.usage)
      expect(result.error().message, address).toBe(refusalFor(address))
      expect(asked, address).toEqual([])
      expect(existsSync(join(cli.dataDir, 'server.lock')), address).toBe(false)
    }
  })

  test('the refusal names the tunnel, and the port the caller actually asked for', async () => {
    const { cli } = restartableStage()

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--port', '24777', '--json'])

    expect(result.error().message).toBe(refusalFor('203.0.113.7', 24777))
    expect(result.error().message).toContain('only ever listens on this machine')
    expect(result.error().message).toContain('ssh -N -L 24777:127.0.0.1:24777 you@your-server')
    expect(result.error().message).toContain('http://localhost:24777')
  })

  test('the refusal names the port from the environment when that is where it comes from', async () => {
    // A tunnel command for a port nothing listens on is worse than no command:
    // the reader pastes it, the page does not load, and nothing says why. The
    // port the refusal prints has to be the port this stage would actually use.
    const asked: ServeAddress[] = []
    const cli = createCli({
      env: { RETRO_PORT: '24777' },
      spawnServe: async (_stage, address) => {
        asked.push(address)
      },
    })

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--json'])

    expect(result.error().message).toBe(refusalFor('203.0.113.7', 24777))
    expect(asked).toEqual([])
  })

  test('the refusal names the port a running server holds', async () => {
    const cli = createCli()
    writeLock(cli, { port: 24242 })

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--json'])

    expect(result.error().message).toBe(refusalFor('203.0.113.7', 24242))
  })

  test('the refusal never leaves punctuation stuck to the command', async () => {
    // Nothing marks the end of a command in a terminal, so a trailing comma
    // travels with the copy. The command gets a line to itself instead.
    const { cli } = restartableStage()

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--json'])

    expect(result.error().message).not.toContain('you@your-server,')
    expect(result.error().message).toContain(
      '\n  ssh -N -L 24100:127.0.0.1:24100 you@your-server\n',
    )
  })

  test('no environment variable can undo the refusal', async () => {
    // There is nothing to type: the refusal reads the address and nothing else.
    const asked: ServeAddress[] = []
    const cli = createCli({
      env: {
        RETROLOOP_BIND: '203.0.113.7',
        RETROLOOP_ALLOW_NETWORK_BIND: '1',
        RETRO_ALLOW_LAN: 'yes',
      },
      spawnServe: async (_stage, address) => {
        asked.push(address)
      },
    })

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--json'])

    expect(result.code).toBe(EXIT.usage)
    expect(result.error().message).toBe(refusalFor('203.0.113.7'))
    expect(asked).toEqual([])
  })

  test('up refuses a network address even when a server is already running', async () => {
    const cli = createCli()
    writeLock(cli, { port: 24242 })

    const result = await cli.run(['up', '--bind', '203.0.113.7'])

    expect(result.code).toBe(EXIT.usage)
    // Refused before it looked at the stage: no "already running" line either.
    expect(result.stdout).toEqual([])
  })

  test('serve refuses a network address before it takes the stage lock', async () => {
    for (const address of ['203.0.113.7', '192.168.1.9', '0.0.0.0']) {
      const cli = createCli()

      const result = await cli.run(['serve', '--bind', address, '--json'])

      expect(result.code, address).toBe(EXIT.usage)
      expect(result.error().message, address).toBe(refusalFor(address))
      expect(readLock(join(cli.dataDir, 'server.lock')), address).toBeUndefined()
    }
  })

  test('every address up hands to a spawned serve is one serve itself accepts', async () => {
    // A disagreement between the parent's refusal and the child's would not look
    // like a refusal at all: `up` spawns, the child refuses into a discarded
    // stderr, and the only symptom is `up` timing out with "the server did not
    // come up". So the addresses are the ones `up` actually passed, run back
    // through `serve`'s own argument path — where a held lock stops it at exit 7,
    // which is itself the proof that the address got through.
    for (const loopback of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) {
      const { cli, asked } = restartableStage()

      const started = await cli.run(['up', '--bind', loopback, '--json'])
      expect(started.code, loopback).toBe(EXIT.ok)
      const handedOver = asked[0]?.bind as string
      expect(handedOver, loopback).toBe(loopback)

      const child = createCli()
      writeLock(child)
      const result = await child.run(['serve', '--bind', handedOver, '--json'])

      expect(result.code, loopback).toBe(EXIT.server)
      expect(result.error().code, loopback).toBe('SERVER')
    }
  })

  test('up prints the address it bound, in JSON and to a human', async () => {
    const { cli } = restartableStage()

    const loopback = await cli.run(['up', '--json'])
    await cli.run(['down', '--json'])
    const line = await cli.run(['up'])

    expect(loopback.jsonAs<{ bind: string }>().bind).toBe(DEFAULT_BIND)
    expect(line.stdout.join('\n')).toContain('bound to 127.0.0.1')
  })

  test('reports the address a running server holds, wildcard and all', async () => {
    // Reporting a fact is not binding: a lock written by an older server can say
    // `0.0.0.0`, and the terminal has to show what is actually being served.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '0.0.0.0' })

    const line = await cli.run(['up'])
    const json = await cli.run(['up', '--json'])

    expect(line.code).toBe(EXIT.ok)
    expect(line.stdout.join('\n')).toContain('bound to 0.0.0.0')
    expect(json.jsonAs<{ bind: string }>().bind).toBe('0.0.0.0')
  })

  test('tells the caller to restart when the running server is not on this machine', async () => {
    // The note earns its place on exactly one case: a server started before this
    // rule existed, still holding a network address. Then the address the caller
    // asked for really is somewhere else, and only a restart moves it.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '0.0.0.0' })

    const result = await cli.run(['up', '--bind', 'localhost'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.stdout.join('\n')).toContain('needs a restart')
  })

  test('does not tell the caller to restart over two spellings of this machine', async () => {
    // Now that this machine is the only address there is, `--bind localhost`
    // against a server on 127.0.0.1 is agreement, not disagreement. A restart
    // would change nothing, so asking for one is a false alarm.
    for (const asked of ['localhost', '127.0.0.1', '::1']) {
      const cli = createCli()
      writeLock(cli, { port: 24242, bind: DEFAULT_BIND })

      const result = await cli.run(['up', '--bind', asked])

      expect(result.code, asked).toBe(EXIT.ok)
      expect(result.stdout.join('\n'), asked).not.toContain('needs a restart')
    }
  })

  test('does not tell a bare up that the running server disagrees with it', async () => {
    // `up` was handed no address, so there is no disagreement to report — the
    // note would otherwise name the loopback default the caller never asked for.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '0.0.0.0' })

    const result = await cli.run(['up'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.stdout.join('\n')).not.toContain('needs a restart')
  })
})

/**
 * The refusal ends the exposure; this is the other half — telling someone working
 * on a remote machine how to get in. A start inside a secure-shell login prints
 * the forwarding command to paste on their own computer, with the real port and,
 * when the connection says so, the real host.
 */
describe('the tunnel line beside the link', () => {
  function startingCli(env: Record<string, string | undefined> = {}): Cli {
    return createCli({
      env,
      spawnServe: async (stage, address) => {
        acquireLock(stage.lockFile, {
          pid: process.pid,
          port: address.port,
          bind: address.bind,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
      },
    })
  }

  test('is absent when the start is not inside a remote login', async () => {
    // Also the guard on the harness: the real environment must never reach a
    // command, or a suite run over a secure shell would print this everywhere.
    const line = await startingCli().run(['up'])
    const json = await startingCli().run(['up', '--json'])

    expect(line.stdout.join('\n')).not.toContain('ssh -N -L')
    expect(json.json()).not.toHaveProperty('tunnel')
  })

  test('is printed beside the link when SSH_CONNECTION says this is a remote login', async () => {
    const result = await startingCli({ SSH_CONNECTION }).run(['up'])

    expect(result.code).toBe(EXIT.ok)
    const printed = result.stdout.join('\n')
    expect(printed).toContain('Started — http://localhost:24100')
    expect(printed).toContain('ssh -N -L 24100:127.0.0.1:24100 you@203.0.113.7')
    expect(printed).toContain('http://localhost:24100')
  })

  test('gives the command a line of its own, with nothing stuck to either end', async () => {
    const result = await startingCli({ SSH_CONNECTION }).run(['up'])

    const printed = result.stdout.join('\n')
    expect(printed).toContain('\n  ssh -N -L 24100:127.0.0.1:24100 you@203.0.113.7\n')
    expect(printed).not.toContain('you@203.0.113.7,')
  })

  test('carries the port the server actually took', async () => {
    const result = await startingCli({ SSH_CONNECTION }).run(['up', '--port', '24777'])

    expect(result.stdout.join('\n')).toContain('ssh -N -L 24777:127.0.0.1:24777 you@203.0.113.7')
  })

  test('is a field in --json, never prose', async () => {
    const result = await startingCli({ SSH_CONNECTION }).run(['up', '--json'])

    expect(result.json()).toMatchObject({
      url: 'http://localhost:24100',
      started: true,
      tunnel: 'ssh -N -L 24100:127.0.0.1:24100 you@203.0.113.7',
    })
  })

  test('falls back to a named placeholder when only SSH_TTY says so', async () => {
    const result = await startingCli({ SSH_TTY: '/dev/pts/3' }).run(['up', '--json'])

    expect(result.jsonAs<{ tunnel: string }>().tunnel).toBe(
      'ssh -N -L 24100:127.0.0.1:24100 you@your-server',
    )
  })

  test('is printed for a server that is already running too', async () => {
    const cli = createCli({ env: { SSH_CONNECTION } })
    writeLock(cli, { port: 24242, bind: DEFAULT_BIND })

    const result = await cli.run(['up', '--json'])

    expect(result.jsonAs<{ tunnel: string }>().tunnel).toBe(
      'ssh -N -L 24242:127.0.0.1:24242 you@203.0.113.7',
    )
  })
})

describe('down', () => {
  test('is success and signals nothing when there is no server', async () => {
    const signalled: number[] = []
    const cli = createCli({
      stopProcess: (pid) => {
        signalled.push(pid)
      },
    })

    const result = await cli.run(['down', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({ stopped: false, pid: null })
    expect(signalled).toEqual([])
  })

  test('leaves a dead process’ lock alone and reports nothing to stop', async () => {
    const signalled: number[] = []
    const cli = createCli({
      stopProcess: (pid) => {
        signalled.push(pid)
      },
    })
    writeLock(cli, { pid: 2_147_483_646 })

    const result = await cli.run(['down', '--json'])

    expect(result.json()).toEqual({ stopped: false, pid: null })
    expect(signalled).toEqual([])
  })

  test('signals the running server and reports the pid it stopped', async () => {
    const signalled: number[] = []
    let lockFile = ''
    const cli = createCli({
      stopProcess: (pid) => {
        signalled.push(pid)
        // Stands in for `serve`, which releases the lock on its way out.
        releaseLock(lockFile)
      },
    })
    lockFile = writeLock(cli, { port: 24242 })

    const result = await cli.run(['down', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({ stopped: true, pid: process.pid })
    expect(signalled).toEqual([process.pid])
    expect(existsSync(lockFile)).toBe(false)
  })

  test('is idempotent — stopping a stopped server is success, not an error', async () => {
    let lockFile = ''
    const cli = createCli({
      stopProcess: () => {
        releaseLock(lockFile)
      },
    })
    lockFile = writeLock(cli)

    const first = await cli.run(['down', '--json'])
    const second = await cli.run(['down', '--json'])

    expect(first.jsonAs<{ stopped: boolean }>().stopped).toBe(true)
    expect(second.code).toBe(EXIT.ok)
    expect(second.jsonAs<{ stopped: boolean }>().stopped).toBe(false)
  })

  test('is exit 7 when the server will not let go of the stage', async () => {
    // The signal lands on a process that is alive and keeps its lock — which is
    // exactly the case where the lock must survive: it is not ours to clear.
    const cli = createCli({ stopProcess: () => undefined })
    const lockFile = writeLock(cli)

    const result = await cli.run(['down', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().code).toBe('SERVER')
    expect(result.error().message).toContain('did not stop')
    expect(existsSync(lockFile)).toBe(true)
  })

  test('a process that vanishes as it is signalled is still a clean stop', async () => {
    let lockFile = ''
    const cli = createCli({
      stopProcess: () => {
        releaseLock(lockFile)
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
      },
    })
    lockFile = writeLock(cli)

    const result = await cli.run(['down', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ stopped: boolean }>().stopped).toBe(true)
  })
})
