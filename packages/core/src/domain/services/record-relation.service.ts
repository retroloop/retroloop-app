import type { RecordRelationEntry } from '#domain/models/record-relation.model'

/**
 * The composite key a relation's version sequence is dense in — the **ordered**
 * pair.
 *
 * It is not `recordKey`, and the difference is the point: every other grouping in
 * this store keys one record as `(retroId, rid)`, while this keys two records by
 * the number that makes each of them a single column (`record-id.model.ts`).
 * Ordered, because `(#5, #12)` and `(#12, #5)` are two statements with two
 * histories — see `record-relation.model.ts` on why the reverse is a row rather
 * than a refusal.
 */
export function relationKey(fromId: number, toId: number): string {
  return `${fromId} ${toId}`
}

/**
 * The entry in force for one ordered pair — what a write numbers itself after,
 * and the one read that has to see an un-relate row rather than skip it:
 * relating a pair somebody took apart is version 3, not version 1.
 */
export function latestRelationEntry(
  entries: readonly RecordRelationEntry[],
  fromId: number,
  toId: number,
): RecordRelationEntry | undefined {
  return entries
    .filter((entry) => entry.fromId === fromId && entry.toId === toId)
    .reduce<RecordRelationEntry | undefined>(
      (highest, entry) =>
        highest === undefined || entry.version > highest.version ? entry : highest,
      undefined,
    )
}

/**
 * Which relations stand right now — the sibling of `appliedLabelIds`,
 * `effectiveLifecycle` and `effectiveDecision`, and it reads the way all three
 * do: the latest row per sequence wins, nothing is written to answer the
 * question, and the absence of a row is an answer rather than a gap.
 *
 * **The fold is per ordered pair, not per record.** A record holding four
 * relations holds four independent version sequences, each dense from 1, so "the
 * latest entry" is a question with four answers and taking the highest version
 * across all of them would read one relation's history as another's. That is why
 * `listForRecord` is ordered by `id`.
 *
 * It takes any list of entries and folds it, so the same function answers for
 * `listForRecord` (every entry ever, about one record) and for
 * `listLatestForEachPair` (already one per pair, about the whole store). Folding
 * a folded list changes nothing, which is what lets one function serve the record
 * page and the revision listing — and is what stops the two from disagreeing
 * about what a record is related to.
 *
 * The result keeps insertion order, which is the order the relations were
 * authored in and the only order that means anything across four sequences.
 */
export function relationsInForce(
  entries: readonly RecordRelationEntry[],
): readonly RecordRelationEntry[] {
  const latest = new Map<string, RecordRelationEntry>()
  for (const entry of entries) {
    const key = relationKey(entry.fromId, entry.toId)
    const known = latest.get(key)
    if (known === undefined || entry.version > known.version) latest.set(key, entry)
  }

  return [...latest.values()]
    .filter((entry) => entry.applied)
    .sort((left, right) => left.id - right.id)
}

/**
 * Which side of a relation a record is on, from that record's point of view.
 *
 * A const rather than a bare union, for the reason `RETROSPECTIVE_STATES` is
 * one: the enum schema the wire validates against is spread from this, so the
 * two cannot come to disagree about what a direction is
 * (`enums.schema.ts`).
 */
export const RELATION_DIRECTIONS = ['outgoing', 'incoming'] as const

export type RelationDirection = (typeof RELATION_DIRECTIONS)[number]

/**
 * The relation read from one record's side: which way it points, and which
 * global id is at the other end.
 *
 * This is the whole of *"the relation reads from both sides"* above the storage
 * layer. The row is directed as authored and is never mirrored, so a reader
 * standing on either record gets the same row and a different answer to "which
 * way": `#5 supersedes #12` is outgoing on #5's page and incoming on #12's, and
 * the words are the same words either way because there is only one of them.
 */
export function relationFrom(
  entry: RecordRelationEntry,
  recordId: number,
): { readonly direction: RelationDirection; readonly otherId: number } {
  return entry.fromId === recordId
    ? { direction: 'outgoing', otherId: entry.toId }
    : { direction: 'incoming', otherId: entry.fromId }
}
