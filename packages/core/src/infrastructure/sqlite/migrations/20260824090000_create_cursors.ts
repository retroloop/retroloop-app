import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * Where a consumer of the outbox has read up to (realtime.md §The tailer).
 *
 * One row per named consumer — today just the server's tailer. It exists so a
 * restart resumes instead of re-emitting history: without it, every server start
 * would replay the whole event log to every open page.
 *
 * No append-only triggers here, and no foreign keys: a cursor is the one thing in
 * the database that is *supposed* to be overwritten, and it points at a position
 * rather than at a row.
 */
export const migration: Migration = {
  version: '20260824090000',
  name: 'create_cursors',

  up(db) {
    db.exec(`
      CREATE TABLE cursors (
        name       TEXT    PRIMARY KEY,
        position   INTEGER NOT NULL CHECK (position >= 0),
        updated_at TEXT    NOT NULL
      );
    `)
  },

  down(db) {
    db.exec('DROP TABLE cursors;')
  },
}
