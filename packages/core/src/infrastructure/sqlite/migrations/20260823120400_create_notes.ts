import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * One table for both authors. The triggers protect every row rather than only the
 * human's, because the mutability matrix (data-model.md) makes AI notes
 * append-only too — a note is a record of what was true at a moment, and neither
 * actor gets to revise it afterwards.
 */
export const migration: Migration = {
  version: '20260823120400',
  name: 'create_notes',

  up(db) {
    db.exec(`
      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions (id),
        author     TEXT    NOT NULL CHECK (author IN ('ai', 'human')),
        kind       TEXT    CHECK (kind IS NULL OR kind IN ('human-cost', 'ai-cost')),
        text       TEXT    NOT NULL,
        at         TEXT    NOT NULL
      );
      CREATE INDEX ix_notes_session ON notes (session_id, id);

      ${appendOnlyTriggers('notes', 'a note records what was true when it was written')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE notes;')
  },
}
