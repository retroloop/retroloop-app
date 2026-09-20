import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * A label on a record — the human data half of the labels feature, and the half
 * that is append-only.
 *
 * A payload is ruled out by name: label-plus-notes is not standard practice, and
 * usually labels are just labels. So
 * this table has no `refs`, no `note` and no room for one — a definition id, a
 * version and a bit is the whole of what applying a label means. A team wanting
 * the detail beside the classification sets an attribute, which is the second
 * primitive existing for that reason.
 *
 * `applied` is a 0/1 column rather than a status word, on the same standing
 * `thread_resolutions.resolved` has: there are exactly two positions and neither
 * grows a third, because the third thing you might want to say about a record is
 * a different label. `record_lifecycle.status` went the other way and was right
 * to — that enum went from two values to four in short order — and the
 * difference is that a label's two positions are *on* and *off*, which is not a
 * scale anything extends.
 *
 * **Keyed on `(retro_id, rid, label_id, version)`.** The pair addresses a record
 * — a rid is minted per retrospective and is not globally unique
 * (`record.model.ts`) — and the version sequence is dense **per label**, so a
 * record wearing three labels holds three independent v1 rows. That is why the
 * repository's `listForRecord` is ordered by `id`: insertion order is the only
 * order that means anything across three sequences.
 *
 * Human-authored, so the append-only triggers ship in the same migration as the
 * table and no schema version exists in which it is unprotected (migrations.md).
 * There is no `actor` column for the reason there is none on `decisions`: this
 * table has one writer.
 */
export const migration: Migration = {
  version: '20260901090300',
  name: 'create_record_labels',

  up(db) {
    db.exec(`
      CREATE TABLE record_labels (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        label_id INTEGER NOT NULL REFERENCES label_definitions (id),
        version  INTEGER NOT NULL CHECK (version > 0),
        applied  INTEGER NOT NULL CHECK (applied IN (0, 1)),
        at       TEXT    NOT NULL,
        UNIQUE (retro_id, rid, label_id, version)
      );
      CREATE INDEX ix_record_labels_record ON record_labels (retro_id, rid, label_id, version);

      ${appendOnlyTriggers('record_labels', 'removing a label is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE record_labels;')
  },
}
