import { beforeEach, describe, expect, test } from 'bun:test'
import type { WireEvent } from '#trpc/views.schema'
import { type ApiHarness, createApiHarness } from './support/harness'

/**
 * A subscription is an async generator: **its body does not run until something
 * pulls it.** Nothing is listening until the first `next()`, so a test that
 * mutates before iterating would be dispatching into an empty room and then
 * blocking forever. Everything below therefore starts consuming first and waits
 * on an observable fact rather than on a sleep.
 */
function startConsuming(iterator: AsyncIterable<unknown>): {
  readonly seen: WireEvent[]
  readonly failure: Promise<unknown>
} {
  const seen: WireEvent[] = []
  const failure = (async () => {
    for await (const item of iterator) {
      // `tracked(id, data)` reaches the caller as the tuple `[id, data, …]`.
      seen.push((item as [string, WireEvent])[1])
    }
  })()
  return { seen, failure }
}

async function waitUntil(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * Any write will do as a live event, and a verdict is the cheapest one that
 * needs no other state. `review.requestChanges` was this file's event source
 * until retro 4 `r-one-finish-button` removed the procedure.
 */
async function decideOn(api: ApiHarness, retroId: number): Promise<void> {
  await api.caller.decisions.record({ retroId, rid: 'r-record-1', revision: 1, state: 'approved' })
}

describe('events.onRetro', () => {
  let api: ApiHarness
  let sessionId: number
  let retroId: number
  /** The real ids, since the memory store shares one counter across tables. */
  let eventIds: number[]
  let eventNames: string[]

  beforeEach(async () => {
    api = createApiHarness()
    sessionId = await api.session()
    retroId = await api.revision(sessionId)

    const { events } = await api.app.events.list.execute({ actor: 'human' })
    eventIds = events.map((event) => event.id)
    eventNames = events.map((event) => event.name)
  })

  test('the fixture is the three events the rest of these tests reason about', () => {
    expect(eventNames).toEqual(['SessionCreated', 'RetrospectiveStarted', 'RevisionCreated'])
  })

  test('replays what a reconnecting page missed', async () => {
    // The page last saw SessionCreated; the two after it were missed.
    const subscription = await api.caller.events.onRetro({
      retroId,
      lastEventId: String(eventIds[0]),
    })
    const { seen } = startConsuming(subscription)

    await waitUntil(() => seen.length === 2, 'the replay')

    expect(seen.map((event) => event.name)).toEqual(['RetrospectiveStarted', 'RevisionCreated'])
    expect(seen[1]?.revisionN).toBe(1)
  })

  test('replays strictly after the given id — the off-by-one that matters', async () => {
    const subscription = await api.caller.events.onRetro({
      retroId,
      lastEventId: String(eventIds[1]),
    })
    const { seen } = startConsuming(subscription)

    await waitUntil(() => seen.length === 1, 'the replay')

    // The event whose id was handed in must not come back.
    expect(seen.map((event) => event.id)).toEqual([eventIds[2] as number])
  })

  test('starts from now when the page has no last id', async () => {
    const subscription = await api.caller.events.onRetro({ retroId, lastEventId: null })
    const { seen } = startConsuming(subscription)
    await waitUntil(() => api.tailer.listenerCount === 1, 'the subscription to attach')

    await decideOn(api, retroId)
    await api.tailer.poll()

    await waitUntil(() => seen.length === 1, 'the live event')
    // Nothing replayed: the page already has that state from its queries.
    expect(seen.map((event) => event.name)).toEqual(['DecisionRecorded'])
  })

  test('yields live events after the replay, without repeating any', async () => {
    const subscription = await api.caller.events.onRetro({
      retroId,
      lastEventId: String(eventIds[0]),
    })
    const { seen } = startConsuming(subscription)
    await waitUntil(() => seen.length === 2, 'the replay')

    await decideOn(api, retroId)
    await api.tailer.poll()

    await waitUntil(() => seen.length === 3, 'the live event')
    expect(seen.map((event) => event.name)).toEqual([
      'RetrospectiveStarted',
      'RevisionCreated',
      'DecisionRecorded',
    ])
    expect(new Set(seen.map((event) => event.id)).size).toBe(3)
  })

  test('does not leak another session’s retrospective', async () => {
    const otherSession = await api.session('uuid-other')
    const otherRetro = await api.revision(otherSession)

    const subscription = await api.caller.events.onRetro({
      retroId,
      lastEventId: String(eventIds[0]),
    })
    const { seen } = startConsuming(subscription)
    await waitUntil(() => seen.length === 2, 'the replay')

    // Noise on the other review, then something on ours.
    await decideOn(api, otherRetro)
    await decideOn(api, retroId)
    await api.tailer.poll()

    await waitUntil(() => seen.length === 3, 'our live event')
    expect(seen).toHaveLength(3)
    expect(seen[2]?.name).toBe('DecisionRecorded')
    expect(seen.every((event) => event.retroId === retroId)).toBe(true)
  })

  test('carries the session’s own events too, not only the retrospective’s', async () => {
    const subscription = await api.caller.events.onRetro({ retroId, lastEventId: '0' })
    const { seen } = startConsuming(subscription)

    await waitUntil(() => seen.length === 3, 'the full replay')

    // SessionCreated has a session but no retro; the page still wants it.
    expect(seen[0]?.name).toBe('SessionCreated')
    expect(seen[0]?.retroId).toBeNull()
  })

  test('detaches from the tailer when the subscriber stops reading', async () => {
    // How a real subscription ends: the consumer stops pulling — because the
    // browser closed the stream — and the generator's `finally` releases the
    // listener. Leaking one would mean the tailer feeding a queue nobody drains,
    // for the life of the process.
    const subscription = await api.caller.events.onRetro({
      retroId,
      lastEventId: String(eventIds[0]),
    })

    let seen = 0
    for await (const _event of subscription) {
      seen += 1
      if (seen === 2) break
    }

    expect(seen).toBe(2)
    expect(api.tailer.listenerCount).toBe(0)
  })

  /**
   * **The records page's live updates** (session 8). A lifecycle write is
   * scoped to its retrospective like any other, so it reaches a page watching
   * that retro through the machinery already here — which is what lets the flat
   * records list invalidate itself when the AI resolves something in another
   * process while the human is reading.
   *
   * Both names, because the invalidation map keys off `name` and a map that
   * knew only the resolve would leave a reopened record showing as resolved
   * until the next navigation.
   */
  test('carries a record’s lifecycle acts, under a name each', async () => {
    const subscription = await api.caller.events.onRetro({ retroId, lastEventId: null })
    const { seen } = startConsuming(subscription)
    await waitUntil(() => api.tailer.listenerCount === 1, 'the subscription to attach')

    await api.caller.records.setLifecycle({
      retroId,
      rid: 'r-record-1',
      status: 'resolved',
      refs: ['a1b2c3d'],
    })
    await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'reopened' })
    await api.tailer.poll()

    await waitUntil(() => seen.length === 2, 'the lifecycle events')
    expect(seen.map((event) => [event.name, event.rid])).toEqual([
      ['RecordResolved', 'r-record-1'],
      ['RecordReopened', 'r-record-1'],
    ])
    // No revision on either: a record's lifecycle outlives every redraft of it.
    expect(seen.every((event) => event.revisionN === null)).toBe(true)
  })

  test('is an error for a retrospective that does not exist', async () => {
    const subscription = await api.caller.events.onRetro({ retroId: 404 })
    const { failure } = startConsuming(subscription)

    await expect(failure).rejects.toThrow()
  })
})
