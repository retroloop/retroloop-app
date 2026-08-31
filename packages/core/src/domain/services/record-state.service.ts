import type { Decision, DecisionState } from '#domain/models/decision.model'
import {
  type Involvement,
  proposedLevel,
  type RetroRecord,
  recommendedSolution,
  type Severity,
  type SolutionLevel,
} from '#domain/models/record.model'
import { hashRecordContent } from '#domain/services/content-hash.service'

/**
 * A record's state as the reviewer sees it now, resolved from its latest decision
 * and the content in front of them.
 */
export type EffectiveDecision = {
  readonly state: DecisionState
  /** The revision the binding decision was made against; absent while pending. */
  readonly decidedOnRevision: number | undefined
  /** The decision was made against an earlier revision and still binds ("approved on rev 1"). */
  readonly carriedOver: boolean
  /**
   * Set when a decision exists but no longer binds: the narrative changed after
   * it, so the record is pending again. Carries the revision that was decided,
   * which is what the UI needs to say *why* it went back to pending.
   */
  readonly contentChangedSince: number | undefined
  readonly severity: Severity
  readonly solutionLevel: SolutionLevel
  /**
   * The solution in effect, 1-based — the human's pick once they have made one,
   * and the AI's recommendation until then. `undefined` on a record that
   * proposes no solutions.
   *
   * It is the same shape as the three dials: what is showing while a record is
   * pending is the AI's proposal, and pressing a verdict without touching it is
   * how a reviewer says they accept it.
   */
  readonly selectedSolution: number | undefined
  readonly involvement: Involvement
  readonly reviewerNote: string | undefined
}

/**
 * Carry-over, option A (D2): a decision binds to the content it was made against.
 * Identical content carries the decision forward; changed content resets the
 * record to `pending` — without writing anything, because pending *is* the absence
 * of a decision for the current content.
 *
 * "Explicit approve only" survives (KC-0010): every approval that carries was an
 * explicit human act, against byte-identical content. Nothing here can invent one.
 */
export function effectiveDecision(
  record: RetroRecord,
  currentRevisionN: number,
  latest: Decision | undefined,
): EffectiveDecision {
  const recommended =
    record.solutions === undefined ? undefined : recommendedSolution(record.solutions)

  const proposed: EffectiveDecision = {
    state: 'pending',
    decidedOnRevision: undefined,
    carriedOver: false,
    contentChangedSince: undefined,
    severity: record.defaults.severity,
    solutionLevel: proposedLevel(record),
    selectedSolution: recommended,
    involvement: record.defaults.involvement,
    reviewerNote: undefined,
  }

  if (latest === undefined) return proposed
  if (latest.contentHash !== hashRecordContent(record)) {
    return { ...proposed, contentChangedSince: latest.revisionN }
  }

  return {
    state: latest.state,
    decidedOnRevision: latest.revisionN,
    carriedOver: latest.revisionN !== currentRevisionN,
    contentChangedSince: undefined,
    severity: latest.severity,
    solutionLevel: latest.solutionLevel,
    // A binding decision on a solutions record always carries one, because the
    // use case resolves it before writing. The fallback is for a row an older
    // binary wrote against the same bytes — its reviewer read the recommended
    // one, which is what they were shown.
    selectedSolution: latest.selectedSolution ?? recommended,
    involvement: latest.involvement,
    reviewerNote: latest.reviewerNote,
  }
}

/**
 * The finish gate's question (D3): which records of this revision are still
 * pending?
 *
 * A verdict is the only thing it asks about, and since retro 4 `r-remove-hold`
 * it is the only axis a record has: there was briefly an `effectiveHold` beside
 * `effectiveDecision` here, and the owner removed the feature — *"I can achieve
 * the whole thing by selecting something to be only done with the human in the
 * loop."* What the solving side may do without him is `involvement`, which is
 * part of the verdict.
 */
export function pendingRids(
  records: readonly RetroRecord[],
  revisionN: number,
  latestDecisions: ReadonlyMap<string, Decision>,
): readonly string[] {
  return ridsInState(records, revisionN, latestDecisions, 'pending')
}

/**
 * Which records the human has asked to see rewritten (`r-verdict-revise`).
 *
 * The gate does not read this — a `revise` record is decided, and finishing is
 * his to do. Closing the review to export does: an ask that would otherwise be
 * filed as an outcome is what "must-address in the next revision" is protecting
 * against (`close-review.use-case.ts`).
 */
export function reviseRids(
  records: readonly RetroRecord[],
  revisionN: number,
  latestDecisions: ReadonlyMap<string, Decision>,
): readonly string[] {
  return ridsInState(records, revisionN, latestDecisions, 'revise')
}

function ridsInState(
  records: readonly RetroRecord[],
  revisionN: number,
  latestDecisions: ReadonlyMap<string, Decision>,
  state: DecisionState,
): readonly string[] {
  return records
    .filter(
      (record) =>
        effectiveDecision(record, revisionN, latestDecisions.get(record.rid)).state === state,
    )
    .map((record) => record.rid)
}
