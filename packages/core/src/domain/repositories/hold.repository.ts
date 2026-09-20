import type { Hold, NewHold } from '#domain/models/hold.model'

/**
 * Human-authored and append-only, exactly like decisions: `add` writes a new
 * version and there is no update or delete on this type. The table's own
 * triggers reject `UPDATE`/`DELETE` as the L1 backstop.
 *
 * There is no `listLatestForEachRetro` here, and that is not an omission: no
 * read model in the product asks "what is held everywhere". The cross-retro view
 * of held items is `r-held-items-view`, which is parked — and a method
 * nothing calls is a method every adapter has to implement twice.
 */
export type HoldRepository = {
  add(hold: NewHold): Promise<Hold>
  /** The version in force for the record, or `undefined` if it was never held. */
  findLatest(retroId: number, rid: string): Promise<Hold | undefined>
  /** Every version for one record, ascending — why it was parked, and when it was let go. */
  listForRecord(retroId: number, rid: string): Promise<readonly Hold[]>
  /** The version in force for every record of the retrospective that has one. */
  listLatestByRetro(retroId: number): Promise<readonly Hold[]>
}
