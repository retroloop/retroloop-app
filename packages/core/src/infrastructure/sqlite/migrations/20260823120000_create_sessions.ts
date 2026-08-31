import type { Migration } from '#infrastructure/sqlite/migration'

export const migration: Migration = {
  version: '20260823120000',
  name: 'create_sessions',

  up(db) {
    db.exec(`
      CREATE TABLE sessions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        claude_session TEXT    NOT NULL UNIQUE,
        project        TEXT    NOT NULL,
        cwd            TEXT    NOT NULL,
        branch         TEXT,
        supervised     INTEGER NOT NULL CHECK (supervised IN (0, 1)),
        started_at     TEXT    NOT NULL
      );
      CREATE INDEX ix_sessions_project ON sessions (project, id);
    `)
  },

  down(db) {
    db.exec('DROP TABLE sessions;')
  },
}
