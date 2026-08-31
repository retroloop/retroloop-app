import { beforeEach, describe, expect, test } from 'bun:test'
import { NotFoundError } from '#domain/errors/not-found.error'
import { REVIEW_WAIT_EVENT_NAMES } from '#domain/events/domain-event.model'
import type { Session } from '#domain/models/session.model'
import { createHarness, type Harness } from '../support/harness'

describe('events', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
  })

  test('returns the outbox in order with the head to resume from', async () => {
    await harness.revision(session.id)

    const { events, latestId } = await harness.app.events.list.execute({ actor: 'ai' })

    expect(events.map((event) => event.name)).toEqual([
      'SessionCreated',
      'RetrospectiveStarted',
      'RevisionCreated',
    ])
    expect(latestId).toBe(events.at(-1)?.id ?? 0)
    expect(events[0]?.at).toBe(harness.clock.iso())
  })

  test('replays everything after a cursor', async () => {
    const { events: first } = await harness.app.events.list.execute({ actor: 'ai' })
    await harness.revision(session.id)

    const { events } = await harness.app.events.list.execute({
      actor: 'ai',
      afterId: first.at(-1)?.id,
    })

    expect(events.map((event) => event.name)).toEqual(['RetrospectiveStarted', 'RevisionCreated'])
  })

  test('filters to one retrospective and to the names a consumer waits on', async () => {
    const { retroId, revision } = await harness.revision(session.id)
    await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
    await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

    const waiting = await harness.app.events.list.execute({
      actor: 'ai',
      retro: { retroId },
      names: REVIEW_WAIT_EVENT_NAMES,
    })

    expect(waiting.events.map((event) => event.name)).toEqual(['ReviewFinished'])
    // What `review wait` prints: kind, retro, revision, when.
    expect(waiting.events[0]).toMatchObject({
      name: 'ReviewFinished',
      retroId,
      revisionN: 1,
      at: harness.clock.iso(),
    })
  })

  test('advances the cursor past events the consumer filtered out', async () => {
    const { retroId, revision } = await harness.revision(session.id)
    await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
    await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
    await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId },
      target: { kind: 'record', rid: revision.records[0]?.rid ?? '', section: 'problem' },
      text: 'looking at it',
    })

    const waiting = await harness.app.events.list.execute({
      actor: 'ai',
      retro: { retroId },
      names: REVIEW_WAIT_EVENT_NAMES,
    })

    expect(waiting.events.map((event) => event.name)).toEqual(['ReviewFinished'])
    // A poller that stored `latestId` will not re-read the comment event it skipped.
    expect(waiting.latestId).toBeGreaterThan(waiting.events[0]?.id ?? 0)
  })

  test('honours a limit', async () => {
    await harness.revision(session.id)

    expect((await harness.app.events.list.execute({ actor: 'ai', limit: 2 })).events).toHaveLength(
      2,
    )
  })

  test('is a NotFound for an unknown retrospective', async () => {
    await expect(
      harness.app.events.list.execute({ actor: 'ai', retro: { retroId: 404 } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
