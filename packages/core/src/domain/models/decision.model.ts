import type { Involvement, Severity, SolutionLevel } from '#domain/models/record.model'

/**
 * `declined` is a state, never a deletion; `revise` is "rewrite this one and
 * bring it back" (`r-verdict-revise`); `hold` is read-only history.
 */
export type DecisionState = 'pending' | 'approved' | 'declined' | 'revise' | 'hold'

/**
 * The human's explicit per-record verdict — human-only, UI-only, append-only
 * (data-model.md §Decision). Changing a decision appends a new `version`; nothing
 * is ever overwritten, so the history stays readable forever.
 *
 * `pending` is never stored as the *absence* of a decision — absence already means
 * pending. A stored `pending` row only ever comes from a human explicitly moving a
 * record back to pending, which is what an undo is: re-clicking the verdict that
 * is already selected appends a new `pending` version and keeps both
 * (`r-verdict-revise`). Nothing is ever rewritten to undo anything.
 */
export type Decision = {
  readonly id: number
  readonly retroId: number
  readonly rid: string
  /** 1-based, dense per (retroId, rid). */
  readonly version: number
  readonly state: DecisionState
  readonly severity: Severity
  /**
   * The ceiling the human approved. On a record with solutions this is not a
   * dial of its own: it is the level of the solution they selected, written here
   * so that every reader of a decided level — the export, `record list`,
   * `revision get --feedback-only` — goes on answering the same question
   * whichever shape the record was filed in.
   */
  readonly solutionLevel: SolutionLevel
  /**
   * Which of the record's solutions the human's verdict is for, **1-based**, or
   * `undefined` on a record that proposed no solutions to choose between.
   *
   * An index is only meaningful against the array it indexes, which is why the
   * solutions array is inside the content hash: any change to it sends the
   * record back to pending and the reviewer picks again (`content-hash.service.ts`).
   */
  readonly selectedSolution: number | undefined
  readonly involvement: Involvement
  readonly reviewerNote: string | undefined
  /** The revision whose content this decision was made against. */
  readonly revisionN: number
  /**
   * Canonical-JSON hash of that revision's record content (identity + narrative).
   * Denormalized from `revisionN` — derivable, stored so carry-over (D2) is a
   * comparison rather than a second revision read.
   */
  readonly contentHash: string
  readonly decidedAt: string
}

export type NewDecision = Omit<Decision, 'id'>
