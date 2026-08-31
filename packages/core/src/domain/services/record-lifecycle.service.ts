import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import type {
  RecordLifecycleEntry,
  RecordLifecycleState,
  RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
import { recordKey } from '#domain/services/record-key.service'

/**
 * Where a record stands on the lifecycle axis right now, and what the entry that
 * put it there said.
 *
 * This is the sibling of `effectiveDecision` and reads the same way: the latest
 * row wins, nothing is written to answer the question, and the absence of a row
 * is a state rather than a gap. What it is **not** is a second position on the
 * verdict — a record's verdict is what the human decided about doing the work,
 * and this is what happened when somebody did it. Retro 3 put a lifecycle flag on
 * the verdict axis and retro 4 removed it (`r-remove-hold`); this one is beside
 * the verdict on purpose, and lives past the close that settles it.
 */
export type EffectiveLifecycle = {
  readonly status: RecordLifecycleState
  /**
   * The references the entry in force cites. Empty on a record nobody has
   * touched and on one whose last act was anything but a resolve — only a
   * resolve carries any, so refs are present exactly when `status` is
   * `resolved`.
   */
  readonly refs: readonly string[]
  readonly note: string | undefined
  /** Who wrote the entry in force; absent while the record has none. */
  readonly actor: Actor | undefined
  /** When it was written; absent while the record has none. */
  readonly at: string | undefined
}

/**
 * Where each act leaves the record — the whole of the latest-wins half of the
 * machine, as a table rather than as a chain of ternaries.
 *
 * Two acts land on `open`, which is why the acts and the states are separate
 * types: a reopen and an unarchive are different things somebody did, and a
 * reader asking "is this still owed?" wants the same answer from both.
 */
const STATE_AFTER: Record<RecordLifecycleStatus, RecordLifecycleState> = {
  resolved: 'resolved',
  reopened: 'open',
  archived: 'archived',
  unarchived: 'open',
}

/**
 * Where a record with **no entry at all** stands (the owner's session-9 ruling).
 *
 * A declined record is born archived: the review said no, and *"we still want to
 * maintain its discussion"* — so it goes out of the way rather than away.
 * Everything else — approved, `revise`, a legacy `hold`, and a record still
 * pending because its review has not closed — is born open.
 *
 * **Derived, never written.** Nothing at close writes an archive row, which is
 * what keeps this true of a store closed before the feature existed and lets an
 * unarchive be version 1. A record whose verdict later changes changes its birth
 * state with it, which is only reachable before a close, and is the same
 * latest-wins reading `effectiveDecision` gives the verdict itself.
 */
export function bornLifecycleState(verdict: DecisionState): RecordLifecycleState {
  return verdict === 'declined' ? 'archived' : 'open'
}

/**
 * The latest entry, read as a state — and the verdict, read as one, while there
 * is no entry to read.
 *
 * The inference this feature makes is still the safe direction of KC-0010: it
 * reads silence about *acts* as nothing having been done. `resolved` and
 * `archived`-by-hand are always explicit acts by a named actor — there is no
 * path anywhere that resolves a record because a commit mentioned it, a review
 * closed, or a session ended. Born-archived is not an exception to that: it is
 * a reading of something the human explicitly decided, the decline itself.
 */
export function effectiveLifecycle(
  latest: RecordLifecycleEntry | undefined,
  verdict: DecisionState,
): EffectiveLifecycle {
  if (latest === undefined) {
    return {
      status: bornLifecycleState(verdict),
      refs: [],
      note: undefined,
      actor: undefined,
      at: undefined,
    }
  }

  return {
    status: STATE_AFTER[latest.status],
    refs: latest.refs,
    note: latest.note,
    actor: latest.actor,
    at: latest.at,
  }
}

/**
 * Which states each act may be taken from — the transition half of the machine,
 * enforced at write time (`set-record-lifecycle.use-case.ts`).
 *
 * It is a refusal rather than a no-op, on the precedent reopening-what-was-never-
 * resolved already set: answering "done" to an act that did nothing is the quiet
 * inference this product refuses everywhere else. Archiving a record twice, or
 * resolving one that is already resolved, is a caller who believes the store
 * says something it does not.
 *
 * Archive is the one act with two sources: a record can be put out of the way
 * whether or not anybody fixed it first, which is the owner's *"by default all
 * others that have approval, those are normal records so if a user wants, they
 * can just archive it"* — and a resolved record he no longer wants in the list
 * is exactly that.
 */
export const LIFECYCLE_ACT_FROM: Record<RecordLifecycleStatus, readonly RecordLifecycleState[]> = {
  resolved: ['open'],
  reopened: ['resolved'],
  archived: ['open', 'resolved'],
  unarchived: ['archived'],
}

/** Whether the act may be taken from where the record stands now. */
export function lifecycleActPermitted(
  act: RecordLifecycleStatus,
  from: RecordLifecycleState,
): boolean {
  return LIFECYCLE_ACT_FROM[act].includes(from)
}

/**
 * The two acts that are the human's alone (the owner's session-9 word: *"the
 * user should be able to unarchive … if a user wants, they can just archive
 * it"*).
 *
 * This table takes both actors, which is the whole reason it has an `actor`
 * column — but that was decided for *resolving*, which is a report of work the
 * AI did. Archiving is a judgment about what is worth looking at, and it stays
 * where every other judgment in this product is: with the human. So the rule is
 * per act rather than per table, and it lives here so the use case, the docs and
 * the CLI's refusal all read it from one place.
 */
export const LIFECYCLE_HUMAN_ONLY_ACTS: readonly RecordLifecycleStatus[] = [
  'archived',
  'unarchived',
]

export function lifecycleActIsHumanOnly(act: RecordLifecycleStatus): boolean {
  return LIFECYCLE_HUMAN_ONLY_ACTS.includes(act)
}

/** The entry in force for each record, keyed `"<retroId> <rid>"` — see below. */
export function lifecycleByRecord(
  entries: readonly RecordLifecycleEntry[],
): ReadonlyMap<string, RecordLifecycleEntry> {
  return new Map(entries.map((entry) => [lifecycleKey(entry.retroId, entry.rid), entry]))
}

/**
 * The composite key, in one place — and since session 10 that one place is
 * `record-key.service.ts`, because the label entries and the attribute values
 * group by exactly the same key and a fourth copy of the template literal was a
 * fourth chance to write it the other way round.
 *
 * The name stays for its callers, and it goes on meaning what it meant: a rid is
 * minted per retrospective and is not globally unique (`record.model.ts`), so a
 * cross-retro listing keyed on the rid alone would silently show one record's
 * resolution on another's row.
 */
export function lifecycleKey(retroId: number, rid: string): string {
  return recordKey(retroId, rid)
}
