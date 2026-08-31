import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * `solution_level` is one column holding two shapes — `1`–`5` or a named ceiling
 * (`none`, `upstream`, `undecided`). It is stored as TEXT and mapped back on read,
 * because a TEXT column silently turns the number 2 into the string `'2'` and a
 * type-less column would hide that conversion instead of naming it.
 */
export const migration: Migration = {
  version: '20260823120300',
  name: 'create_decisions',

  up(db) {
    db.exec(`
      CREATE TABLE decisions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id       INTEGER NOT NULL REFERENCES retrospectives (id),
        rid            TEXT    NOT NULL,
        version        INTEGER NOT NULL CHECK (version > 0),
        state          TEXT    NOT NULL
                       CHECK (state IN ('pending', 'approved', 'declined', 'hold')),
        severity       INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
        solution_level TEXT    NOT NULL
                       CHECK (solution_level IN
                              ('1', '2', '3', '4', '5', 'none', 'upstream', 'undecided')),
        involvement    TEXT    NOT NULL
                       CHECK (involvement IN
                              ('autonomous', 'pull-request', 'interactive', 'other', 'undecided')),
        reviewer_note  TEXT,
        revision_n     INTEGER NOT NULL,
        content_hash   TEXT    NOT NULL,
        decided_at     TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );
      CREATE INDEX ix_decisions_retro ON decisions (retro_id, rid, version);

      ${appendOnlyTriggers('decisions', 'a change is a new version, and decline is a state')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE decisions;')
  },
}
