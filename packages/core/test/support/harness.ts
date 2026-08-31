import type { z } from 'zod'
import { type App, createApp } from '#application/app'
import type { Store } from '#application/ports/store.port'
import type { decisionVerdictSchema } from '#application/schemas/enums.schema'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import type { CreateRevisionOutput } from '#application/use-cases/revisions/create-revision.use-case'
import { type LegacyRecord, proposedLevel } from '#domain/models/record.model'
import type { Session } from '#domain/models/session.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { createMemoryStore } from '#infrastructure/memory/memory-store.adapter'
import { createFakeClock, type FakeClock } from './fake-clock'
import { aLegacyRecord, aRevisionInput } from './fixtures'

export type Harness = {
  readonly app: App
  readonly store: Store
  readonly clock: FakeClock
  /** Registers a session as the AI would. */
  session(claudeSession?: string): Promise<Session>
  /** Submits a revision for a session, defaulting to one well-formed record. */
  revision(
    sessionId: number,
    records?: readonly Partial<RecordInput>[],
  ): Promise<CreateRevisionOutput>
  /**
   * A retrospective holding one record in the shape written before solutions
   * existed — what the owner's store is full of.
   *
   * It goes **straight to the repository**, because that is the only way one can
   * exist: `CreateRevisionUseCase` takes the new shape and nothing else, which is
   * the write path being narrow. The repository takes the domain type, whose
   * legacy branch is exactly the JSON an earlier binary left in the blob.
   */
  legacyRevision(
    sessionId: number,
    record?: Partial<LegacyRecord>,
  ): Promise<{ retroId: number; record: LegacyRecord }>
  /**
   * Decides a record as the human would. The verdict enum is three values since
   * `r-hold-semantics`, and the verdict is the only axis a record has since
   * retro 4 `r-remove-hold` took the lifecycle flag out again.
   */
  decide(retroId: number, rid: string, state: z.infer<typeof decisionVerdictSchema>): Promise<void>
  /**
   * A stored `hold` verdict — the one state no write path can produce any more.
   *
   * `r-hold-semantics` narrowed the input enum in retro 3, and human data is
   * append-only, so a store written before that still carries rows in it and
   * every read path has to go on answering for one. The only way to build that
   * store in a test is the way it happened: straight into the repository, past
   * the schema that would refuse it today.
   */
  holdVerdict(retroId: number, rid: string): Promise<void>
  /**
   * The human's half of one round: decide whatever is still pending, then press
   * Finish.
   *
   * It exists because filing a second revision is no longer something the AI can
   * simply do (#113 `r-revision-sneaks-past-review`) — a round has to be finished
   * before the next one may replace it, which is the loop's own rhythm and is now
   * the write path's rule as well. A test that wants two revisions runs the
   * rhythm rather than pretending the gate is not there.
   *
   * Approves what is pending because the finish gate demands an answer on every
   * record and this helper is for tests whose subject is something else; a test
   * about verdicts decides them itself first, and this leaves those alone.
   */
  finishRound(retroId: number): Promise<void>
  /**
   * The end of the loop, both halves: the human finishes his side of the round
   * and the AI closes the review to export. It takes two acts since retro 4
   * `r-one-finish-button` — a finished retrospective is what `ReviewClosed`
   * makes, so a test that wants one runs both rather than pretending the
   * button still did it.
   */
  closeReview(retroId: number): Promise<void>
  /** Every event name in the outbox, in order. */
  eventNames(): Promise<readonly string[]>
}

/**
 * One store, one frozen clock, one App — the whole core wired the way a
 * composition root wires it, so the unit suite exercises the real use cases
 * rather than a stand-in for them.
 *
 * Pass a store to run the same use cases against a different L1 — which is how
 * the SQLite suite proves the application layer needs no adapter-specific code.
 */
export function createHarness(backing?: Store): Harness {
  const clock = createFakeClock()
  const store = backing ?? createMemoryStore()
  const app = createApp(store, { clock })

  return {
    app,
    store,
    clock,
    async session(claudeSession = 'uuid-session-1') {
      const { session } = await app.sessions.create.execute({
        actor: 'ai',
        claudeSession,
        project: 'retro',
        cwd: '/Users/haider/Developer/retro',
        branch: 'main',
        supervised: true,
      })
      return session
    },
    async revision(sessionId, records = [{}]) {
      return app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: aRevisionInput(records),
      })
    },
    async legacyRevision(sessionId, overrides = {}) {
      const record = aLegacyRecord(overrides)
      const at = clock.iso()
      const retro = await store.retrospectives.add({
        sessionId,
        state: 'reviewing',
        startedAt: at,
        finishedAt: undefined,
      })
      await store.revisions.add({
        retroId: retro.id,
        n: 1,
        createdAt: at,
        title: undefined,
        records: [record],
      })
      // The number too, because a store an older binary wrote is a store the
      // migration has since numbered (`20260830090000_create_record_ids.ts`).
      // This helper writes straight to the repositories, so it has to do both
      // halves of what the write path and the migration between them guarantee:
      // every record that exists has a global number.
      await store.recordIds.add({ retroId: retro.id, rid: record.rid })
      return { retroId: retro.id, record }
    },
    async decide(retroId, rid, state) {
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state },
      })
    },
    async holdVerdict(retroId, rid) {
      const revision = await store.revisions.findLatestByRetro(retroId)
      const record = revision?.records.find((candidate) => candidate.rid === rid)
      if (revision === undefined || record === undefined) {
        throw new Error(`no record ${rid} in the latest revision of retrospective ${retroId}`)
      }
      await store.decisions.add({
        retroId,
        rid,
        version: 1,
        state: 'hold',
        severity: record.defaults.severity,
        solutionLevel: proposedLevel(record),
        selectedSolution: undefined,
        involvement: record.defaults.involvement,
        reviewerNote: undefined,
        revisionN: revision.n,
        // The real hash, so the decision binds the way a real one does — a
        // mismatched one would read as `pending` through carry-over and the row
        // would prove nothing about `hold`.
        contentHash: hashRecordContent(record),
        decidedAt: clock.iso(),
      })
    },
    async finishRound(retroId) {
      const { records } = await app.records.list.execute({ actor: 'human', retro: { retroId } })
      for (const view of records) {
        if (view.decision.state !== 'pending') continue
        await app.decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: view.record.rid,
          decision: { state: 'approved' },
        })
      }
      await app.review.finish.execute({ actor: 'human', retro: { retroId } })
    },
    async closeReview(retroId) {
      await app.review.finish.execute({ actor: 'human', retro: { retroId } })
      await app.review.close.execute({ actor: 'ai', retro: { retroId } })
    },
    async eventNames() {
      const { events } = await app.events.list.execute({ actor: 'ai' })
      return events.map((event) => event.name)
    },
  }
}
