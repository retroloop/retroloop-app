import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EXIT, ServerError } from '#errors'
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
import { type Cli, createCli, removeTempStages } from './support/harness'

/** The one refusal, spelled out where a test can read it as a person would. */
function refusalFor(bind: string, port = 24100): string {
  return (
    `--bind ${bind} is refused: the review server only ever listens on this machine. ` +
    `To open it from another computer, forward the port over your SSH connection: ` +
    `ssh -N -L ${port}:127.0.0.1:${port} you@your-server, then open http://localhost:${port}`
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

    // A lock written before the bind was recorded must not be read as a server
    // on the network — the reading that cannot invent a LAN URL wins.
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

  test('the refusal names the tunnel, and the port the caller actually asked for', async () => {
    const { cli } = restartableStage()

    const result = await cli.run(['up', '--bind', '203.0.113.7', '--port', '24777', '--json'])

    expect(result.error().message).toBe(refusalFor('203.0.113.7', 24777))
    expect(result.error().message).toContain('only ever listens on this machine')
    expect(result.error().message).toContain('ssh -N -L 24777:127.0.0.1:24777 you@your-server')
    expect(result.error().message).toContain('http://localhost:24777')
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
