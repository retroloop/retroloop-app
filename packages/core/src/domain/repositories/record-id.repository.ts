import type { NewRecordId, RecordId } from '#domain/models/record-id.model'

/**
 * Insert-only — stricter than the append-only tables beside it, which take a new
 * *version* of something. There is no version here and nothing to supersede: a
 * record is minted once, and a second row for the same `(retroId, rid)` is not a
 * later opinion, it is two answers to "which record is this". The unique
 * constraint says so at L1 and the triggers say the rest.
 *
 * Four reads, because four shapes of question are actually asked:
 * `findByRecord` for the one-record pages (`records.get`, a verdict's answer),
 * `listByRetro` for everything scoped to a retrospective (the records column, a
 * revision, the export), `listAll` for the flat cross-retro page — which would
 * otherwise be one query per row — and `findById`, which runs the sequence
 * backwards.
 *
 * `findById` was deliberately absent for one session: nothing resolved a record
 * *from* a global id, and a method nothing calls is a method two adapters
 * implement for nothing (`thread-resolution.repository.ts`). The record page
 * (`/records/:id`, session 9) is what calls it. It is the one read whose
 * argument is the number a **human** typed or followed rather than a pair the
 * product was already holding, which is why it is the only one that can be
 * asked about a record that does not exist — and it answers `undefined` rather
 * than throwing, like every other miss on this layer.
 */
export type RecordIdRepository = {
  /**
   * Mints the number for a record that has none. The caller is
   * `CreateRevisionUseCase`, which knows which rids are new to the
   * retrospective; a rid that already has a row is not passed here at all,
   * because minting it again would be the store contradicting itself rather
   * than an idempotent no-op.
   */
  add(entry: NewRecordId): Promise<RecordId>
  findByRecord(retroId: number, rid: string): Promise<RecordId | undefined>
  /**
   * The pair a global number stands for — the resolver behind `/records/:id`.
   *
   * The number is dense over the whole store and minted once, so this is a
   * lookup rather than a search: it either names a record or names nothing.
   */
  findById(id: number): Promise<RecordId | undefined>
  /** Ascending by id, which for one retrospective is first-appearance order. */
  listByRetro(retroId: number): Promise<readonly RecordId[]>
  /** Every record of every retrospective, ascending by id — the whole sequence. */
  listAll(): Promise<readonly RecordId[]>
}
