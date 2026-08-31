import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * `note_id` is UNIQUE: the human's remark on an AI note is one-shot, never a
 * thread (KC-0015). The use case checks first and raises `ConflictError`; this
 * index is what makes the rule true of the file itself.
 */
export const migration: Migration = {
  version: '20260823120500',
  name: 'create_annotations',

  up(db) {
    db.exec(`
      CREATE TABLE annotations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id    INTEGER NOT NULL UNIQUE REFERENCES notes (id),
        session_id INTEGER NOT NULL REFERENCES sessions (id),
        text       TEXT    NOT NULL,
        at         TEXT    NOT NULL
      );
      CREATE INDEX ix_annotations_session ON annotations (session_id, id);

      ${appendOnlyTriggers('annotations', 'the human said it once')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE annotations;')
  },
}
