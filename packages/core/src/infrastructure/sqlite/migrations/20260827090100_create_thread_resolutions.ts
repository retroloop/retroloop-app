import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * A thread can be marked resolved, and only the human may mark it
 * (`r-resolvable-comments`, owner-approved).
 *
 * His words: *"only the human should be able to mark it, not the AI"*, and this
 * session: *"User and only the user should be able to mark comments as resolved;
 * Resolved comments should appear collapsed."* So this is a human field, and it
 * obeys every rule a human field obeys — which is why it is a table of versions
 * rather than a column on `comment_threads`: **unresolving is a new row, never an
 * edit**, exactly as a release is a new `holds` row and an undone verdict is a
 * new `decisions` row. "Resolved at 14:02, reopened at 14:40" stays readable
 * forever.
 *
 * `resolved` is stored as 0/1 rather than as a `'resolved' | 'open'` string,
 * because there are exactly two values and neither will grow a third — the same
 * choice `holds.held` made for the same reason.
 *
 * Human-authored, so the append-only triggers ship in the same migration as the
 * table: no schema version ever exists in which it is unprotected
 * (migrations.md).
 *
 * The grain is the **thread**, not the message. The panel the owner is asking
 * for shows top-level comments, and a top-level comment is a thread; resolving
 * one message of a conversation and leaving the rest is not a thing he asked
 * for, and a grain nobody needs is a grain every reader has to fold away.
 */
export const migration: Migration = {
  version: '20260827090100',
  name: 'create_thread_resolutions',

  up(db) {
    db.exec(`
      CREATE TABLE thread_resolutions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL REFERENCES comment_threads (id),
        version   INTEGER NOT NULL CHECK (version > 0),
        resolved  INTEGER NOT NULL CHECK (resolved IN (0, 1)),
        at        TEXT    NOT NULL,
        UNIQUE (thread_id, version)
      );
      CREATE INDEX ix_thread_resolutions_thread ON thread_resolutions (thread_id, version);

      ${appendOnlyTriggers('thread_resolutions', 'reopening a thread is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE thread_resolutions;')
  },
}
