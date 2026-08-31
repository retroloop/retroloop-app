import { describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'

/**
 * The repository contract suites (testing.md suite 1).
 *
 * Each suite is a function so **the same tests run against every adapter**: the
 * memory store here, `bun:sqlite` in BACKLOG item 3. Types alone cannot say "a
 * miss returns `undefined`" or "a failed unit of work leaves nothing behind" —
 * these do, once, for every implementation.
 */
export type StoreFactory = () => Promise<Store>

/**
 * Parent rows the child suites need.
 *
 * The SQLite store enforces `PRAGMA foreign_keys`, so a revision must belong to a
 * retrospective that exists and an annotation to a note that exists — exactly as
 * the domain already guarantees. The fixtures create their parents rather than
 * assuming id 1 is there, which keeps one set of suites honest against both
 * adapters instead of writing down whatever the weaker one tolerates.
 */
export async function seedSession(store: Store, claudeSession = 'uuid-parent'): Promise<number> {
  const session = await store.sessions.add({
    claudeSession,
    project: 'retro',
    cwd: '/Users/haider/Developer/retro',
    branch: 'main',
    supervised: true,
    startedAt: '2026-08-23T09:00:00.000Z',
  })
  return session.id
}

export async function seedRetrospective(store: Store, sessionId: number): Promise<number> {
  const retro = await store.retrospectives.add({
    sessionId,
    state: 'reviewing',
    startedAt: '2026-08-23T09:00:00.000Z',
    finishedAt: undefined,
  })
  return retro.id
}

export async function seedNote(
  store: Store,
  sessionId: number,
  text = 'a friction',
): Promise<number> {
  const note = await store.notes.add({
    sessionId,
    author: 'ai',
    kind: 'human-cost',
    text,
    at: '2026-08-23T09:10:00.000Z',
  })
  return note.id
}

export function describeStoreContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · Store`, () => {
    test('commits every write of a unit of work together', async () => {
      const store = await makeStore()
      await store.tx(async (repositories) => {
        const session = await repositories.sessions.add({
          claudeSession: 'uuid-1',
          project: 'retro',
          cwd: '/tmp',
          branch: 'main',
          supervised: true,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
        await repositories.events.append({
          name: 'SessionCreated',
          at: '2026-08-23T09:00:00.000Z',
          sessionId: session.id,
          retroId: undefined,
          revisionN: undefined,
          rid: undefined,
          data: {},
        })
      })

      expect(await store.sessions.findByClaudeSession('uuid-1')).toBeDefined()
      expect(await store.events.list()).toHaveLength(1)
      await store.close()
    })

    test('rolls the whole unit of work back when the work throws — event included', async () => {
      const store = await makeStore()
      const failure = store.tx(async (repositories) => {
        const session = await repositories.sessions.add({
          claudeSession: 'uuid-2',
          project: 'retro',
          cwd: '/tmp',
          branch: undefined,
          supervised: false,
          startedAt: '2026-08-23T09:00:00.000Z',
        })
        await repositories.events.append({
          name: 'SessionCreated',
          at: '2026-08-23T09:00:00.000Z',
          sessionId: session.id,
          retroId: undefined,
          revisionN: undefined,
          rid: undefined,
          data: {},
        })
        throw new Error('use case failed after writing')
      })

      await expect(failure).rejects.toThrow('use case failed after writing')
      expect(await store.sessions.findByClaudeSession('uuid-2')).toBeUndefined()
      expect(await store.events.list()).toHaveLength(0)
      await store.close()
    })

    test('serializes units of work that overlap in time', async () => {
      const store = await makeStore()
      const write = (claudeSession: string) =>
        store.tx(async (repositories) => {
          const before = (await repositories.sessions.list()).length
          await repositories.sessions.add({
            claudeSession,
            project: 'retro',
            cwd: '/tmp',
            branch: undefined,
            supervised: false,
            startedAt: '2026-08-23T09:00:00.000Z',
          })
          return before
        })

      const [first, second] = await Promise.all([write('uuid-a'), write('uuid-b')])

      // Neither unit of work observed the other half-done: they ran one after the other.
      expect([first, second].sort()).toEqual([0, 1])
      expect(await store.sessions.list()).toHaveLength(2)
      await store.close()
    })

    test('closing twice is safe', async () => {
      const store = await makeStore()
      await store.close()
      await store.close()
    })
  })
}
