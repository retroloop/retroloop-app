/**
 * A label applied to a record, or taken off it.
 *
 * **This is the whole of what applying a label means** — which record, which
 * definition, and whether it is on. There is no note here and no reference,
 * because the owner ruled the payload out by name: *"I don't like the idea of
 * label + notes; that is not a standard practice. Usually labels are just
 * labels."* A team that wants the detail beside the classification creates an
 * attribute and sets it, which is the second primitive existing for exactly that
 * reason.
 *
 * **Human-only this session.** Applying a label and setting an attribute value
 * are the human's, regardless of the AI-config-write toggle — that toggle
 * governs the *definitions* (`setting.model.ts`), and whether the AI may ever
 * suggest a label on its own draft is one of the opens the owner's ruling did
 * not reach. So this is a human field with everything that implies: the use case
 * refuses the `ai` actor before it reads anything, the table's append-only
 * triggers back that up at L1, and there is **no `actor` column** because the
 * table is single-writer and the author is implied by it.
 *
 * Keyed on `(retroId, rid, labelId)`, because `(retroId, rid)` is what addresses
 * a record anywhere in this system — a rid is minted per retrospective and is
 * not globally unique (`record.model.ts`).
 */
export type RecordLabelEntry = {
  readonly id: number
  readonly retroId: number
  readonly rid: string
  readonly labelId: number
  /** 1-based, dense per `(retroId, rid, labelId)`. The highest version is the one in force. */
  readonly version: number
  /**
   * `true` applies it, `false` takes it off. **Removing is a row, never a
   * delete** — the same rule an undone verdict and a reopened thread obey, so
   * "labelled migrated at 14:02, unlabelled at 09:30 the next morning" stays
   * readable forever.
   *
   * A 0/1 column rather than a status word, because there are exactly two
   * positions and neither will grow a third: the third thing you might want to
   * say about a record is a different label, or an attribute.
   */
  readonly applied: boolean
  readonly at: string
}

export type NewRecordLabelEntry = Omit<RecordLabelEntry, 'id'>
