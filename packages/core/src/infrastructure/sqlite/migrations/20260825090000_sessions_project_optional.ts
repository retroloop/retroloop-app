import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * `sessions.project` becomes nullable: a project routinely holds several
 * software packages, so it was the wrong unit, and nothing routes, groups or
 * filters by it any more. `cwd` is the identity anchor instead.
 *
 * SQLite cannot drop a NOT NULL, so this is the rebuild pattern
 * (migrations.md §SQLite rebuild pattern) — with two deliberate choices:
 *
 * - **`defer_foreign_keys`, not `foreign_keys = OFF`.** `retrospectives`,
 *   `notes` and `annotations` all point at `sessions`, and `DROP TABLE` under
 *   enforced keys performs an implicit `DELETE` that would violate them. Turning
 *   enforcement *off* is a no-op inside a transaction, which is exactly where
 *   the migrator runs this; deferring it to `COMMIT` is not, and by then every
 *   row is back under the same ids.
 * - **A holder table and a literal `CREATE TABLE sessions`, not a rename.**
 *   `ALTER TABLE ... RENAME TO` rewrites the stored DDL with the table name
 *   quoted, so `up → down → up` could never return the schema to the text it
 *   started with — and that round-trip is the only proof a migration says
 *   everything it does.
 *
 * The index survives the rebuild because `session list --project` still filters
 * on the column for whoever passes it; what is gone is any obligation to.
 */
export const migration: Migration = {
  version: '20260825090000',
  name: 'sessions_project_optional',

  up(db) {
    db.exec(`
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE sessions_rebuild (
        id             INTEGER PRIMARY KEY,
        claude_session TEXT    NOT NULL,
        project        TEXT,
        cwd            TEXT    NOT NULL,
        branch         TEXT,
        supervised     INTEGER NOT NULL,
        started_at     TEXT    NOT NULL
      );
      INSERT INTO sessions_rebuild
        SELECT id, claude_session, project, cwd, branch, supervised, started_at FROM sessions;
      DROP TABLE sessions;

      CREATE TABLE sessions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        claude_session TEXT    NOT NULL UNIQUE,
        project        TEXT,
        cwd            TEXT    NOT NULL,
        branch         TEXT,
        supervised     INTEGER NOT NULL CHECK (supervised IN (0, 1)),
        started_at     TEXT    NOT NULL
      );
      INSERT INTO sessions
        SELECT id, claude_session, project, cwd, branch, supervised, started_at FROM sessions_rebuild;
      DROP TABLE sessions_rebuild;

      CREATE INDEX ix_sessions_project ON sessions (project, id);
    `)
  },

  /**
   * The reverse rebuild, back to the original DDL verbatim. A session registered
   * without a project cannot survive it — `NOT NULL` is what it is restoring —
   * so this is a development and test affordance, as `down` always is
   * (migrations.md): production undoes a batch by restoring its snapshot.
   */
  down(db) {
    db.exec(`
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE sessions_rebuild (
        id             INTEGER PRIMARY KEY,
        claude_session TEXT    NOT NULL,
        project        TEXT    NOT NULL,
        cwd            TEXT    NOT NULL,
        branch         TEXT,
        supervised     INTEGER NOT NULL,
        started_at     TEXT    NOT NULL
      );
      INSERT INTO sessions_rebuild
        SELECT id, claude_session, project, cwd, branch, supervised, started_at FROM sessions;
      DROP TABLE sessions;

      CREATE TABLE sessions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        claude_session TEXT    NOT NULL UNIQUE,
        project        TEXT    NOT NULL,
        cwd            TEXT    NOT NULL,
        branch         TEXT,
        supervised     INTEGER NOT NULL CHECK (supervised IN (0, 1)),
        started_at     TEXT    NOT NULL
      );
      INSERT INTO sessions
        SELECT id, claude_session, project, cwd, branch, supervised, started_at FROM sessions_rebuild;
      DROP TABLE sessions_rebuild;

      CREATE INDEX ix_sessions_project ON sessions (project, id);
    `)
  },
}
