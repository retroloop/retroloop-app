/**
 * The one number a record is known by across the whole store. Without it a
 * record has no unique id of its own: record ids start again from #1 in every
 * retrospective, and what a reader wants is a global sequence rather than a
 * per-retrospective prefix.
 *
 * A record already had two names and neither of them answers "which record is
 * this" on its own (`record.model.ts`): `rid` is minted per retrospective and
 * repeats across them, and `num` is a position *within* a retrospective, dense
 * from 1, so every retrospective has a record 1. `(retroId, rid)` is the
 * identity, and it is a pair — nobody says a pair out loud.
 *
 * So this is a third name, and the only one of the three the AI does not author.
 * `rid` and `num` are fields of the draft it submits; this is minted by the store
 * the first time a rid appears in a retrospective, and it lives **outside** the
 * revision blob for that reason — see `20260830090000_create_record_ids.ts`,
 * which has the whole argument.
 *
 * **Internal addressing does not change.** Every write, link, testid and lookup
 * in the system still goes by `(retroId, rid)`; this is what a reader is shown
 * and what a reader cites back. `num` stays on every shape that had it — a
 * record's position in its own retrospective is still real data, and the export
 * has carried it since v1 — it simply stops being the number on the page.
 */
export type RecordId = {
  /** 1-based, dense over the whole store, minted once and never moved. */
  readonly id: number
  readonly retroId: number
  readonly rid: string
}

export type NewRecordId = Omit<RecordId, 'id'>
