import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The value a record carries for one attribute — the owner's *"external ticket
 * ID"* on the record that went to GitHub.
 *
 * It is `record_labels` with a value where the bit is, and the two differences
 * are the two things attributes exist for:
 *
 * 1. **`value` is nullable, and NULL is the act of clearing.** A record that
 *    once pointed at an issue and no longer does is a different fact from one
 *    that never pointed anywhere, and only a row can hold the first. Clearing is
 *    an append like everything else here, so the reading is "the latest version
 *    has no value", never "the rows are gone".
 * 2. **TEXT for every type.** SQLite has no date and no discriminated column,
 *    and a `number` attribute holding `'42'` is the same fact as one holding
 *    `42`. The type lives on the definition and says what the store will
 *    *accept*; light validation is applied at the boundary
 *    (`definition-input.schema.ts`) and the value is stored verbatim after
 *    trimming, never canonicalised — `007` stays `007`, because nothing here
 *    does arithmetic on one and rewriting a human field to taste is the one
 *    thing this store never does.
 *
 * Keyed on `(retro_id, rid, attribute_id, version)`, with the version sequence
 * dense **per attribute**, exactly as the label table's is per label — so
 * `listForRecord` is ordered by `id` there and here for the same reason.
 *
 * Human-authored: append-only triggers in the same migration, and no `actor`
 * column, because this table has one writer.
 */
export const migration: Migration = {
  version: '20260901090400',
  name: 'create_record_attribute_values',

  up(db) {
    db.exec(`
      CREATE TABLE record_attribute_values (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id     INTEGER NOT NULL REFERENCES retrospectives (id),
        rid          TEXT    NOT NULL,
        attribute_id INTEGER NOT NULL REFERENCES attribute_definitions (id),
        version      INTEGER NOT NULL CHECK (version > 0),
        value        TEXT,
        at           TEXT    NOT NULL,
        UNIQUE (retro_id, rid, attribute_id, version)
      );
      CREATE INDEX ix_record_attribute_values_record
        ON record_attribute_values (retro_id, rid, attribute_id, version);

      ${appendOnlyTriggers('record_attribute_values', 'clearing a value is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE record_attribute_values;')
  },
}
