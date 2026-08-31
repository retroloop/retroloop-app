import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT, ServerError } from '#errors'
import { DEFAULT_BIND, isLoopbackBind, lanUrlFor, type ServeAddress } from '#server/address'
import { readLastBind, rememberBind } from '#server/last-address'
import { acquireLock, type LockInfo, readLock, releaseLock } from '#server/lock'
import { startServer } from '#server/serve'
import { type Cli, createCli, removeTempStages, TEST_HOST_ADDRESSES } from './support/harness'

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

const hostAddresses = () => TEST_HOST_ADDRESSES

/** `startServer` is the listener; what it serves is the API's business (item 5). */
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

describe('the LAN URL', () => {
  test('is nothing at all for every spelling of loopback', () => {
    for (const bind of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackBind(bind)).toBe(true)
      expect(lanUrlFor(bind, 24100, hostAddresses)).toBeUndefined()
    }
  })

  test('is the address itself when one was named', () => {
    expect(lanUrlFor('192.168.1.9', 24100, hostAddresses)).toBe('http://192.168.1.9:24100')
    expect(lanUrlFor('fe80::1', 24100, hostAddresses)).toBe('http://[fe80::1]:24100')
  })

  test('resolves a wildcard bind to the first address off this machine', () => {
    expect(lanUrlFor('0.0.0.0', 24100, hostAddresses)).toBe('http://192.168.1.42:24100')
    expect(lanUrlFor('::', 24100, hostAddresses)).toBe('http://192.168.1.42:24100')
  })

  test('is nothing at all when the machine has no address to offer', () => {
    const loopbackOnly = () => [{ address: '127.0.0.1', family: 'IPv4', internal: true }]

    expect(lanUrlFor('0.0.0.0', 24100, loopbackOnly)).toBeUndefined()
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
    await cli.run(['up', '--bind', '0.0.0.0', '--port', '24777', '--json'])

    expect(asked).toEqual([
      { port: 24100, bind: '127.0.0.1' },
      { port: 24777, bind: '0.0.0.0' },
    ])
  })

  test('prints the LAN URL when it binds beyond loopback, and none when it does not', async () => {
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
    releaseLock(join(cli.dataDir, 'server.lock'))
    const lan = await cli.run(['up', '--bind', '0.0.0.0', '--json'])

    expect(loopback.json()).not.toHaveProperty('lanUrl')
    expect(lan.json()).toMatchObject({
      url: 'http://localhost:24100',
      lanUrl: 'http://192.168.1.42:24100',
      started: true,
    })
  })

  test('does not claim a LAN URL the running server cannot serve', async () => {
    // `up` starts nothing when a server already holds the stage, so a `--bind`
    // it was handed has not been applied — reporting it would be the same lie
    // the dropped flag used to tell.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: DEFAULT_BIND })

    const result = await cli.run(['up', '--bind', '0.0.0.0', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).not.toHaveProperty('lanUrl')
  })

  test('says out loud that a running server ignored the address it was handed', async () => {
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: DEFAULT_BIND })

    const result = await cli.run(['up', '--bind', '0.0.0.0'])

    expect(result.stdout.join('\n')).toContain('bound to 127.0.0.1')
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
 * retro-6 `r-restart-drops-bind`. A restart is `retro down && retro up`, and the
 * bind lived in a flag and a lock file the `down` deletes — so every post-merge
 * restart rebound to loopback and re-stranded the iPad on the other side of the
 * network. Four times in one session, each one noticed only from the iPad.
 */
describe('the remembered bind', () => {
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

  test('re-uses the bind of the last server on this stage when no --bind is given', async () => {
    const { cli, asked } = restartableStage()

    await cli.run(['up', '--bind', '0.0.0.0', '--json'])
    await cli.run(['down', '--json'])
    await cli.run(['up', '--json'])

    expect(asked.map((address) => address.bind)).toEqual(['0.0.0.0', '0.0.0.0'])
  })

  test('an explicit --bind outranks the memory, and is what gets remembered next', async () => {
    const { cli, asked } = restartableStage()

    // Neither address is the loopback default, so the third start proves the
    // memory was re-read rather than that the default happened to agree with it.
    await cli.run(['up', '--bind', '0.0.0.0', '--json'])
    await cli.run(['down', '--json'])
    await cli.run(['up', '--bind', '192.168.1.9', '--json'])
    await cli.run(['down', '--json'])
    await cli.run(['up', '--json'])

    expect(asked.map((address) => address.bind)).toEqual(['0.0.0.0', '192.168.1.9', '192.168.1.9'])
  })

  test('a stage that has never run a server starts on loopback', async () => {
    const { cli, asked } = restartableStage()

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(asked).toEqual([{ port: 24100, bind: DEFAULT_BIND }])
    expect(result.json()).not.toHaveProperty('lanUrl')
  })

  test('down leaves the memory behind — it is all a restart has to go on', async () => {
    const { cli } = restartableStage()
    const lastBindFile = join(cli.dataDir, 'last-bind.json')

    await cli.run(['up', '--bind', '0.0.0.0', '--json'])
    await cli.run(['down', '--json'])

    expect(existsSync(join(cli.dataDir, 'server.lock'))).toBe(false)
    expect(readLastBind(lastBindFile)).toBe('0.0.0.0')
  })

  test('remembers nothing from a server that never came up', async () => {
    // The address is read back off the lock a live server wrote, so a `--bind`
    // that cannot be bound cannot poison every later `up` with itself.
    const cli = createCli({ spawnServe: async () => undefined })

    const result = await cli.run(['up', '--bind', '0.0.0.0', '--json'])

    expect(result.code).toBe(EXIT.server)
    expect(readLastBind(join(cli.dataDir, 'last-bind.json'))).toBeUndefined()
  })

  test('a memory that cannot be read is no memory at all, and up still comes up', async () => {
    const { cli, asked } = restartableStage()
    writeFileSync(join(cli.dataDir, 'last-bind.json'), 'this is not json')

    const result = await cli.run(['up', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(asked.map((address) => address.bind)).toEqual([DEFAULT_BIND])
  })

  test('reads back what it wrote, and nothing else', () => {
    const cli = createCli()
    const lastBindFile = join(cli.dataDir, 'last-bind.json')
    expect(readLastBind(lastBindFile)).toBeUndefined()

    rememberBind(lastBindFile, '192.168.1.9')
    expect(readLastBind(lastBindFile)).toBe('192.168.1.9')

    for (const contents of ['this is not json', '{}', '{"bind":""}', '{"bind":42}']) {
      writeFileSync(lastBindFile, contents)
      expect(readLastBind(lastBindFile), contents).toBeUndefined()
    }
  })

  test('does not tell a bare up that the running server disagrees with it', async () => {
    // `up` was handed no address, so there is no disagreement to report — the
    // note used to name the loopback default the caller never asked for.
    const cli = createCli()
    writeLock(cli, { port: 24242, bind: '0.0.0.0' })

    const result = await cli.run(['up'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.stdout.join('\n')).not.toContain('needs a restart')
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
