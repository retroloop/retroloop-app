import type { Actor } from '#domain/models/actor.model'

/**
 * What happened to a record **after the review that filed it closed**. Even
 * once a retrospective is closed, metadata can be attached to its records so
 * that their life cycle stays manageable: when the AI fixes an issue there is a
 * native status saying the issue was resolved, and a commit id, a GitHub issue
 * or some other reference can be cited so that the fix is easy to see.
 *
 * This is a lifecycle **beside** the verdict, not another position on it. A
 * verdict is the human's answer to "should we do this" and it is settled when
 * the review closes; this is the answer to "did we do it", and it only starts
 * being interesting once the review is over. Nothing here touches a decision,
 * and a record can be resolved whatever its verdict says — including `declined`,
 * because a record can be closed out by deciding it needs nothing.
 *
 * **Both actors write it**, which is the one place this deliberately parts from
 * the holds and `thread_resolutions` precedent it otherwise copies. Those are
 * human fields and the AI is refused at the use case; here the whole point of
 * the feature is the AI marking a record resolved after fixing it, and the human
 * doing the same from the browser. So there is an `actor` column — no other
 * append-only table has one, because every other one is single-writer and the
 * author is implied by the table.
 *
 * **Per act, not per table**: `resolved` and `reopened` take either
 * author, and `archived` / `unarchived` take only the human. Resolving is a
 * report of work done and the AI is the one who does it; archiving is a judgment
 * about what is worth looking at, and that stays with the human — a user can
 * archive a record whenever they want to, and unarchive it again. The rule
 * lives in the use case, so it holds whichever transport arrives.
 *
 * Append-only all the same, and for both authors: reopening writes another
 * version and edits nothing, so "resolved at 14:02 with commit abc123, reopened
 * at 09:30 the next morning" stays readable forever. The table's triggers say so
 * at L1, exactly as they do for the human-only tables — the guarantee
 * is about immutability, which is not a property of who writes.
 */
export const RECORD_LIFECYCLE_STATUSES = ['resolved', 'reopened', 'archived', 'unarchived'] as const

/**
 * What an entry says. One name per act, mirroring `ThreadResolved` /
 * `ThreadReopened`: a reader that only wants the records still open should not
 * have to interpret a boolean, and a consumer of the outbox should not have to
 * unpack a payload to tell an archive from a resolve.
 *
 * `archived` / `unarchived` are a pair of their own: a record can be given the
 * archived status and taken back out of it again, while by default every other
 * approved record stays a normal one until a user chooses to archive it. They are
 * **human-only**, which is the one asymmetry on this table — the AI reports work
 * it did, and putting a record out of the way is a judgment about what is worth
 * looking at. `SetRecordLifecycleUseCase` refuses the `ai` actor on these two
 * acts and on no others.
 *
 * Deliberately **not** the effective state — `reopened` is a thing somebody did,
 * and `open` is where that leaves the record. `RecordLifecycleState` below is
 * the other half of that distinction, and it has three positions where this has
 * four: both `reopened` and `unarchived` land a record back on `open`.
 */
export type RecordLifecycleStatus = (typeof RECORD_LIFECYCLE_STATUSES)[number]

/**
 * Where a record stands now, on the axis that outlives the review: `open` while
 * it is still owed, `resolved` once somebody fixed it, `archived` once it is out
 * of the way.
 *
 * **Derived, never stored**, and the derivation reads two things: the
 * entry in force, and — when there is none — the record's verdict. A record with
 * no entry is `open`, except a **declined** one, which is `archived` from birth:
 * the discussion is kept rather than the record deleted, so a record marked
 * declined during the retrospective is simply archived, and the user can
 * unarchive it.
 *
 * Both halves of that are still readings of an absence rather than rows anybody
 * wrote. Nothing is written at close, so a store that was closed before this
 * existed answers the same as one closed after it, and unarchiving a record born
 * archived writes version 1 like any other first act.
 *
 * `docs/design/lifecycle.md` is the whole machine, per entity, in one place.
 */
export const RECORD_LIFECYCLE_STATES = ['open', 'resolved', 'archived'] as const

export type RecordLifecycleState = (typeof RECORD_LIFECYCLE_STATES)[number]

export type RecordLifecycleEntry = {
  readonly id: number
  /**
   * The retrospective the record belongs to. Half of the identity: `rid` is
   * minted per retrospective and is **not** globally unique (`record.model.ts`),
   * so `(retroId, rid)` is what addresses a record anywhere in this system.
   */
  readonly retroId: number
  readonly rid: string
  /** 1-based, dense per `(retroId, rid)`. The highest version is the one in force. */
  readonly version: number
  readonly status: RecordLifecycleStatus
  /**
   * Free-text references the entry cites — a commit sha, a PR or issue URL, a
   * branch name. Plain strings on purpose: a reference may be a commit id, a
   * GitHub issue or something else again, and a shape that insisted on
   * knowing which of those it was would be a shape that refuses the fourth kind.
   * The reader linkifies what looks like a URL and prints the rest.
   *
   * Non-empty on a `resolved` entry and empty on every other act — the schema
   * enforces both, so a reader of the effective lifecycle never has to wonder
   * whether refs on an open or archived record mean anything. An archive cites
   * nothing for the same reason a reopen does not: references are evidence that
   * a thing was fixed, and neither act claims that.
   */
  readonly refs: readonly string[]
  /** Offered, never demanded — the same standing `holds.note` had. */
  readonly note: string | undefined
  /** Who wrote it. The AI resolves after fixing; the human resolves from the browser. */
  readonly actor: Actor
  readonly at: string
}

export type NewRecordLifecycleEntry = Omit<RecordLifecycleEntry, 'id'>
