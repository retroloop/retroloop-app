/**
 * A label — **a name, applied or not, and nothing else.**
 *
 * The owner ruled this shape himself after rejecting the AI proposal that would
 * have hung refs and a note off the apply event
 * (the labels/attributes owner ruling, private project records):
 *
 * > *"I don't like the idea of label + notes; that is not a standard practice.
 * > Usually labels are just labels. A user can create their own conventions if
 * > we support labels as well as attributes — they can have a convention that
 * > whenever we add the migrated label, we should also have an attribute that
 * > requires a GitHub issue id, or something like that. However, to keep it
 * > flexible we will not hardcode any labels or attributes."*
 *
 * Three consequences, each of them a thing this file deliberately does not have:
 *
 * 1. **No payload on the apply.** `record-label.model.ts` carries a definition
 *    id, a version and a bit, and that is the whole of what applying a label
 *    means. A label that could carry a reference would be an attribute wearing
 *    a label's name.
 * 2. **No pairing with anything.** A team that decides `migrated` always travels
 *    with an `external issue id` attribute is a team with a convention; the
 *    system never checks one, never offers one, and never refuses a record for
 *    lacking one — *"composition is the USER'S convention … never a system
 *    mechanism"*.
 * 3. **Nothing is shipped.** The product starts with zero labels and zero
 *    attributes and `migrated` is not special anywhere — not in a migration, not
 *    in a seed, not in a component. Everything a store holds, somebody created.
 *
 * **Global**, which is what made a settings page part of this scope: a label is
 * not scoped to a retrospective, a session or a working directory, so the one
 * surface that manages the vocabulary is `/settings` (his *"adding those will
 * require setting up a settings page, because each label or attribute is going
 * to be a global thing"*).
 */
export type LabelDefinition = {
  readonly id: number
  /**
   * What it is called, trimmed, as somebody typed it.
   *
   * The name is the label — there is no slug, no colour and no description
   * beside it, because each of those would be configuration the owner asked us
   * not to grow (*"minimal config"*). Case is preserved as typed and
   * **uniqueness ignores it**, so a store cannot end up holding `Migrated` and
   * `migrated` as two labels a reader cannot tell apart. That rule lives in the
   * use cases rather than in a collation, so both stores answer it identically
   * (`definition.service.ts`).
   */
  readonly name: string
  /**
   * When it was retired, or `undefined` while it is still offerable.
   *
   * **Retire, not delete**, on the same doctrine `decline is a state, not a
   * deletion` states one table over: a record that already wears this label goes
   * on wearing it, and the label goes on rendering by name wherever it was
   * applied. What retiring stops is the *offering* — a retired label is not on
   * the list of labels anybody can apply next.
   *
   * A timestamp rather than a bit, because "when did this stop being offered" is
   * the question anyone reading an old record will actually have, and a bit
   * cannot answer it. It is the one field on a definition that is mutable, which
   * is why definitions are an ordinary table rather than an append-only one —
   * see `20260901090000_create_label_definitions.ts`.
   */
  readonly retiredAt: string | undefined
  readonly createdAt: string
}

export type NewLabelDefinition = Omit<LabelDefinition, 'id'>
