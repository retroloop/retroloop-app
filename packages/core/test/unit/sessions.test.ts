import { beforeEach, describe, expect, test } from 'bun:test'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { createHarness, type Harness } from '../support/harness'

describe('sessions', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  describe('create', () => {
    test('registers a session and announces it', async () => {
      const { session, created } = await harness.app.sessions.create.execute({
        actor: 'ai',
        claudeSession: 'uuid-1',
        project: 'retro',
        cwd: '/Users/haider/Developer/retro',
        branch: 'main',
        supervised: true,
      })

      expect(created).toBe(true)
      expect(session.id).toBeGreaterThan(0)
      expect(session.project).toBe('retro')
      expect(session.supervised).toBe(true)
      expect(session.startedAt).toBe(harness.clock.iso())
      expect(await harness.eventNames()).toEqual(['SessionCreated'])
    })

    test('defaults an unattended session to not supervised', async () => {
      const { session } = await harness.app.sessions.create.execute({
        actor: 'ai',
        claudeSession: 'uuid-1',
        project: 'retro',
        cwd: '/tmp',
      })

      expect(session.supervised).toBe(false)
      expect(session.branch).toBeUndefined()
    })

    /**
     * KC-0020 took the project construct off the critical path: one project
     * routinely holds several software packages, so it was the wrong unit. The
     * registration still has to succeed and still has to announce itself — the
     * session's identity is its uuid and its cwd, and neither of those moved.
     */
    test('registers a session that names no project at all', async () => {
      const { session, created } = await harness.app.sessions.create.execute({
        actor: 'ai',
        claudeSession: 'uuid-1',
        cwd: '/Users/haider/Developer/retro',
      })

      expect(created).toBe(true)
      expect(session.project).toBeUndefined()
      expect(session.cwd).toBe('/Users/haider/Developer/retro')
      expect(await harness.eventNames()).toEqual(['SessionCreated'])
    })

    test('is idempotent by the Claude session uuid, and says so', async () => {
      const first = await harness.session('uuid-1')
      harness.clock.advance(60_000)

      const again = await harness.app.sessions.create.execute({
        actor: 'ai',
        claudeSession: 'uuid-1',
        project: 'a different project',
        cwd: '/elsewhere',
      })

      expect(again.created).toBe(false)
      expect(again.session).toEqual(first)
      // Identity is write-once: the second call rewrote nothing and announced nothing.
      expect(again.session.project).toBe('retro')
      expect(await harness.eventNames()).toEqual(['SessionCreated'])
    })

    test('rejects a registration missing its identifying fields', async () => {
      await expect(
        harness.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: '',
          project: 'retro',
          cwd: '/tmp',
        }),
      ).rejects.toBeInstanceOf(ValidationError)

      await expect(
        harness.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: 'uuid-1',
          project: '  ',
          cwd: '/tmp',
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  describe('get', () => {
    test('reports the derived status, the retrospectives and the notes summary', async () => {
      const session = await harness.session()
      await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'a friction',
      })
      await harness.app.notes.addHuman.execute({
        actor: 'human',
        session: session.id,
        text: 'my own note',
      })

      const before = await harness.app.sessions.get.execute({ actor: 'ai', session: session.id })
      expect(before.status).toBe('active')
      expect(before.retrospectives).toEqual([])
      expect(before.notes).toEqual({ ai: 1, human: 1 })

      await harness.revision(session.id)
      const during = await harness.app.sessions.get.execute({ actor: 'ai', session: session.id })
      expect(during.status).toBe('reviewing')
      expect(during.retrospectives).toHaveLength(1)
    })

    test('accepts the Claude session uuid as an address', async () => {
      const session = await harness.session('uuid-abc')

      const found = await harness.app.sessions.get.execute({ actor: 'ai', session: 'uuid-abc' })

      expect(found.session).toEqual(session)
    })

    test('reports a finished session once every retrospective is finished', async () => {
      const session = await harness.session()
      const { retroId, revision } = await harness.revision(session.id)
      const rid = revision.records[0]?.rid ?? ''
      await harness.decide(retroId, rid, 'approved')
      await harness.closeReview(retroId)

      expect(
        (await harness.app.sessions.get.execute({ actor: 'ai', session: session.id })).status,
      ).toBe('finished')
    })

    test('is a NotFound for a session that was never registered', async () => {
      await expect(
        harness.app.sessions.get.execute({ actor: 'ai', session: 404 }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.sessions.get.execute({ actor: 'ai', session: 'no-such-uuid' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('list', () => {
    test('lists newest first with each session’s derived status', async () => {
      await harness.session('uuid-1')
      const second = await harness.session('uuid-2')

      const { sessions } = await harness.app.sessions.list.execute({ actor: 'ai' })

      expect(sessions.map((view) => view.session.claudeSession)).toEqual(['uuid-2', 'uuid-1'])
      expect(sessions[0]?.session.id).toBe(second.id)
      expect(sessions[0]?.status).toBe('active')
    })

    test('filters by project and by derived status, and limits after filtering', async () => {
      const first = await harness.session('uuid-1')
      await harness.session('uuid-2')
      await harness.revision(first.id)

      expect(
        (
          await harness.app.sessions.list.execute({ actor: 'ai', status: 'reviewing' })
        ).sessions.map((view) => view.session.id),
      ).toEqual([first.id])
      expect(
        (await harness.app.sessions.list.execute({ actor: 'ai', status: 'active', limit: 1 }))
          .sessions,
      ).toHaveLength(1)
      expect(
        (await harness.app.sessions.list.execute({ actor: 'ai', project: 'nothing-here' }))
          .sessions,
      ).toEqual([])
    })
  })
})
