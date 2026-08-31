import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/** The messages of a thread — append-only for both actors (D4). */
export const migration: Migration = {
  version: '20260823120700',
  name: 'create_comments',

  up(db) {
    db.exec(`
      CREATE TABLE comments (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL REFERENCES comment_threads (id),
        actor     TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
        text      TEXT    NOT NULL,
        at        TEXT    NOT NULL
      );
      CREATE INDEX ix_comments_thread ON comments (thread_id, id);

      ${appendOnlyTriggers('comments', 'what was said was said')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE comments;')
  },
}
