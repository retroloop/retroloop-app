import type { NewRecordLabelEntry, RecordLabelEntry } from '#domain/models/record-label.model'

/**
 * Append-only, exactly like decisions and thread resolutions: `add` writes a new
 * version and there is no update or delete on this type. Taking a label off a
 * record is a row saying so.
 *
 * Two reads, because the product asks in two shapes: every entry for one record,
 * which is what a record page and a write both need, and the entry in force for
 * **every** record, which is the flat cross-retro listing's one query. There is
 * no `listForRetro` — no surface asks one retrospective for every record's
 * labels at once, and a method nothing calls is a method two adapters implement
 * for nothing.
 */
export type RecordLabelRepository = {
  add(entry: NewRecordLabelEntry): Promise<RecordLabelEntry>
  /**
   * Every entry ever written about one record, oldest first — by `id`, which is
   * insertion order and therefore the order the acts were taken in. It is `id`
   * rather than `version` because versions are dense **per label**, so a record
   * carrying three labels holds three independent `version: 1` rows and ordering
   * by version would interleave them meaninglessly.
   *
   * The caller folds this into "which labels are on now" through
   * `appliedLabelIds` — one function, so a record page and a write can never
   * disagree about what a record wears.
   */
  listForRecord(retroId: number, rid: string): Promise<readonly RecordLabelEntry[]>
  /**
   * The version in force for every `(record, label)` pair that has one, across
   * **every** retrospective — one query for the whole flat records page rather
   * than one per row. Ascending by id, which is the order they were written in.
   */
  listLatestForEachRecord(): Promise<readonly RecordLabelEntry[]>
}
