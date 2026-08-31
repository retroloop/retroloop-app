import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The schema learns the owner's multi-solution record: a comment can be filed on
 * the solutions block, and a decision records which solution the human picked.
 *
 * Both are CHECK/column changes SQLite cannot make in place, so both are the
 * rebuild pattern (migrations.md §SQLite rebuild pattern), and they ride in one
 * migration because they are one change: a record that proposes solutions is a
 * record whose reviewer selects one and comments on the block.
 *
 * Four things about it are deliberate.
 *
 * - **The section CHECK is widened, never narrowed.** `direction` and
 *   `footprint` stay in the list they have always been in. The owner's store
 *   carries two threads and four comments anchored to them, human data is
 *   append-only, and the export requires a component for every thread — a
 *   migration that dropped either value would make those rows unwritable
 *   half-way through this rebuild and the documents already exported
 *   unrepresentable. Nothing anchors a *new* thread to them, because a record
 *   with solutions has no such section; that is the write path narrowing, and it
 *   is not this table's job.
 * - **`defer_foreign_keys`, not `foreign_keys = OFF`.** `comments` and
 *   `thread_resolutions` both point at `comment_threads`, and `DROP TABLE` under
 *   enforced keys performs an implicit `DELETE` that would violate them. Turning
 *   enforcement off is a no-op inside a transaction, which is exactly where the
 *   migrator runs this; deferring it to `COMMIT` is not, and by then every row is
 *   back under the same ids (the `sessions_project_optional` precedent).
 * - **`selected_solution` is nullable, and stays nullable.** Every decision
 *   written before this migration was made on a record that proposed no
 *   solutions, so there is no value to backfill and no honest default: NULL is
 *   the answer "this reviewer was never asked". Additive-first (migrations.md).
 * - **The decisions triggers are recreated with the table.** `DROP TABLE` takes
 *   its triggers with it, and the append-only backstop of the actor model may
 *   not be absent from any schema version (architecture.md §Actor model), so
 *   they go back before the rows do. `comment_threads` has none to recreate — a
 *   thread is an anchor, and what is append-only is what is written under it.
 */
export const migration: Migration = {
  version: '20260828090000',
  name: 'solutions_anchor_and_selection',

  up(db) {
    db.exec(`
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE comment_threads_rebuild (
        id        INTEGER PRIMARY KEY,
        retro_id  INTEGER NOT NULL,
        rid       TEXT,
        section   TEXT,
        opened_at TEXT NOT NULL
      );
      INSERT INTO comment_threads_rebuild
        SELECT id, retro_id, rid, section, opened_at FROM comment_threads;
      DROP TABLE comment_threads;

      CREATE TABLE comment_threads (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id  INTEGER NOT NULL REFERENCES retrospectives (id),
        rid       TEXT,
        section   TEXT CHECK (section IS NULL OR section IN
                    ('title', 'problem', 'human_words', 'root_cause',
                     'workaround', 'direction', 'footprint', 'solutions', 'defaults')),
        opened_at TEXT NOT NULL,
        CHECK ((rid IS NULL) = (section IS NULL))
      );
      INSERT INTO comment_threads
        SELECT id, retro_id, rid, section, opened_at FROM comment_threads_rebuild;
      DROP TABLE comment_threads_rebuild;

      CREATE UNIQUE INDEX ux_comment_threads_anchor
        ON comment_threads (retro_id, rid, section) WHERE rid IS NOT NULL;
      CREATE INDEX ix_comment_threads_retro ON comment_threads (retro_id, id);

      CREATE TABLE decisions_rebuild (
        id                INTEGER PRIMARY KEY,
        retro_id          INTEGER NOT NULL,
        rid               TEXT    NOT NULL,
        version           INTEGER NOT NULL,
        state             TEXT    NOT NULL,
        severity          INTEGER NOT NULL,
        solution_level    TEXT    NOT NULL,
        selected_solution INTEGER,
        involvement       TEXT    NOT NULL,
        reviewer_note     TEXT,
        revision_n        INTEGER NOT NULL,
        content_hash      TEXT    NOT NULL,
        decided_at        TEXT    NOT NULL
      );
      INSERT INTO decisions_rebuild
        SELECT id, retro_id, rid, version, state, severity, solution_level, NULL,
               involvement, reviewer_note, revision_n, content_hash, decided_at
        FROM decisions;
      DROP TABLE decisions;

      CREATE TABLE decisions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id          INTEGER NOT NULL REFERENCES retrospectives (id),
        rid               TEXT    NOT NULL,
        version           INTEGER NOT NULL CHECK (version > 0),
        state             TEXT    NOT NULL
                          CHECK (state IN ('pending', 'approved', 'declined', 'revise', 'hold')),
        severity          INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
        solution_level    TEXT    NOT NULL
                          CHECK (solution_level IN
                                 ('1', '2', '3', '4', '5', 'none', 'upstream', 'undecided')),
        selected_solution INTEGER CHECK (selected_solution IS NULL OR selected_solution > 0),
        involvement       TEXT    NOT NULL
                          CHECK (involvement IN
                                 ('autonomous', 'pull-request', 'interactive', 'other', 'undecided')),
        reviewer_note     TEXT,
        revision_n        INTEGER NOT NULL,
        content_hash      TEXT    NOT NULL,
        decided_at        TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );
      CREATE INDEX ix_decisions_retro ON decisions (retro_id, rid, version);

      ${appendOnlyTriggers('decisions', 'a change is a new version, and decline is a state')}

      INSERT INTO decisions SELECT * FROM decisions_rebuild;
      DROP TABLE decisions_rebuild;
    `)
  },

  /**
   * Back to the schema this found, verbatim: the eight-value section CHECK and a
   * decisions table with no selection column.
   *
   * A thread anchored to `solutions` cannot survive it, and neither can the
   * selection on any decision — which is what a reversal of this migration
   * means. As always, `down` is the development and test affordance that proves
   * `up` said everything it does; production undoes a batch by restoring its
   * snapshot (migrations.md).
   */
  down(db) {
    db.exec(`
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE comment_threads_rebuild (
        id        INTEGER PRIMARY KEY,
        retro_id  INTEGER NOT NULL,
        rid       TEXT,
        section   TEXT,
        opened_at TEXT NOT NULL
      );
      INSERT INTO comment_threads_rebuild
        SELECT id, retro_id, rid, section, opened_at FROM comment_threads;
      DROP TABLE comment_threads;

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
      INSERT INTO comment_threads
        SELECT id, retro_id, rid, section, opened_at FROM comment_threads_rebuild;
      DROP TABLE comment_threads_rebuild;

      CREATE UNIQUE INDEX ux_comment_threads_anchor
        ON comment_threads (retro_id, rid, section) WHERE rid IS NOT NULL;
      CREATE INDEX ix_comment_threads_retro ON comment_threads (retro_id, id);

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
      INSERT INTO decisions_rebuild
        SELECT id, retro_id, rid, version, state, severity, solution_level,
               involvement, reviewer_note, revision_n, content_hash, decided_at
        FROM decisions;
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
}
