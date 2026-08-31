import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { pendingMigrations } from '#infrastructure/sqlite/migrator'
import { DATABASE_FILENAME, openSqliteStore } from '#infrastructure/sqlite/sqlite-store.adapter'
import { createFakeClock } from '../support/fake-clock'
import { createTempStage, openTempStore, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const aSession = (claudeSession: string) => ({
  claudeSession,
  project: 'retro',
  cwd: '/tmp',
  branch: 'main',
  supervised: true,
  startedAt: '2026-08-23T09:00:00.000Z',
})

describe('sqlite store', () => {
  test('lays the stage out the way the product does', async () => {
    const dir = createTempStage()

    const store = openSqliteStore({ dataDir: dir, clock: createFakeClock() })

    expect(store.file).toBe(join(dir, DATABASE_FILENAME))
    expect(existsSync(store.file)).toBe(true)
    await store.close()
  })

  test('creates the stage directory if it is not there yet', async () => {
    const dir = join(createTempStage(), 'nested', 'stage')

    const store = openSqliteStore({ dataDir: dir, clock: createFakeClock() })

    expect(existsSync(join(dir, DATABASE_FILENAME))).toBe(true)
    await store.close()
  })

  test('runs in WAL, so a reader never blocks the writer', async () => {
    const store = openTempStore()

    const raw = new Database(store.file)
    expect(raw.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode).toBe(
      'wal',
    )
    raw.close()
    await store.close()
  })

  test('migrates on open', async () => {
    const store = openTempStore()

    const raw = new Database(store.file)
    expect(pendingMigrations(raw)).toEqual([])
    raw.close()
    await store.close()
  })

  test('hands back an unmigrated database when asked not to migrate', async () => {
    const store = openSqliteStore({
      dataDir: createTempStage(),
      clock: createFakeClock(),
      migrate: false,
    })

    const raw = new Database(store.file)
    expect(pendingMigrations(raw)).toHaveLength(MIGRATIONS.length)
    raw.close()
    await store.close()
  })

  test('persists across opens — the ledger is a file, not a process', async () => {
    const dir = createTempStage()
    const first = openSqliteStore({ dataDir: dir, clock: createFakeClock() })
    await first.sessions.add(aSession('uuid-durable'))
    await first.close()

    const second = openSqliteStore({ dataDir: dir, clock: createFakeClock() })

    expect(await second.sessions.findByClaudeSession('uuid-durable')).toBeDefined()
    await second.close()
  })

  test('two connections on one stage both read and write', async () => {
    const dir = createTempStage()
    const server = openSqliteStore({ dataDir: dir, clock: createFakeClock() })
    const cli = openSqliteStore({ dataDir: dir, clock: createFakeClock() })

    await cli.sessions.add(aSession('uuid-from-cli'))

    // The server never talks to the CLI; the database is the only thing between them.
    expect(await server.sessions.findByClaudeSession('uuid-from-cli')).toBeDefined()
    await Promise.all([server.close(), cli.close()])
  })

  describe('dataVersion', () => {
    test('does not move for this connection’s own writes', async () => {
      const store = openTempStore()
      const before = store.dataVersion()

      await store.sessions.add(aSession('uuid-mine'))

      expect(store.dataVersion()).toBe(before)
      await store.close()
    })

    test('moves when another connection commits — the tailer’s whole signal', async () => {
      const dir = createTempStage()
      const server = openSqliteStore({ dataDir: dir, clock: createFakeClock() })
      const cli = openSqliteStore({ dataDir: dir, clock: createFakeClock() })
      const before = server.dataVersion()

      await cli.sessions.add(aSession('uuid-from-cli'))

      expect(server.dataVersion()).not.toBe(before)
      await Promise.all([server.close(), cli.close()])
    })
  })

  describe('unit of work', () => {
    test('rolls back a failed unit of work, event included', async () => {
      const store = openTempStore()

      const failure = store.tx(async (repositories) => {
        const session = await repositories.sessions.add(aSession('uuid-doomed'))
        await repositories.events.append({
          name: 'SessionCreated',
          at: '2026-08-23T09:00:00.000Z',
          sessionId: session.id,
          retroId: undefined,
          revisionN: undefined,
          rid: undefined,
          data: {},
        })
        throw new Error('the use case failed')
      })

      await expect(failure).rejects.toThrow('the use case failed')
      expect(await store.sessions.findByClaudeSession('uuid-doomed')).toBeUndefined()
      expect(await store.events.list()).toEqual([])
      await store.close()
    })

    test('a nested call joins the transaction already in progress', async () => {
      const store = openTempStore()

      // A re-entrant tx must not open a second BEGIN on the same connection.
      const failure = store.tx(async (repositories) => {
        await repositories.sessions.add(aSession('uuid-outer'))
        await store.tx(async (inner) => {
          await inner.sessions.add(aSession('uuid-inner'))
        })
        throw new Error('roll both back')
      })

      await expect(failure).rejects.toThrow('roll both back')
      expect(await store.sessions.list()).toEqual([])
      await store.close()
    })

    test('closing twice is safe', async () => {
      const store = openTempStore()
      await store.close()
      await store.close()
    })
  })
})
