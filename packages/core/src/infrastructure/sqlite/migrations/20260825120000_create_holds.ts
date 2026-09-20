import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The lifecycle axis gets its own table (`r-hold-semantics`).
 *
 * `held` is stored as 0/1 rather than as a `'held' | 'released'` string, because
 * there are exactly two values and neither will grow a third: the thing that
 * varies is the reason, and that is the `note` column.
 *
 * Human-authored, so append-only triggers ship in the same migration as the
 * table — no schema version ever exists in which it is unprotected
 * (migrations.md).
 *
 * **The `INSERT … SELECT` at the end is the legacy carry-over.** Until this
 * change `hold` was a decision state, and a record decided `hold` meant exactly
 * what a hold flag now means. Those rows stay in `decisions` untouched — human
 * data is never rewritten, and every read path still admits the value — and each
 * one *also* becomes a v1 hold here, carrying the reviewer's note as its reason.
 * The record therefore reads as held under the new model without anybody having
 * to re-park it.
 *
 * Only the **latest** decision per record is mapped: a record that was held and
 * then approved was let go, and reviving a hold the human had already moved past
 * would be this migration inventing a fact.
 *
 * On a store whose decisions are all `approved` this maps nothing at all, which
 * is why `migrator.test.ts` seeds a hold verdict by hand rather than trusting
 * that a step nothing exercises works.
 */
export const migration: Migration = {
  version: '20260825120000',
  name: 'create_holds',

  up(db) {
    db.exec(`
      CREATE TABLE holds (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL CHECK (version > 0),
        held     INTEGER NOT NULL CHECK (held IN (0, 1)),
        note     TEXT,
        at       TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );
      CREATE INDEX ix_holds_retro ON holds (retro_id, rid, version);

      ${appendOnlyTriggers('holds', 'a release is a new version, and a reason is never edited')}

      INSERT INTO holds (retro_id, rid, version, held, note, at)
        SELECT d.retro_id, d.rid, 1, 1, d.reviewer_note, d.decided_at
        FROM decisions d
        WHERE d.state = 'hold'
          AND d.version = (SELECT MAX(v.version) FROM decisions v
                           WHERE v.retro_id = d.retro_id AND v.rid = d.rid);
    `)
  },

  down(db) {
    db.exec('DROP TABLE holds;')
  },
}
