import type { Store } from '#application/ports/store.port'
import { decisionsByRid } from '#application/views/record.view'
import { type RetroDisplayState, retroDisplayState } from '#application/views/retro.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import { effectiveDecision } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

/**
 * How far the review has got.
 *
 * The verdict buckets are `Record<DecisionState, number>` rather than a
 * list, so they cannot fall out of step with the states a decision can be in —
 * `revise` among them since retro 4 `r-verdict-revise`, which is how the AI
 * reading this after a finish sees that a record was sent back for a rewrite —
 * `hold` among them, which is the **frozen legacy verdict** bucket: nothing can
 * write one any more (`r-hold-semantics`), and every store that never held one
 * reads zero there forever. It stays because a stored value is never rewritten
 * and the sum has to keep adding up: pending + approved + declined + hold =
 * total.
 *
 * There was a `held` count beside them for one session, over the lifecycle flag
 * `r-hold-semantics` introduced. Retro 4 `r-remove-hold` removed the feature and
 * this count with it, and the verdict buckets are the whole answer again.
 */
export type ReviewCounts = Record<DecisionState, number> & {
  readonly total: number
}

export type GetReviewStatusInput = {
  readonly actor: Actor
  readonly retro: RetroRef
}

export type GetReviewStatusOutput = {
  readonly retroId: number
  /**
   * The **displayed** state — the same reading the dashboard row and the review
   * header carry, `submitted` among them (`retro.view.ts`). The AI reads this
   * between its `review wait` and its `review close`, which is precisely the
   * window the fourth word names, and it should not have to infer from a
   * `reviewing` here what the browser is already saying in a word.
   */
  readonly state: RetroDisplayState
  /**
   * Whether the retrospective is closed — the *stored* terminal state, and
   * unmoved by the reading above it. `submitted` is not finished: it is the
   * window before the AI's close, and a script that keyed off this boolean
   * before the fourth word existed keys off exactly the same thing after it.
   */
  readonly finished: boolean
  /** The revision the counts describe; absent before the first revision lands. */
  readonly revisionN: number | undefined
  readonly counts: ReviewCounts
}

/**
 * `review status`: how far the human has got on the current revision, counted
 * from effective state — so a decision carried over from an earlier revision
 * counts as decided, and a record whose content changed counts as pending again.
 *
 * These counts are exactly what the finish gate reads.
 */
export class GetReviewStatusUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetReviewStatusInput): Promise<GetReviewStatusOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revision = await this.store.revisions.findLatestByRetro(retrospective.id)
    const latest = decisionsByRid(await this.store.decisions.listLatestByRetro(retrospective.id))
    // The one fact `submitted` is a reading of, and the same bounded read
    // `list-revisions.use-case.ts` already makes for the review page's per-round
    // answer: there is no column anywhere that says a round was put down.
    const finishedRounds = await this.store.events.list({
      retroId: retrospective.id,
      names: ['ReviewFinished'],
    })

    const counts = { pending: 0, approved: 0, declined: 0, revise: 0, hold: 0, total: 0 }
    for (const record of revision?.records ?? []) {
      counts[effectiveDecision(record, revision?.n ?? 0, latest.get(record.rid)).state] += 1
      counts.total += 1
    }

    return {
      retroId: retrospective.id,
      state: retroDisplayState(
        retrospective.state,
        revision !== undefined && finishedRounds.some((event) => event.revisionN === revision.n),
      ),
      finished: retrospective.state === 'finished',
      revisionN: revision?.n,
      counts,
    }
  }
}
