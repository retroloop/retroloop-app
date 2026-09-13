import { type RecordRelationView, resolveRecordRelations } from '#application/views/relation.view'
import type { Decision } from '#domain/models/decision.model'
import type { RetroRecord } from '#domain/models/record.model'
import type { RecordClaimEntry } from '#domain/models/record-claim.model'
import type { RecordId } from '#domain/models/record-id.model'
import type { RecordLifecycleEntry } from '#domain/models/record-lifecycle.model'
import type { RecordRelationEntry } from '#domain/models/record-relation.model'
import { type EffectiveClaim, effectiveClaim } from '#domain/services/record-claim.service'
import {
  type EffectiveLifecycle,
  effectiveLifecycle,
} from '#domain/services/record-lifecycle.service'
import { type EffectiveDecision, effectiveDecision } from '#domain/services/record-state.service'

/**
 * A record as a reader sees it: the AI's content, which revision it came from,
 * and where the human's decision stands against *that* content (D2).
 *
 * **There is no `hold` beside the decision any more** (retro 4 `r-remove-hold`).
 * A lifecycle flag rode here for one session and the owner removed it on first
 * contact — *"I can achieve the whole thing by selecting something to be only
 * done with the human in the loop. So we don't need the hold."* Whether the
 * solving side may touch an item without him is `involvement`, which is already
 * on the decision. The `holds` table keeps every row that was written.
 *
 * Read models live here rather than inside one use case because several use cases
 * return the same shape — record list, record get, revision get — and adapters
 * type their outputs against it.
 */
export type RecordView = {
  readonly record: RetroRecord
  /**
   * The number the reader is shown — the record's place in the whole ledger,
   * minted once and stored beside the revision rather than in it
   * (`record-id.model.ts`).
   *
   * Beside `record` rather than on it, and that placement is load-bearing:
   * `record` is the stored blob and `revision get --content` hands it straight
   * back, so a key added inside it would change a document the AI is promised it
   * can resubmit unchanged. `record.num` is still there and still true — a
   * record's position in its own retrospective — it is simply not what the page
   * prints any more.
   */
  readonly globalId: number
  readonly revisionN: number
  readonly decision: EffectiveDecision
}

/**
 * A `RecordView` with the axis that outlives the review beside the verdict —
 * `open`, `resolved` or `archived`, plus the entry in force (#103
 * `r-lifecycle-projection-gap`).
 *
 * **Its own type rather than a field on `RecordView`**, because six use cases
 * build a `RecordView` and only the listings answer for lifecycle: a required
 * field would make `records.get`, `decisions.record` and `revisions.get` each
 * take a lifecycle read they have no reader for, and an optional one would put
 * the projection back in the position this record was filed about — a key that
 * is there and empty, indistinguishable from a record nobody has touched.
 */
export type RecordViewWithLifecycle = RecordView & {
  readonly lifecycle: EffectiveLifecycle
  /**
   * And who is holding the record right now, if anybody — the in-progress
   * marker, which rides with the lifecycle rather than on it
   * (`record-claim.model.ts`).
   *
   * It is here rather than in a `RecordViewWithClaim` of its own because every
   * reader that pays for the lifecycle read wants this in the same breath: a
   * listing showing `open` beside no answer to "is somebody on it?" is the gap
   * #103 was filed about, one table further out. `undefined` is a record nobody
   * is holding, which is the same answer for one nobody ever held and one
   * somebody gave back (`record-claim.service.ts`).
   */
  readonly claim: EffectiveClaim | undefined
}

/**
 * A `RecordViewWithLifecycle` with what the record was said to have to do with
 * other records — the AI's read-back channel for the relation feature (the
 * owner's session-11 ask).
 *
 * **Its own type again, and for #103's reason rather than for tidiness.** That
 * record was filed because the revision listing answered nothing about lifecycle
 * while the flat one answered correctly, and it was found the worst way: the AI
 * wrote a batch of rows, listed the records to check, and read a store that
 * looked broken. A relation is written through the same command and checked the
 * same way, so `record list` carries them or the same gap reopens one table
 * over. Only the listing that the AI reads back through pays for the join — the
 * six use cases that build a bare `RecordView` take no relation read at all.
 *
 * The entries carry the far record's **address** and not its title: what a
 * machine does with a relation is go and read the record at the other end, and
 * `(retroId, rid)` is what every one of its other reads is addressed by
 * (`relation.view.ts`).
 */
