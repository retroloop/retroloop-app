import { beforeEach, describe, expect, test } from 'bun:test'
import type { LaneRecordRow } from '#application/use-cases/records/list-lane-records.use-case'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import type { RecordLifecycleState } from '#domain/models/record-lifecycle.model'
import type { EffectiveClaim } from '#domain/services/record-claim.service'
import { LANE_STATES, type LaneState, laneState } from '#domain/services/record-lane.service'
import type { EffectiveLifecycle } from '#domain/services/record-lifecycle.service'
import type { EffectiveDecision } from '#domain/services/record-state.service'
import { aRecordInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'

/**
 * `laneState` — the one word the lane calls a record by, folded from the two
 * axes and the marker beside them (`record-lane.service.ts`).
 *
 * A table rather than a sequence of scenarios, because the whole risk in this
 * function is precedence: every input combination has exactly one right answer
 * and the wrong ones are all *plausible* — a claimed record that also happens to
 * be resolved reading `in-progress`, a declined record reading `archived` where
 * somebody really archived it, or the reverse.
 */
const aDecision = (state: DecisionState): EffectiveDecision => ({
  state,
  decidedOnRevision: state === 'pending' ? undefined : 1,
  carriedOver: false,
  contentChangedSince: undefined,
  severity: 3,
  solutionLevel: 2,
  selectedSolution: 2,
  involvement: 'pull-request',
  reviewerNote: undefined,
})

const aLifecycle = (status: RecordLifecycleState, actor?: Actor): EffectiveLifecycle => ({
  status,
  refs: status === 'resolved' ? ['a1b2c3d'] : [],
  note: undefined,
  actor,
  at: actor === undefined ? undefined : '2026-09-13T10:00:00.000Z',
})

const aClaim: EffectiveClaim = { claimedAt: '2026-09-13T11:00:00.000Z', actor: 'ai' }

type Row = {
  readonly why: string
  readonly decision: DecisionState
  readonly lifecycle: EffectiveLifecycle
  readonly claim: EffectiveClaim | undefined
  readonly expected: LaneState
}

const TABLE: readonly Row[] = [
  {
    why: 'a record nobody has decided is still pending',
    decision: 'pending',
    lifecycle: aLifecycle('open'),
    claim: undefined,
    expected: 'pending',
  },
  {
    why: 'an approved, untouched record is the lane’s ordinary row',
    decision: 'approved',
    lifecycle: aLifecycle('open'),
    claim: undefined,
    expected: 'approved',
  },
  {
    why: 'the verdict shows through wherever nothing else has happened',
    decision: 'revise',
    lifecycle: aLifecycle('open'),
    claim: undefined,
    expected: 'revise',
  },
  {
    why: 'a pre-split hold verdict is still a word a store can hold',
    decision: 'hold',
    lifecycle: aLifecycle('open'),
    claim: undefined,
    expected: 'hold',
  },
  {
    why: 'somebody is working on it',
    decision: 'approved',
    lifecycle: aLifecycle('open'),
    claim: aClaim,
    expected: 'in-progress',
  },
  {
    why: 'resolved beats the claim — the work the claim was about is done',
    decision: 'approved',
    lifecycle: aLifecycle('resolved', 'ai'),
    claim: aClaim,
    expected: 'resolved',
  },
  {
    why: 'resolved beats the verdict too: a declined record can still be closed out',
    decision: 'declined',
    lifecycle: aLifecycle('resolved', 'human'),
    claim: undefined,
    expected: 'resolved',
  },
  {
    why: 'somebody archived it, and an act somebody took is what the lane says',
    decision: 'approved',
    lifecycle: aLifecycle('archived', 'human'),
    claim: undefined,
    expected: 'archived',
  },
  {
    why: 'archived by hand beats a claim that was never given back',
    decision: 'approved',
    lifecycle: aLifecycle('archived', 'human'),
    claim: aClaim,
    expected: 'archived',
  },
  {
    /**
     * **The one derivation this function exists to get right.** A declined
     * record is `archived` from birth with no row saying so (`lifecycle.md`), so
     * reading the lifecycle alone would call every declined record "archived" and
     * the lane would lose the only word that says *why* it is out of the way.
     */
    why: 'born archived: a declined record reads as declined, not as archived',
    decision: 'declined',
    lifecycle: aLifecycle('archived'),
    claim: undefined,
    expected: 'declined',
  },
  {
    why: 'and a claim does not change that — nobody archived it, and nobody decided otherwise',
    decision: 'declined',
    lifecycle: aLifecycle('archived'),
    claim: aClaim,
    expected: 'declined',
  },
]

describe('the lane state of a record', () => {
  for (const row of TABLE) {
    test(row.why, () => {
      expect(laneState(aDecision(row.decision), row.lifecycle, row.claim)).toBe(row.expected)
    })
  }

  /**
   * Every verdict is a lane state, which is what lets the CLI offer one `--state`
   * vocabulary instead of two that can drift. If a verdict is ever added without
   * a place in the lane, this is what says so.
   */
  test('every verdict a record can carry is a word the lane can say', () => {
    const verdicts: readonly DecisionState[] = ['pending', 'approved', 'declined', 'revise', 'hold']
    for (const verdict of verdicts) {
      expect(LANE_STATES).toContain(verdict)
      expect(laneState(aDecision(verdict), aLifecycle('open'), undefined)).toBe(verdict)
    }
  })

  test('the vocabulary is the five verdicts and the three the lane adds', () => {
    expect([...LANE_STATES]).toEqual([
      'pending',
      'approved',
      'declined',
      'revise',
      'hold',
      'in-progress',
      'resolved',
      'archived',
    ])
  })
})

/**
 * `ListLaneRecordsUseCase` — the one read model behind `record queue`,
 * `record list --all`, `record get` and `record relations`.
 *
 * The fixture is deliberately awkward — **two sessions, three retrospectives,
 * every lane state, both record shapes, a review still open and a relation
 * across two of them** — because almost every bug this listing can have is a bug
 * a one-session, one-retro, one-shape fixture answers correctly by accident.
 */
describe('the lane', () => {
  let harness: Harness

  /** The first retrospective of session alpha: one approved record and one declined. */
  let past: number
  /** The second: one record resolved, one claimed, one archived by hand. */
  let recent: number
  /** Session beta's, still under review — its approved record is not lane work. */
  let open: number

  let ids: Map<string, number>
  /** The two sessions' ids — minted by the store, not assumed to be 1 and 2. */
  let alphaId: number
  let betaId: number

  const idOf = (rid: string): number => ids.get(rid) ?? 0

  const lane = async (
    input: {
      readonly scope?: 'queue' | 'all'
      readonly recordId?: number
      readonly state?: LaneState
      readonly text?: string
    } = {},
  ): Promise<readonly LaneRecordRow[]> =>
    (
      await harness.app.records.lane.execute({
        actor: 'ai',
        scope: input.scope ?? 'all',
        recordId: input.recordId,
        state: input.state,
        text: input.text,
      })
    ).records

  const queue = async () => (await lane({ scope: 'queue' })).map((row) => row.rid)

  beforeEach(async () => {
    harness = createHarness()
    ids = new Map<string, number>()

    const alpha = await harness.session('uuid-alpha')
    const beta = await harness.session('uuid-beta')
    alphaId = alpha.id
    betaId = beta.id

    past = (
      await harness.revision(alpha.id, [
        { rid: 'r-stale-lock', title: 'Deploy blocked on a stale lock file' },
        { rid: 'r-noisy-hook', title: 'The hook shouts on every commit' },
      ])
    ).retroId
    // The human's own words on the record, and the AI answering them in the same
    // thread — both before the finish, because a finished review takes no
    // comments.
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: past },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'This cost me the whole afternoon.',
    })
    await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId: past },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'Noted — I will check the liveness path.',
    })
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: past },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'solutions' },
      text: 'Do the PID one.',
    })
    // A review-level remark, which belongs to no record and must not reach one.
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: past },
      target: { kind: 'review' },
      text: 'Good round.',
    })
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId: past },
      rid: 'r-stale-lock',
      decision: { state: 'approved', selectedSolution: 2, reviewerNote: 'Start with this one.' },
    })
    await harness.decide(past, 'r-noisy-hook', 'declined')
    await harness.closeReview(past)

    recent = (
      await harness.revision(alpha.id, [
        { rid: 'r-silent-tailer', title: 'The tailer stops without saying so' },
        { rid: 'r-flaky-test', title: 'One test fails once a week' },
        { rid: 'r-wide-export', title: 'The export carries a column nothing reads' },
      ])
    ).retroId
    // Approved without a word said about any of them, which is the ordinary
    // round: the fixture's interesting record is in `past`.
    await harness.finishRound(recent)
    await harness.app.review.close.execute({ actor: 'ai', retro: { retroId: recent } })

    open = (
      await harness.revision(beta.id, [
        { rid: 'r-late-badge', title: 'The badge arrives a beat late' },
      ])
    ).retroId
    await harness.decide(open, 'r-late-badge', 'approved')

    for (const [retroId, rid] of [
      [past, 'r-stale-lock'],
      [past, 'r-noisy-hook'],
      [recent, 'r-silent-tailer'],
      [recent, 'r-flaky-test'],
      [recent, 'r-wide-export'],
      [open, 'r-late-badge'],
    ] as const) {
      ids.set(rid, (await harness.store.recordIds.findByRecord(retroId, rid))?.id ?? 0)
    }

    // One of `recent`'s records is done, one is being worked on, and one the
    // human put out of the way — so every lane state has a row.
    await harness.app.records.setLifecycle.execute({
      actor: 'ai',
      retro: { retroId: recent },
      rid: 'r-silent-tailer',
      status: 'resolved',
      refs: ['a1b2c3d'],
    })
    await harness.app.records.claim.execute({
      actor: 'ai',
      id: idOf('r-flaky-test'),
      claimed: true,
    })
    await harness.app.records.setLifecycle.execute({
      actor: 'human',
      retro: { retroId: recent },
      rid: 'r-wide-export',
      status: 'archived',
    })
  })

  describe('the queue', () => {
    /**
     * **The queue's whole definition, in one assertion.** Approved, unresolved,
     * not archived, in a retrospective the human finished — and a record
     * somebody is already holding stays on it, because whoever is working the
     * queue needs to see what is in progress rather than being told it does not
     * exist.
     */
    test('is the approved, unresolved work of finished retrospectives, claims included', async () => {
      expect(await queue()).toEqual(['r-stale-lock', 'r-flaky-test'])
    })

    test('leaves out the approved records of a review the human has not finished', async () => {
      expect(await queue()).not.toContain('r-late-badge')

      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId: open } })

      expect(await queue()).toContain('r-late-badge')
    })

    test('says who is holding the one that is in progress, and since when', async () => {
      const held = (await lane({ scope: 'queue' })).find((row) => row.rid === 'r-flaky-test')

      expect(held?.claim).toEqual({ claimedAt: harness.clock.iso(), actor: 'ai' })
      expect(held?.laneState).toBe('in-progress')
    })

    /** Releasing it changes the word and leaves the record on the queue. */
    test('drops the marker when the record is given back', async () => {
      await harness.app.records.claim.execute({
        actor: 'ai',
        id: idOf('r-flaky-test'),
        claimed: false,
      })

      const row = (await lane({ scope: 'queue' })).find((one) => one.rid === 'r-flaky-test')
      expect(row?.claim).toBeUndefined()
      expect(row?.laneState).toBe('approved')
    })

    test('drops a record the moment it is resolved', async () => {
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId: past },
        rid: 'r-stale-lock',
        status: 'resolved',
        refs: ['abc1234'],
      })

      expect(await queue()).toEqual(['r-flaky-test'])
    })
  })

  describe('everything, in order', () => {
    /**
     * Retrospective id ascending then `num` ascending — oldest work first, in
     * the order the reviewer read it. The records page reads newest first and
     * this does not: a queue is worked from the front.
     */
    test('is oldest retrospective first, records in the order the human reviewed them', async () => {
      expect((await lane()).map((row) => [row.retroId, row.num, row.rid])).toEqual([
        [past, 1, 'r-stale-lock'],
        [past, 2, 'r-noisy-hook'],
        [recent, 1, 'r-silent-tailer'],
        [recent, 2, 'r-flaky-test'],
        [recent, 3, 'r-wide-export'],
        [open, 1, 'r-late-badge'],
      ])
    })

    /** "Retro #n" is a position within a session and is stored nowhere. */
    test('numbers each retrospective within its own session', async () => {
      expect(
        (await lane()).map((row) => [row.retroNumber, row.claudeSession, row.sessionId]),
      ).toEqual([
        [1, 'uuid-alpha', alphaId],
        [1, 'uuid-alpha', alphaId],
        [2, 'uuid-alpha', alphaId],
        [2, 'uuid-alpha', alphaId],
        [2, 'uuid-alpha', alphaId],
        [1, 'uuid-beta', betaId],
      ])
    })

    test('says whether the review is finished, when, and whether it closed', async () => {
      const rows = await lane()

      expect(rows[0]?.review).toEqual({
        finished: true,
        finishedAt: harness.clock.iso(),
        closed: true,
      })
      expect(rows[5]?.review).toEqual({
        finished: false,
        finishedAt: undefined,
        closed: false,
      })
    })

    test('carries every lane state a record in this store is in', async () => {
      expect((await lane()).map((row) => [row.rid, row.laneState])).toEqual([
        ['r-stale-lock', 'approved'],
        ['r-noisy-hook', 'declined'],
        ['r-silent-tailer', 'resolved'],
        ['r-flaky-test', 'in-progress'],
        ['r-wide-export', 'archived'],
        ['r-late-badge', 'approved'],
      ])
    })
  })

  /**
   * **What the human said about the record, in one field** — the reviewer's note
   * first, then their comments. It is the reason an agent can act on a queue row
   * without opening the review page.
   */
  describe('the reviewer’s words', () => {
    test('are the reviewer note first, then their comments, oldest first', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-stale-lock')

      expect(row?.ownerWords).toEqual([
        'Start with this one.',
        'This cost me the whole afternoon.',
        'Do the PID one.',
      ])
    })

    test('never include the AI’s own replies, nor a review-level remark', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-stale-lock')

      expect(row?.ownerWords).not.toContain('Noted — I will check the liveness path.')
      expect(row?.ownerWords).not.toContain('Good round.')
    })

    test('are empty on a record they said nothing about', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-flaky-test')

      expect(row?.ownerWords).toEqual([])
    })
  })

  describe('the fix a row carries', () => {
    test('is the solution the human picked, with its level and its files', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-stale-lock')

      expect(row?.selectedSolution).toEqual({
        index: 2,
        level: 2,
        title: 'Write the holder PID.',
        body: '- **Write the holder PID.** Check liveness before waiting on the lock.',
        footprint: ['scripts/deploy.sh', 'lib/lock.ts'],
      })
    })

    test('is the AI’s recommendation while nobody has picked one', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-late-badge')

      expect(row?.selectedSolution.index).toBe(2)
      expect(row?.selectedSolution.level).toBe(2)
    })

    /** Early retrospectives are full of these, and the lane reads them. */
    test('reads a record filed before solutions existed as solution 1', async () => {
      const session = await harness.session('uuid-legacy')
      const legacy = await harness.legacyRevision(session.id)

      const row = (await lane()).find((candidate) => candidate.retroId === legacy.retroId)
      expect(row?.selectedSolution.index).toBe(1)
      expect(row?.selectedSolution.body).toBe(legacy.record.agreedDirection)
    })
  })

  /**
   * **The evidence travels with the work.** An agent that picks a record off
   * the queue is about to go and reproduce the friction, and what the AI
   * already looked at is the difference between starting from the top and
   * starting from the logs. It is on the row rather than behind a second read
   * for the reason every wide field on this row is: the alternative is opening
   * twenty records to find out which one to take.
   */
  describe('the evidence a row carries', () => {
    test('is the diagnostic data the record was filed with', async () => {
      const row = (await lane()).find((candidate) => candidate.rid === 'r-stale-lock')

      expect(row?.diagnosticData).toBe(aRecordInput().diagnosticData)
    })

    test('is undefined on a record filed before the field existed', async () => {
      const session = await harness.session('uuid-legacy-evidence')
      const legacy = await harness.legacyRevision(session.id)

      const row = (await lane()).find((candidate) => candidate.retroId === legacy.retroId)
      expect(row?.diagnosticData).toBeUndefined()
    })
  })

  describe('narrowing it', () => {
    test('filters on the lane state, the three the lane adds included', async () => {
      expect((await lane({ state: 'in-progress' })).map((row) => row.rid)).toEqual(['r-flaky-test'])
      expect((await lane({ state: 'resolved' })).map((row) => row.rid)).toEqual(['r-silent-tailer'])
      expect((await lane({ state: 'archived' })).map((row) => row.rid)).toEqual(['r-wide-export'])
      expect((await lane({ state: 'declined' })).map((row) => row.rid)).toEqual(['r-noisy-hook'])
    })

    test('matches text on the title, the slug, the problem and every why', async () => {
      const matching = async (text: string) => (await lane({ text })).map((row) => row.rid)

      expect(await matching('stale lock file')).toEqual(['r-stale-lock'])
      expect(await matching('r-noisy')).toEqual(['r-noisy-hook'])
      // The fixture gives every record the same problem and root cause, so these
      // four match the whole store — which is the point: each is a different
      // field, and a search reading only the title would answer none of them.
      expect(await matching('waited 40 minutes')).toHaveLength(6)
      expect(await matching('outlived the process')).toHaveLength(6)
      expect(await matching('advisory with no liveness')).toHaveLength(6)
      expect(await matching('the process was killed')).toHaveLength(6)
    })

    test('matches whatever case it was written in', async () => {
      expect((await lane({ text: 'STALE LOCK FILE' })).map((row) => row.rid)).toEqual([
        'r-stale-lock',
      ])
    })

    test('is empty rather than everything when nothing matches', async () => {
      expect(await lane({ text: 'a phrase nobody wrote' })).toEqual([])
    })

    test('narrows to one record by its global number', async () => {
      const rows = await lane({ recordId: idOf('r-flaky-test') })

      expect(rows.map((row) => row.rid)).toEqual(['r-flaky-test'])
      expect(rows[0]?.recordId).toBe(idOf('r-flaky-test'))
    })

    test('is a NotFound for a number nothing was minted for', async () => {
      await expect(lane({ recordId: 404 })).rejects.toBeInstanceOf(NotFoundError)
    })

    /** Everything listable is claimable; a withdrawn record is neither. */
    test('is a NotFound for a record a later draft withdrew', async () => {
      const beta = await harness.store.retrospectives.findById(open)
      await harness.finishRound(open)
      await harness.revision(beta?.sessionId ?? 0, [{ rid: 'r-different', num: 2 }])

      await expect(lane({ recordId: idOf('r-late-badge') })).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  /** Both directions off one stored row — the read the relation feature exists for. */
  describe('relations on a row', () => {
    test('name the other record from either end', async () => {
      await harness.app.records.relate.execute({
        actor: 'ai',
        fromId: idOf('r-flaky-test'),
        toId: idOf('r-stale-lock'),
        related: true,
        how: 'the same lock',
      })

      const rows = await lane()
      expect(rows.find((row) => row.rid === 'r-flaky-test')?.relations).toEqual([
        {
          globalId: idOf('r-stale-lock'),
          retroId: past,
          rid: 'r-stale-lock',
          how: 'the same lock',
          direction: 'outgoing',
          actor: 'ai',
          at: harness.clock.iso(),
        },
      ])
      expect(rows.find((row) => row.rid === 'r-stale-lock')?.relations).toEqual([
        {
          globalId: idOf('r-flaky-test'),
          retroId: recent,
          rid: 'r-flaky-test',
          how: 'the same lock',
          direction: 'incoming',
          actor: 'ai',
          at: harness.clock.iso(),
        },
      ])
    })

    test('are empty on a record nobody related', async () => {
      expect((await lane()).every((row) => row.relations.length === 0)).toBe(true)
    })
  })
})
