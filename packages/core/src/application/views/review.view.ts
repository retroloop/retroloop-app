import type { Decision, DecisionState } from '#domain/models/decision.model'
import type { Revision } from '#domain/models/revision.model'
import { effectiveDecision } from '#domain/services/record-state.service'

/**
 * How far the review has got.
 *
 * The verdict buckets are `Record<DecisionState, number>` rather than a list,
 * so they cannot fall out of step with the states a decision can be in —
 * `revise` among them since `r-verdict-revise`, which is how the AI reading
 * this after a finish sees that a record was sent back for a rewrite — `hold`
 * among them, which is the **frozen legacy verdict** bucket: nothing can write
 * one any more (`r-hold-semantics`), and every store that never held one reads
 * zero there forever. It stays because a stored value is never rewritten and
 * the sum has to keep adding up: pending + approved + declined + hold = total.
 *
 * There was a `held` count beside them for a time, over the lifecycle flag
 * `r-hold-semantics` introduced. `r-remove-hold` removed the feature and this
 * count with it, and the verdict buckets are the whole answer again.
 */
export type ReviewCounts = Record<DecisionState, number> & {
  readonly total: number
}

/**
 * A revision's records, counted by the state each one is **effectively** in:
 * a verdict given against an earlier revision counts as decided while the
 * narrative is unchanged, and stops counting the moment the AI rewrites the
 * record.
 *
 * One function rather than one per reader, because these are the counts the
 * finish gate reads: `review status` answers with them for one retrospective and
 * `review.listFinished` for the whole stage, and two loops that were supposed to
 * agree about "decided" is exactly the drift that would show up as a dashboard
 * saying one thing and a CLI another.
 *
 * A retrospective with no revision counts nothing, which is the honest answer
 * before the first draft lands rather than a throw the caller has to guard.
 */
export function countReviewRecords(
  revision: Revision | undefined,
  latest: ReadonlyMap<string, Decision> | undefined,
): ReviewCounts {
  const counts = { pending: 0, approved: 0, declined: 0, revise: 0, hold: 0, total: 0 }
  for (const record of revision?.records ?? []) {
    counts[effectiveDecision(record, revision?.n ?? 0, latest?.get(record.rid)).state] += 1
    counts.total += 1
  }
  return counts
}
