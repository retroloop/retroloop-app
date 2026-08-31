import type { RecordAttributeValueEntry } from '#domain/models/record-attribute-value.model'
import { recordKey } from '#domain/services/record-key.service'

/** One attribute's value on one record, as it stands. */
export type SetAttributeValue = {
  readonly attributeId: number
  readonly value: string
}

/**
 * The values a record carries right now — the attribute twin of
 * `appliedLabelIds`, folding the same way for the same reasons: the latest row
 * **per attribute** wins, because each attribute has its own dense version
 * sequence and taking the highest version across all of them would read one
 * attribute's history as another's.
 *
 * A cleared attribute is a row whose `value` is absent, and it is dropped here
 * rather than reported as an empty string: "this record no longer points at a
 * ticket" and "this record points at the empty string" are different claims, and
 * only the row can hold the first one. The row stays in the store — that is why
 * clearing is an append — and every reader above this sees a record that simply
 * does not carry the attribute.
 */
export function setAttributeValues(
  entries: readonly RecordAttributeValueEntry[],
): readonly SetAttributeValue[] {
  const latest = new Map<number, RecordAttributeValueEntry>()
  for (const entry of entries) {
    const known = latest.get(entry.attributeId)
    if (known === undefined || entry.version > known.version) latest.set(entry.attributeId, entry)
  }

  const values: SetAttributeValue[] = []
  for (const entry of latest.values()) {
    if (entry.value !== undefined)
      values.push({ attributeId: entry.attributeId, value: entry.value })
  }
  return values.sort((left, right) => left.attributeId - right.attributeId)
}

/** The entry in force for one `(record, attribute)` — what a write numbers itself after. */
export function latestAttributeEntry(
  entries: readonly RecordAttributeValueEntry[],
  attributeId: number,
): RecordAttributeValueEntry | undefined {
  return entries
    .filter((entry) => entry.attributeId === attributeId)
    .reduce<RecordAttributeValueEntry | undefined>(
      (highest, entry) =>
        highest === undefined || entry.version > highest.version ? entry : highest,
      undefined,
    )
}

/** Every entry, grouped by the record it belongs to — see `labelEntriesByRecord`. */
export function attributeEntriesByRecord(
  entries: readonly RecordAttributeValueEntry[],
): ReadonlyMap<string, readonly RecordAttributeValueEntry[]> {
  const grouped = new Map<string, RecordAttributeValueEntry[]>()
  for (const entry of entries) {
    const key = recordKey(entry.retroId, entry.rid)
    const known = grouped.get(key)
    if (known === undefined) grouped.set(key, [entry])
    else known.push(entry)
  }
  return grouped
}
