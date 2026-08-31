import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type App,
  type Clock,
  createApp,
  type DomainEvent,
  openSqliteStore,
  type SqliteStore,
} from '@retro/core'
import { createTailer, TAILER_CURSOR } from '#events/tailer'

const stages: string[] = []
afterAll(() => {
  for (const dir of stages.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const clock: Clock = { now: () => new Date('2026-08-24T09:00:00.000Z') }

/** A real stage, plus a second handle for the tailer to watch through. */
function openStage(): { dataDir: string; writer: SqliteStore; watcher: SqliteStore; app: App } {
  const dataDir = mkdtempSync(join(tmpdir(), 'retro-tailer-'))
  stages.push(dataDir)
  const writer = openSqliteStore({ dataDir, clock })
  const watcher = openSqliteStore({ dataDir, migrate: false })
  return { dataDir, writer, watcher, app: createApp(writer, { clock }) }
}

async function aSessionEvent(app: App, claudeSession: string): Promise<void> {
  await app.sessions.create.execute({
    actor: 'ai',
    claudeSession,
    project: 'retro',
    cwd: '/tmp',
  })
}

/**
 * The tailer against a real database (realtime.md §The tailer).
 *
 * These use `poll()` rather than the timer: a test that waits for a 300 ms tick
 * is a test that flakes on a loaded machine, and the loop's body is what is
 * actually under test.
 */
describe('the tailer', () => {
  test('dispatches each event once, in order', async () => {
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock })
    const seen: DomainEvent[] = []
    tailer.listen((event) => seen.push(event))

    await aSessionEvent(app, 'uuid-1')
    await aSessionEvent(app, 'uuid-2')
    await tailer.poll()

    expect(seen.map((event) => event.name)).toEqual(['SessionCreated', 'SessionCreated'])
    expect(seen[0]?.id).toBeLessThan(seen[1]?.id ?? 0)

    // A second poll with nothing new dispatches nothing.
    await tailer.poll()
    expect(seen).toHaveLength(2)
  })

  test('does not re-emit earlier events when a later one arrives', async () => {
    // The cursor has to actually move. If it did not, the next poll would query
    // from the same position and hand every earlier event round again — and the
    // idle short-circuit would hide it until something new landed.
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock })
    const seen: DomainEvent[] = []
    tailer.listen((event) => seen.push(event))

    await aSessionEvent(app, 'uuid-1')
    await tailer.poll()
    await aSessionEvent(app, 'uuid-2')
    await tailer.poll()

    expect(seen).toHaveLength(2)
    expect(new Set(seen.map((event) => event.id)).size).toBe(2)
  })

  test('notices a write made through another connection', async () => {
    // The whole reason the tailer gets its own handle: `PRAGMA data_version`
    // does not move for a connection's own commits, so a tailer sharing the
    // writer's handle would be blind to exactly the writes the server makes.
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock })
    const seen: DomainEvent[] = []
    tailer.listen((event) => seen.push(event))

    await aSessionEvent(app, 'uuid-from-the-app')
    await tailer.poll()

    expect(seen).toHaveLength(1)
  })

  test('an idle tick costs a pragma and no query', async () => {
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock })

    await aSessionEvent(app, 'uuid-1')
    await tailer.poll()
    const afterWork = { ...tailer.stats }

    await tailer.poll()
    await tailer.poll()

    expect(tailer.stats.polls).toBe(afterWork.polls + 2)
    // `data_version` was unchanged, so the events table was never asked.
    expect(tailer.stats.queries).toBe(afterWork.queries)
    expect(tailer.stats.dispatched).toBe(afterWork.dispatched)
  })

  test('resumes from its cursor across a restart, without re-emitting', async () => {
    const { dataDir, app, watcher } = openStage()
    const first = createTailer(watcher, { clock })
    const seenByFirst: DomainEvent[] = []
    first.listen((event) => seenByFirst.push(event))

    await aSessionEvent(app, 'uuid-1')
    await first.poll()
    await first.stop()
    await watcher.close()

    expect(seenByFirst).toHaveLength(1)
    const persisted = await app.store.cursors.find(TAILER_CURSOR)
    expect(persisted?.position).toBe(seenByFirst[0]?.id)

    // A new process, a new tailer, the same stage.
    const restarted = openSqliteStore({ dataDir, migrate: false })
    const second = createTailer(restarted, { clock })
    const seenBySecond: DomainEvent[] = []
    second.listen((event) => seenBySecond.push(event))

    await second.poll()
    expect(seenBySecond).toEqual([])

    await aSessionEvent(app, 'uuid-2')
    await second.poll()

    // Only the new one: history is not replayed at every start.
    expect(seenBySecond.map((event) => event.data.project)).toEqual(['retro'])
    expect(seenBySecond).toHaveLength(1)
    expect(seenBySecond[0]?.id).toBeGreaterThan(seenByFirst[0]?.id ?? 0)
  })

  test('drops a listener that unsubscribes', async () => {
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock })
    const seen: DomainEvent[] = []
    const unsubscribe = tailer.listen((event) => seen.push(event))

    await aSessionEvent(app, 'uuid-1')
    await tailer.poll()
    unsubscribe()
    await aSessionEvent(app, 'uuid-2')
    await tailer.poll()

    expect(seen).toHaveLength(1)
    expect(tailer.listenerCount).toBe(0)
  })

  test('runs on its timer once started, and stops when told', async () => {
    const { app, watcher } = openStage()
    const tailer = createTailer(watcher, { clock, intervalMs: 5 })
    const seen: DomainEvent[] = []
    tailer.listen((event) => seen.push(event))

    tailer.start()
    await aSessionEvent(app, 'uuid-1')
    for (let attempt = 0; attempt < 200 && seen.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(seen).toHaveLength(1)

    await tailer.stop()
    const pollsAtStop = tailer.stats.polls
    await aSessionEvent(app, 'uuid-2')
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(tailer.stats.polls).toBe(pollsAtStop)
  })
})
