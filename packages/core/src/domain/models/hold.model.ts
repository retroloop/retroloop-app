/**
 * A record parked, or released — the **lifecycle flag**, not a review verdict
 * (`r-hold-semantics`).
 *
 * Hold means the issue is not to be implemented. It is not a review status of a
 * retrospective item: a user can put an issue on hold and then approve it. When
 * the AI picks work up, it does not consider items to solve that are on hold,
 * unless the human has told it to go after them.
 *
 * So a hold sits on its own axis, orthogonal to the verdict: a record may be
 * held and pending, held and approved, or held and declined, and the finish gate
 * never asks. Human-authored, human-only, append-only versions — the same rules
 * a decision obeys, for the same reason: what the human said is never rewritten.
 *
 * There is no revision here, deliberately. A hold is about the **item**, so it
 * is keyed on `(retroId, rid)` and outlives every redraft of that record —
 * unlike a decision, which binds to the content it was given for. A
 * paragraph being rewritten does not stop "not until the release ships" being
 * true.
 */
export type Hold = {
  readonly id: number
  readonly retroId: number
  readonly rid: string
  /** 1-based, dense per (retroId, rid). The highest version is the one in force. */
  readonly version: number
  /** `true` parks the record, `false` releases it. Clearing is a row, never a delete. */
  readonly held: boolean
  /** Why the human parked it. Offered, never demanded; absent on every release. */
  readonly note: string | undefined
  readonly at: string
}

export type NewHold = Omit<Hold, 'id'>
