import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * A revision's records are stored as one JSON document rather than a child table.
 *
 * The domain treats a revision as an immutable draft that is always read whole —
 * there is no query that wants half of one — and record identity lives inside the
 * retrospective, not in a row id. Keeping the narrative in one column makes the
 * immutability guarantee physical: there is no per-record row for anything to
 * update.
 *
 * The triggers carry that the last step of the way. "Revisions are immutable"
 * (D4) is as hard an invariant as anything the human authors, and the AI is the
 * one actor with a reason to want to fix up a draft it already submitted — so the
 * database refuses, whoever asks and however they connect.
 */
export const migration: Migration = {
  version: '20260823120200',
  name: 'create_revisions',

  up(db) {
    db.exec(`
      CREATE TABLE revisions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id   INTEGER NOT NULL REFERENCES retrospectives (id),
        n          INTEGER NOT NULL CHECK (n > 0),
        created_at TEXT    NOT NULL,
        records    TEXT    NOT NULL CHECK (json_valid(records)),
        UNIQUE (retro_id, n)
      );

      ${appendOnlyTriggers('revisions', 'feedback produces revision n+1, never an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE revisions;')
  },
}
