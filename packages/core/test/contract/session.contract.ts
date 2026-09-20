import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewSession } from '#domain/models/session.model'
import type { StoreFactory } from './store.contract'

function aNewSession(overrides: Partial<NewSession> = {}): NewSession {
  return {
    claudeSession: 'uuid-1',
    project: 'retro',
    cwd: '/Users/sample/Developer/retro',
    branch: 'main',
    supervised: true,
    startedAt: '2026-08-23T09:00:00.000Z',
    ...overrides,
  }
}

export function describeSessionRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · SessionRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    test('assigns an integer id and returns the stored session', async () => {
      const session = await store.sessions.add(aNewSession())

      expect(Number.isInteger(session.id)).toBe(true)
      expect(session.id).toBeGreaterThan(0)
      expect(session.project).toBe('retro')
      expect(await store.sessions.findById(session.id)).toEqual(session)
    })

    test('returns undefined for a miss — it never throws', async () => {
      expect(await store.sessions.findById(404)).toBeUndefined()
      expect(await store.sessions.findByClaudeSession('unknown')).toBeUndefined()
    })

    test('finds a session by its Claude session uuid — the idempotency key', async () => {
      const session = await store.sessions.add(aNewSession({ claudeSession: 'uuid-abc' }))

      expect(await store.sessions.findByClaudeSession('uuid-abc')).toEqual(session)
    })

    test('keeps an absent branch absent', async () => {
      const session = await store.sessions.add(aNewSession({ branch: undefined }))

      expect((await store.sessions.findById(session.id))?.branch).toBeUndefined()
    })

    /**
     * `project` is optional and dormant. Both stores have to hand back the
     * absence as `undefined` rather than as an empty string or a null that
     * leaked out of a column — the read path is where a nullable column usually
     * stops looking like the domain it is supposed to speak for.
     */
    test('stores a session that never named a project, and reads it back absent', async () => {
      const session = await store.sessions.add(aNewSession({ project: undefined }))

      expect(session.project).toBeUndefined()
      expect(await store.sessions.findById(session.id)).toEqual(session)
      expect((await store.sessions.findByClaudeSession('uuid-1'))?.project).toBeUndefined()
      expect((await store.sessions.list()).map((candidate) => candidate.project)).toEqual([
        undefined,
      ])
    })

    test('a project filter passes over the sessions that have none', async () => {
      await store.sessions.add(aNewSession({ claudeSession: 'uuid-1', project: undefined }))
      await store.sessions.add(aNewSession({ claudeSession: 'uuid-2', project: 'retro' }))

      expect((await store.sessions.list({ project: 'retro' })).map((s) => s.claudeSession)).toEqual(
        ['uuid-2'],
      )
      expect((await store.sessions.list()).map((s) => s.claudeSession)).toEqual([
        'uuid-2',
        'uuid-1',
      ])
    })

    test('lists newest first, filters by project and honours a limit', async () => {
      await store.sessions.add(aNewSession({ claudeSession: 'uuid-1', project: 'retro' }))
      await store.sessions.add(aNewSession({ claudeSession: 'uuid-2', project: 'other' }))
      const newest = await store.sessions.add(
        aNewSession({ claudeSession: 'uuid-3', project: 'retro' }),
      )

      expect((await store.sessions.list()).map((session) => session.claudeSession)).toEqual([
        'uuid-3',
        'uuid-2',
        'uuid-1',
      ])
      expect((await store.sessions.list({ project: 'retro' })).map((s) => s.claudeSession)).toEqual(
        ['uuid-3', 'uuid-1'],
      )
      expect(await store.sessions.list({ limit: 1 })).toEqual([newest])
    })

    test('hands out copies — mutating what was read changes nothing', async () => {
      const session = await store.sessions.add(aNewSession())
      const read = await store.sessions.findById(session.id)
      Object.assign(read as { project: string }, { project: 'tampered' })

      expect((await store.sessions.findById(session.id))?.project).toBe('retro')
    })
  })
}
