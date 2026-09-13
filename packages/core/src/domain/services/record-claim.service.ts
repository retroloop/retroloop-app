import type { Actor } from '#domain/models/actor.model'
import type { RecordClaimEntry } from '#domain/models/record-claim.model'
import { recordKey } from '#domain/services/record-key.service'

/**
 * The claim standing on a record right now — who holds it and since when.
 *
 * The sibling of `effectiveLifecycle` and `effectiveDecision`, and it reads the
 * way both do: the latest row wins, nothing is written to answer the question,
 * and the absence of a row is an answer rather than a gap.
 *
 * **`undefined` is the whole of "nobody is holding this"**, and it covers two
 * different histories on purpose: a record nobody has ever claimed, and one
 * somebody claimed and gave back. The difference is in the table and is readable
 * there; what a queue, a badge or a second agent asks is one question with one
 * answer, and a shape that made the caller distinguish `undefined` from
 * `{ claimed: false }` would have every reader of it writing the same `if`.
 */
export type EffectiveClaim = {
  /** When the claim in force was taken — the `at` of the row that took it. */
  readonly claimedAt: string
  /** Who is holding it. Either actor may (`record-claim.model.ts`). */
  readonly actor: Actor
}

/**
 * The latest entry, read as a claim — and defined **only** when that entry took
 * the record rather than gave it back.
 *
 * A released record reads exactly like one nobody ever touched, which is what
 * makes "is anybody on this?" a single boolean question at every call site.
 */
export function effectiveClaim(latest: RecordClaimEntry | undefined): EffectiveClaim | undefined {
  if (latest === undefined || !latest.claimed) return undefined
  return { claimedAt: latest.at, actor: latest.actor }
}

/**
 * The entry in force for each record, keyed `"<retroId> <rid>"` — the shape
 * every cross-retro listing folds.
 *
 * Keyed through `recordKey` for the reason that function exists: a rid is minted
 * per retrospective and is not globally unique, so a listing keyed on the rid
 * alone would show one record's claim on another record's row — which on this
 * table means an agent declining to pick up work nobody is doing.
 */
export function claimsByRecord(
  entries: readonly RecordClaimEntry[],
): ReadonlyMap<string, RecordClaimEntry> {
  return new Map(entries.map((entry) => [recordKey(entry.retroId, entry.rid), entry]))
}
