import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * A thread is anchored to one section of one record, or to the review itself.
 * The partial unique index enforces "one thread per section per record" — what
 * `findByAnchor` relies on — while leaving a retrospective free to carry many
 * review-level threads, which have neither `rid` nor `section`.
 */
export const migration: Migration = {
  version: '20260823120600',
  name: 'create_comment_threads',

  up(db) {
    db.exec(`
      CREATE TABLE comment_threads (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id  INTEGER NOT NULL REFERENCES retrospectives (id),
        rid       TEXT,
        section   TEXT CHECK (section IS NULL OR section IN
                    ('title', 'problem', 'human_words', 'root_cause',
                     'workaround', 'direction', 'footprint', 'defaults')),
        opened_at TEXT NOT NULL,
        CHECK ((rid IS NULL) = (section IS NULL))
      );
      CREATE UNIQUE INDEX ux_comment_threads_anchor
        ON comment_threads (retro_id, rid, section) WHERE rid IS NOT NULL;
      CREATE INDEX ix_comment_threads_retro ON comment_threads (retro_id, id);
    `)
  },

  down(db) {
    db.exec('DROP TABLE comment_threads;')
  },
}
