import type { LabelDefinition, NewLabelDefinition } from '#domain/models/label.model'

/**
 * **The one repository pair in this schema that is not append-only**, and the
 * reason is worth stating where a reader meets it.
 *
 * Every other mutable-looking thing in this store is human data — a verdict, a
 * comment, a resolution — and human data is versioned and never rewritten (D4).
 * A definition is not that: it is *configuration*, the vocabulary the human data
 * is written in. Renaming a label is not a second opinion about what somebody
 * once said, it is a spelling correction to a shared list, and versioning it
 * would make every reader of an applied label resolve a name as of a moment.
 *
 * The append-only rule is kept exactly where it belongs — on the **applications**
 * (`record_labels`, `record_attribute_values`), which are the human data — and
 * `retire` is what stands in for a delete here: nothing is ever removed from this
 * table, so a name a record was labelled with is readable forever.
 *
 * `retire` and `rename` are two methods rather than one `update`, because they
 * are two acts with two events and a caller that meant one of them should not be
 * able to do the other by leaving a field out. `unretire` is a third for the same
 * reason — it is its own act with its own event, and a `retire(id, undefined)`
 * would be one method a caller could take either way by accident.
 */
export type LabelDefinitionRepository = {
  add(definition: NewLabelDefinition): Promise<LabelDefinition>
  /** Changes the name and nothing else. */
  rename(id: number, name: string): Promise<LabelDefinition>
  /** Stamps `retiredAt`. Never a delete: applied history keeps rendering by name. */
  retire(id: number, at: string): Promise<LabelDefinition>
  /**
   * Clears `retiredAt` — the label is offered again.
   *
   * **It takes no timestamp**, and that asymmetry with `retire` is the point:
   * the column answers "when did this stop being offered", and a definition
   * that is offered again has no such moment. When it *came back* is the
   * outbox's to say (`LabelUnretired`), where every other act's history lives —
   * the row holds the current answer, and nothing here was ever a log.
   *
   * **The name was never freed and is not freed now**, so bringing one back can
   * never collide with anything: a retired name stays taken exactly so a second
   * definition cannot reuse it (`definition.service.ts`).
   */
  unretire(id: number): Promise<LabelDefinition>
  findById(id: number): Promise<LabelDefinition | undefined>
  /**
   * Every definition there is, **retired ones included**, in minting order.
   *
   * One read rather than an offerable/retired pair, because every caller wants
   * both halves and wants them together: the settings page lists the retired
   * ones greyed, a record page resolves a name for a label that may since have
   * been retired, and the uniqueness check has to see a retired name or a
   * rename could collide with one. Filtering is the reader's, over a list it
   * already holds — there are tens of these, not thousands.
   *
   * Minting order — `id` ascending — rather than by name, because it is the one
   * order both stores answer identically without anyone choosing a collation.
   */
  listAll(): Promise<readonly LabelDefinition[]>
}
