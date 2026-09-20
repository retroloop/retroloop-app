import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The lifecycle table learns the archive pair: a record can be given the
 * archived status and the user can unarchive it again. By default every other
 * approved record is a normal record, which a user may simply archive whenever
 * they want to.
 *
 * **The table's own header predicted this migration and got one detail wrong.**
 * `20260829093000_create_record_lifecycle.ts` argued for TEXT over a 0/1 column
 * because *"a widened CHECK is a one-line migration; unpicking a boolean is a
 * rebuild"*. The first half is not true of SQLite: a CHECK cannot be altered in
 * place at all, so widening one is the same rebuild `20260826090000_decisions_
 * allow_revise.ts` does — which is what this file is. The argument still holds
 * where it counts, because a rebuild that widens an enum keeps every row, and
 * unpicking a boolean would have had to invent values for rows already written.
 *
 * The rebuild's two standing rules, both from that precedent:
 *
 * - **The old CHECK is widened, never narrowed.** `resolved` and `reopened` stay
 *   exactly as they are; a migration that dropped either would make existing
 *   rows unwritable back into their own table half-way through this rebuild.
 * - **The triggers are recreated with the table.** `DROP TABLE` takes its
 *   triggers with it, and the append-only backstop may not be absent from any
 *   schema version (architecture.md §Actor model) — so they go back in the same
 *   statement, before the rows do.
 *
 * **Nothing is backfilled, and there is no archive row to backfill.** A declined
 * record reads as archived by *derivation* (`record-lifecycle.service.ts`), so a
 * store closed long before this migration answers exactly as one closed after
 * it, and unarchiving such a record writes version 1 like any other first act.
 * Writing rows here would have been this schema's first inference, and it would
 * have had to invent an actor and a moment for a decision somebody else made.
 */
export const migration: Migration = {
  version: '20260831090000',
  name: 'record_lifecycle_allow_archive',

  up(db) {
    db.exec(`
      CREATE TABLE record_lifecycle_rebuild (
        id       INTEGER PRIMARY KEY,
        retro_id INTEGER NOT NULL,
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL,
        status   TEXT    NOT NULL,
        refs     TEXT    NOT NULL,
        note     TEXT,
        actor    TEXT    NOT NULL,
        at       TEXT    NOT NULL
      );
      INSERT INTO record_lifecycle_rebuild SELECT * FROM record_lifecycle;
      DROP TABLE record_lifecycle;

      CREATE TABLE record_lifecycle (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL CHECK (version > 0),
        status   TEXT    NOT NULL
                 CHECK (status IN ('resolved', 'reopened', 'archived', 'unarchived')),
        refs     TEXT    NOT NULL CHECK (json_valid(refs)),
        note     TEXT,
        actor    TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
        at       TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );
      CREATE INDEX ix_record_lifecycle_record ON record_lifecycle (retro_id, rid, version);

      ${appendOnlyTriggers('record_lifecycle', 'reopening a record is a new version, not an edit')}

      INSERT INTO record_lifecycle SELECT * FROM record_lifecycle_rebuild;
      DROP TABLE record_lifecycle_rebuild;
    `)
  },

  /**
   * Back to the two-value CHECK, verbatim. A record that was archived cannot
   * survive it — that is the constraint being restored — so, as always, `down`
   * is a development and test affordance and production undoes a batch by
   * restoring its snapshot (migrations.md).
   */
  down(db) {
    db.exec(`
      CREATE TABLE record_lifecycle_rebuild (
        id       INTEGER PRIMARY KEY,
        retro_id INTEGER NOT NULL,
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL,
        status   TEXT    NOT NULL,
        refs     TEXT    NOT NULL,
        note     TEXT,
        actor    TEXT    NOT NULL,
        at       TEXT    NOT NULL
      );
      INSERT INTO record_lifecycle_rebuild SELECT * FROM record_lifecycle;
      DROP TABLE record_lifecycle;

      CREATE TABLE record_lifecycle (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL CHECK (version > 0),
        status   TEXT    NOT NULL CHECK (status IN ('resolved', 'reopened')),
        refs     TEXT    NOT NULL CHECK (json_valid(refs)),
        note     TEXT,
        actor    TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
        at       TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );
      CREATE INDEX ix_record_lifecycle_record ON record_lifecycle (retro_id, rid, version);

      ${appendOnlyTriggers('record_lifecycle', 'reopening a record is a new version, not an edit')}

      INSERT INTO record_lifecycle SELECT * FROM record_lifecycle_rebuild;
      DROP TABLE record_lifecycle_rebuild;
    `)
  },
}
