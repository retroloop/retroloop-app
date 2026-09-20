import type { Store } from '#application/ports/store.port'
import { decisionsByRid } from '#application/views/record.view'
import { type RevisionMeta, toRevisionMeta } from '#application/views/revision.view'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import type { Involvement, Severity, SolutionLevel } from '#domain/models/record.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import { effectiveDecision } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

/**
 * Identity and verdict only — no narrative.
 *
 * The three dials are part of the verdict, not the narrative: they are what the
 * human turned, and the export carries them as the outcome. Dropping them here
 * would mean the drafting step reads a weaker account of the review than the
 * export does, so they come from the same `effectiveDecision` the export uses —
 * the record's own proposals while nothing has been decided, the human's values
 * once something has.
 */
export type RecordVerdict = {
  readonly rid: string
  readonly num: number
  readonly state: DecisionState
  readonly decidedOnRevision: number | undefined
  readonly contentChangedSince: number | undefined
  readonly severity: Severity
  readonly solutionLevel: SolutionLevel
  /**
   * Which solution the human's verdict is for, 1-based — `undefined` on a record
   * that proposed none. It is a verdict field like the three dials, so it is
   * here for the same reason they are: the drafting step must not read a weaker
   * account of the review than the export does.
   */
  readonly selectedSolution: number | undefined
  readonly involvement: Involvement
  readonly reviewerNote: string | undefined
}

export type GetRevisionFeedbackInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  readonly revision?: number
}

export type GetRevisionFeedbackOutput = {
  readonly retrospective: Retrospective
  readonly revision: RevisionMeta
  readonly records: readonly RecordVerdict[]
  readonly threads: readonly ThreadView[]
  /**
   * What the human wrote on finishing this round, or `undefined` if they left no
   * word (`r-finish-confirm-message`). It is **not** in `threads`, deliberately:
   * it is delivered separately from the comments, and a thread is a conversation
   * the AI answers where this is a summary it reads.
   */
  readonly finishMessage: string | undefined
}

/**
 * `revision get --feedback-only`: what the human said, without the bodies the AI
 * wrote. It is what the drafting step reads before writing revision n+1, so it
 * carries record identity and the verdict — enough to know *which* record each
 * answer belongs to — and nothing of the narrative.
 *
 * Since `r-finish-confirm-message` it also carries the human's final word on the
 * round, which is the one thing here that is neither a verdict nor a comment: it
 * travels separately from both, and the drafting step reads it alongside them.
 *
 * `held` and `holdNote` rode here for one session and are gone (`r-remove-hold`).
 * "Do not pick this up without me" is `involvement`, which is part of the
 * verdict and already on every row. `requests` is gone for the matching reason
 * (`r-remove-requests`): the asks arrive as review-level comments, which are in
 * `threads`.
 */
export class GetRevisionFeedbackUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetRevisionFeedbackInput): Promise<GetRevisionFeedbackOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revision = NotFoundError.require(
      await resolveRevision(this.store.revisions, retrospective.id, input.revision),
      'revision',
      input.revision ?? 'latest',
    )

    const latest = decisionsByRid(await this.store.decisions.listLatestByRetro(retrospective.id))
    const threads = await this.store.threads.listByRetro(retrospective.id)
    const finishMessage = await this.store.finishMessages.findLatest(retrospective.id, revision.n)

    return {
      retrospective,
      revision: toRevisionMeta(revision),
      records: revision.records.map((record) => {
        const decision = effectiveDecision(record, revision.n, latest.get(record.rid))
        return {
          rid: record.rid,
          num: record.num,
          state: decision.state,
          decidedOnRevision: decision.decidedOnRevision,
          contentChangedSince: decision.contentChangedSince,
          severity: decision.severity,
          solutionLevel: decision.solutionLevel,
          selectedSolution: decision.selectedSolution,
          involvement: decision.involvement,
          reviewerNote: decision.reviewerNote,
        }
      }),
      threads: await loadThreadViews(this.store, retrospective.id, threads),
      finishMessage: finishMessage?.message,
    }
  }
}
