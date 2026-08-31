import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * Requests carry no append-only triggers: `state` moves `open → closed` when the
 * human closes one, and that is an update. Nothing is lost by it — the responses
 * live in their own table and closing only stamps `closed_at`.
 */
export const migration: Migration = {
  version: '20260823120800',
  name: 'create_requests',

  up(db) {
    db.exec(`
      CREATE TABLE requests (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id  INTEGER NOT NULL REFERENCES retrospectives (id),
        text      TEXT    NOT NULL,
        state     TEXT    NOT NULL CHECK (state IN ('open', 'closed')),
        opened_at TEXT    NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX ix_requests_retro ON requests (retro_id, id);
    `)
  },

  down(db) {
    db.exec('DROP TABLE requests;')
  },
}
