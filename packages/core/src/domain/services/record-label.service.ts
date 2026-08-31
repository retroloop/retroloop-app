import type { RecordLabelEntry } from '#domain/models/record-label.model'
import { recordKey } from '#domain/services/record-key.service'

/**
 * Which labels a record wears right now — the sibling of `effectiveLifecycle`
 * and `effectiveDecision`, and it reads the same way: the latest row per label
 * wins, nothing is written to answer the question, and the absence of a row is
 * an answer rather than a gap.
 *
 * **The fold is per label, not per record.** A record carrying three labels
 * holds three independent version sequences, each dense from 1, so "the latest
 * entry" is a question with three answers and taking the highest version across
 * all of them would read one label's history as another's. That is why
 * `listForRecord` is ordered by `id` — insertion order, which is the only order
 * that means anything across sequences.
 *
 * It takes any list of entries about one record and folds it, so the same
 * function answers for `listForRecord` (every entry ever) and for a slice of
 * `listLatestForEachRecord` (already one per label). Folding a list that is
 * already folded changes nothing, which is what lets one function serve the
 * record page and the flat listing — and is what stops the two from ever
 * disagreeing about what a record wears.
 */
export function appliedLabelIds(entries: readonly RecordLabelEntry[]): readonly number[] {
  const latest = new Map<number, RecordLabelEntry>()
  for (const entry of entries) {
    const known = latest.get(entry.labelId)
    if (known === undefined || entry.version > known.version) latest.set(entry.labelId, entry)
  }

  return [...latest.values()]
    .filter((entry) => entry.applied)
    .map((entry) => entry.labelId)
    .sort((left, right) => left - right)
}

/**
 * The entry in force for one `(record, label)` — what a write numbers itself
 * after, and the one read that has to see a `false` row rather than skipping it:
 * applying a label that was taken off before is version 3, not version 1.
 */
export function latestLabelEntry(
  entries: readonly RecordLabelEntry[],
  labelId: number,
): RecordLabelEntry | undefined {
  return entries
    .filter((entry) => entry.labelId === labelId)
    .reduce<RecordLabelEntry | undefined>(
      (highest, entry) =>
        highest === undefined || entry.version > highest.version ? entry : highest,
      undefined,
    )
}

/**
 * Every entry, grouped by the record it belongs to — the shape the flat
 * cross-retro listing needs, which reads one query and then hands each row its
 * own slice.
 *
 * Keyed on `(retroId, rid)` through `recordKey`, because a rid is minted per
 * retrospective and the flat page is the one surface holding two retrospectives'
 * records at once.
 */
export function labelEntriesByRecord(
  entries: readonly RecordLabelEntry[],
): ReadonlyMap<string, readonly RecordLabelEntry[]> {
  const grouped = new Map<string, RecordLabelEntry[]>()
  for (const entry of entries) {
    const key = recordKey(entry.retroId, entry.rid)
    const known = grouped.get(key)
    if (known === undefined) grouped.set(key, [entry])
    else known.push(entry)
  }
  return grouped
}
