import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The decisions table learns the third verdict (retro 4 `r-verdict-revise`).
 *
 * `state` carries a CHECK constraint, and SQLite cannot alter one in place, so
 * this is the rebuild pattern (migrations.md §SQLite rebuild pattern). Two
 * things about it are deliberate:
 *
 * - **The old CHECK is widened, never narrowed.** `hold` stays in the list it
 *   has always been in: human data is append-only and the owner's store holds
 *   rows carrying it. A migration that dropped a value would make existing rows
 *   unwritable back into their own table half-way through this rebuild.
 * - **The triggers are recreated with the table.** `DROP TABLE` takes its
 *   triggers with it, and the append-only backstop of the actor model may not
 *   be absent from any schema version (architecture.md §Actor model) — so they
 *   are re-created in the same statement, before the rows go back in.
 */
export const migration: Migration = {
  version: '20260826090000',
  name: 'decisions_allow_revise',

  up(db) {
    db.exec(`
      CREATE TABLE decisions_rebuild (
        id             INTEGER PRIMARY KEY,
        retro_id       INTEGER NOT NULL,
        rid            TEXT    NOT NULL,
        version        INTEGER NOT NULL,
        state          TEXT    NOT NULL,
        severity       INTEGER NOT NULL,
        solution_level TEXT    NOT NULL,
        involvement    TEXT    NOT NULL,
        reviewer_note  TEXT,
        revision_n     INTEGER NOT NULL,
        content_hash   TEXT    NOT NULL,
        decided_at     TEXT    NOT NULL
      );
      INSERT INTO decisions_rebuild SELECT * FROM decisions;
      DROP TABLE decisions;

      CREATE TABLE decisions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id       INTEGER NOT NULL REFERENCES retrospectives (id),
        rid            TEXT    NOT NULL,
        version        INTEGER NOT NULL CHECK (version > 0),
        state          TEXT    NOT NULL
                       CHECK (state IN ('pending', 'approved', 'declined', 'revise', 'hold')),
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

      INSERT INTO decisions SELECT * FROM decisions_rebuild;
      DROP TABLE decisions_rebuild;
    `)
  },

  /**
   * Back to the four-value CHECK, verbatim. A record decided `revise` cannot
   * survive it — that is the constraint being restored — so, as always, `down`
   * is a development and test affordance and production undoes a batch by
   * restoring its snapshot (migrations.md).
   */
  down(db) {
    db.exec(`
      CREATE TABLE decisions_rebuild (
        id             INTEGER PRIMARY KEY,
        retro_id       INTEGER NOT NULL,
        rid            TEXT    NOT NULL,
        version        INTEGER NOT NULL,
        state          TEXT    NOT NULL,
        severity       INTEGER NOT NULL,
        solution_level TEXT    NOT NULL,
        involvement    TEXT    NOT NULL,
        reviewer_note  TEXT,
        revision_n     INTEGER NOT NULL,
        content_hash   TEXT    NOT NULL,
        decided_at     TEXT    NOT NULL
      );
      INSERT INTO decisions_rebuild SELECT * FROM decisions;
      DROP TABLE decisions;

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

      INSERT INTO decisions SELECT * FROM decisions_rebuild;
      DROP TABLE decisions_rebuild;
    `)
  },
}