export type RecordViewWithRelations = RecordViewWithLifecycle & {
  readonly relations: readonly RecordRelationView[]
}

export function buildRecordView(
  record: RetroRecord,
  globalId: number,
  revisionN: number,
  latestDecision: Decision | undefined,
): RecordView {
  return {
    record,
    globalId,
    revisionN,
    decision: effectiveDecision(record, revisionN, latestDecision),
  }
}

/**
 * The lifecycle join, in the one place both listings can reach it.
 *
 * `effectiveLifecycle` is asked for the **effective verdict** rather than the
 * record's own, because a record with no entry is born archived exactly when it
 * was declined (`lifecycle.md`) — and it is `view.decision.state` rather than a
 * second reading of the decisions table, so this row can never show "declined"
 * beside "open".
 *
 * `list-all-records.use-case.ts` makes the same call on the same terms and does
 * not come through here, because it builds a flat cross-retro row rather than a
 * `RecordView`. What holds the two together is not shared code but the
 * cross-projection test in `record-lifecycle.test.ts`, which reads one record
 * both ways and compares the whole entry — the assertion this record was filed
 * for the absence of.
 */
export function withLifecycle(
  view: RecordView,
  entry: RecordLifecycleEntry | undefined,
  claim: RecordClaimEntry | undefined,
): RecordViewWithLifecycle {
  return {
    ...view,
    lifecycle: effectiveLifecycle(entry, view.decision.state),
    // Folded here rather than taken as an `EffectiveClaim` from the caller, so
    // both listings read a claim through the one function every reader folds
    // with — the reason the lifecycle beside it is derived here too.
    claim: effectiveClaim(claim),
  }
}

/**
 * The relation join, beside the lifecycle one and folded through the same
 * function every other reader folds with (`relationsInForce`, reached via
 * `resolveRecordRelations`) — so the revision listing and the record page can
 * never disagree about what a record is related to.
 *
 * It takes the record's **global id** rather than its pair, because that is what
 * a relation is keyed on: a relation names two records and may name them across
 * two retrospectives, so `(retroId, rid)` is not a handle it can be addressed
 * by (`record-relation.model.ts`).
 */
export function withRelations(
  view: RecordViewWithLifecycle,
  entries: readonly RecordRelationEntry[],
  identities: ReadonlyMap<number, RecordId>,
): RecordViewWithRelations {
  return { ...view, relations: resolveRecordRelations(view.globalId, entries, identities) }
}

/**
 * The global number of every record of one retrospective, keyed by rid.
 *
 * A miss is not a state the product can reach — the write path mints on first
 * appearance and the migration minted everything that was already stored — so
 * every reader below asks this map for a number it is entitled to, and
 * `requireGlobalId` is what turns the impossible case into a sentence rather
 * than an `undefined` that reaches a page as `#NaN`.
 */
export function globalIdsByRid(
  minted: readonly { readonly rid: string; readonly id: number }[],
): ReadonlyMap<string, number> {
  return new Map(minted.map((record) => [record.rid, record.id]))
}

export function requireGlobalId(
  globalIds: ReadonlyMap<string, number>,
  retroId: number,
  rid: string,
): number {
  const globalId = globalIds.get(rid)
  if (globalId === undefined) {
    // The same reasoning `list-all-records.use-case.ts` gives for shouting about
    // a retrospective whose session is gone: saying which record has no number
    // beats handing a page a blank where its identity goes.
    throw new Error(
      `record ${rid} of retrospective ${retroId} has no global number; the store is missing a record_ids row`,
    )
  }
  return globalId
}

/** The latest decision per record, keyed by `rid`. */
export function decisionsByRid(decisions: readonly Decision[]): ReadonlyMap<string, Decision> {
  return new Map(decisions.map((decision) => [decision.rid, decision]))
}
