import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * The label vocabulary — global, user-created, and empty on day one.
 *
 * Usually labels are just labels; to keep the product flexible, no label and no
 * attribute is hardcoded. Adding them requires a settings page, because each
 * label or attribute is a global thing.
 *
 * **This migration inserts nothing**, and that is the whole of "nothing
 * hardcoded". `migrated` is not seeded here, not defaulted anywhere, and not
 * special in any reader: it is only the recurring example, not a value the
 * product ships. A store that has never had a human open the settings page holds
 * zero rows in this table and the label surfaces render nothing at all.
 *
 * **No append-only triggers, which is the departure worth naming.** Nearly every
 * other table in this schema carries them. This one is *configuration* rather
 * than human
 * data: renaming a label is a spelling correction to a shared list, not a second
 * opinion about something somebody said, and versioning it would make every
 * reader of an applied label resolve a name as of a moment. The append-only rule
 * stays exactly where it belongs — on `record_labels`, which is what a human
 * actually wrote — and `retired_at` is what stands in for a delete here, so a
 * name a record was labelled with is readable forever
 * (`label-definition.repository.ts` carries the full argument).
 *
 * `UNIQUE (name)` is the L1 backstop and not the whole rule: it is
 * case-sensitive, and the rule the product enforces is case-**insensitive**, in
 * the use cases, so both stores answer it identically without anyone choosing a
 * collation (`definition.service.ts` §sameName).
 */
export const migration: Migration = {
  version: '20260901090000',
  name: 'create_label_definitions',

  up(db) {
    db.exec(`
      CREATE TABLE label_definitions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        retired_at TEXT,
        created_at TEXT    NOT NULL
      );
    `)
  },

  down(db) {
    db.exec('DROP TABLE label_definitions;')
  },
}
