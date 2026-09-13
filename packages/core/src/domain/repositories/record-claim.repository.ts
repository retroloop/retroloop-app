import type { NewRecordClaimEntry, RecordClaimEntry } from '#domain/models/record-claim.model'

/**
 * Append-only, exactly like the lifecycle entries this table sits beside: `add`
 * writes a new version and there is no update or delete on this type. Giving a
 * record back is a row saying so. The table's own triggers reject
 * `UPDATE`/`DELETE` as the L1 backstop, for both authors — immutability is not a
 * property of who writes.
 *
 * **Two reads, not three.** The version in force for one record, which a write
 * numbers itself after and a claim checks against; and the version in force for
 * **every** record, which is what the lane listing folds in one query. There is
 * deliberately no `listForRecord`: a claim's history is real and is kept, and
 * nothing displays it — the rule `thread-resolution.repository.ts` states and
 * `record-lifecycle.repository.ts` names its own exception to when the record
 * page finally read one. A method nothing calls is a method two adapters
 * implement for nothing.
 */
export type RecordClaimRepository = {
  add(entry: NewRecordClaimEntry): Promise<RecordClaimEntry>
  /**
   * The version in force for one record, or `undefined` if nobody has ever
   * claimed it. A **released** claim is an entry like any other and comes back
   * here: it is what the next claim numbers itself after, and reading it as a
   * claim is `effectiveClaim`'s job rather than this one's.
   */
  findLatest(retroId: number, rid: string): Promise<RecordClaimEntry | undefined>
  /**
   * The version in force for every record that has one, across **every**
   * retrospective — one query for a whole lane listing rather than one per row,
   * the standing `record_lifecycle.listLatestForEachRecord` set. Ascending by
   * id, which is the order they were written in.
   */
  listLatestForEachRecord(): Promise<readonly RecordClaimEntry[]>
}
