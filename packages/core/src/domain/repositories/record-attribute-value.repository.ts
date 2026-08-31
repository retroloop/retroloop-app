import type {
  NewRecordAttributeValueEntry,
  RecordAttributeValueEntry,
} from '#domain/models/record-attribute-value.model'

/**
 * Append-only, and the same two reads its label twin has
 * (`record-label.repository.ts`) — for the same reasons, one table over.
 *
 * `listForRecord` is ordered by `id` rather than by `version` for the reason the
 * label side gives: versions are dense **per attribute**, so a record carrying
 * two attributes holds two independent `version: 1` rows.
 */
export type RecordAttributeValueRepository = {
  add(entry: NewRecordAttributeValueEntry): Promise<RecordAttributeValueEntry>
  /** Every entry ever written about one record, oldest first by `id`. */
  listForRecord(retroId: number, rid: string): Promise<readonly RecordAttributeValueEntry[]>
  /**
   * The version in force for every `(record, attribute)` pair that has one,
   * across every retrospective — one query for a page that holds all of them.
   */
  listLatestForEachRecord(): Promise<readonly RecordAttributeValueEntry[]>
}
