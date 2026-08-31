import type {
  NewRecordRelationEntry,
  RecordRelationEntry,
} from '#domain/models/record-relation.model'

/**
 * Append-only, exactly like the label entries this table copies its shape from:
 * `add` writes a new version and there is no update or delete on this type.
 * Taking two records apart is a row saying so.
 *
 * Two reads, because the product asks in the same two shapes labels are asked
 * in — one record's whole history, which a record page and a write both need,
 * and the entry in force for every pair, which is what a listing folds. There is
 * no `listForRetro`: a relation is not scoped to a retrospective at all — it is
 * the one thing in this store that deliberately crosses them — so there is no
 * retrospective to ask.
 */
export type RecordRelationRepository = {
  add(entry: NewRecordRelationEntry): Promise<RecordRelationEntry>
  /**
   * Every entry ever written with this record on **either** side, oldest first
   * by `id`. This is what *"the relation reads from both sides"* means at the
   * storage layer: one query over two columns, and the caller reads the
   * direction off which column matched.
   *
   * `id` rather than `version` for the reason `record_labels.listForRecord`
   * gives: versions are dense **per ordered pair**, so a record holding four
   * relations holds four independent `version: 1` rows and ordering by version
   * would interleave four histories into nonsense. Insertion order is the order
   * the acts were taken in.
   *
   * The caller folds it through `relationsInForce`, so a record page and a write
   * can never disagree about what a record is related to.
   */
  listForRecord(recordId: number): Promise<readonly RecordRelationEntry[]>
  /**
   * The version in force for every ordered pair that has one, across the whole
   * store — one query for a whole listing rather than one per row, which is the
   * standing `record_lifecycle.listLatestForEachRecord` set and the reason
   * `ListRecordsUseCase` can carry relations at all. Ascending by `id`, the order
   * they were written in.
   */
  listLatestForEachPair(): Promise<readonly RecordRelationEntry[]>
}
