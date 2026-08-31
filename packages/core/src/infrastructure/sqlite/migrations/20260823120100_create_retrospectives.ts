import type { Migration } from '#infrastructure/sqlite/migration'

export const migration: Migration = {
  version: '20260823120100',
  name: 'create_retrospectives',

  up(db) {
    db.exec(`
      CREATE TABLE retrospectives (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions (id),
        state      TEXT    NOT NULL CHECK (state IN ('open', 'reviewing', 'finished')),
        started_at TEXT    NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX ix_retrospectives_session ON retrospectives (session_id, id);
    `)
  },

  down(db) {
    db.exec('DROP TABLE retrospectives;')
  },
}
