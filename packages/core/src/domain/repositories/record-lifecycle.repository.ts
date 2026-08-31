import type {
  NewRecordLifecycleEntry,
  RecordLifecycleEntry,
} from '#domain/models/record-lifecycle.model'

/**
 * Append-only, exactly like decisions, holds and thread resolutions: `add`
 * writes a new version and there is no update or delete on this type. The
 * table's own triggers reject `UPDATE`/`DELETE` as the L1 backstop, for both
 * authors — immutability is not a property of who wrote the row.
 *
 * Three reads, because the product asks in three shapes: the version in force
 * for one record, which is what a write numbers itself after; the version in
 * force for **every** record, which is the flat cross-retro listing; and one
 * record's **whole history**, which is the record page's timeline.
 *
 * That third one was deliberately absent for one session, on the rule a method
 * nothing calls is a method two adapters implement for nothing
 * (`thread-resolution.repository.ts`) — nothing showed a record's lifecycle
 * history. The record page does (`/records/:id`, session 9: *"We can have a
 * timeline at the bottom that shows how the record evolved"*), and it is the
 * reason this table is append-only in the first place: "resolved on the 29th
 * citing abc123, archived on the 30th" was always readable, and until now
 * nothing read it. There is still no `listByRetro` — no surface asks a
 * retrospective for every record's history at once.
 */
export type RecordLifecycleRepository = {
  add(entry: NewRecordLifecycleEntry): Promise<RecordLifecycleEntry>
  /** The version in force for one record, or `undefined` if it never had one. */
  findLatest(retroId: number, rid: string): Promise<RecordLifecycleEntry | undefined>
  /**
   * Every entry ever written about one record, **oldest first** — by `version`,
   * which is dense per `(retroId, rid)` and is the order the acts were taken
   * in. Empty for a record nobody has touched, which is most of them.
   */
  listForRecord(retroId: number, rid: string): Promise<readonly RecordLifecycleEntry[]>
  /**
   * The version in force for every record that has one, across **every**
   * retrospective — one query for the whole `records.listAll` page rather than
   * one per record. Ascending by id, which is the order they were written in.
   */
  listLatestForEachRecord(): Promise<readonly RecordLifecycleEntry[]>
}
