import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * A record can be marked resolved after the review that filed it closed, and
 * reopened again. Even after a retrospective has been closed, metadata can be
 * attached to its records so that their life cycle stays manageable: once the AI
 * fixes an issue there is a way to show that the issue was resolved, and to
 * specify a commit id, a GitHub issue or some other reference.
 *
 * Its own table rather than a column anywhere, and both alternatives were real:
 *
 * - **not on the record.** Records live as a JSON blob inside an immutable
 *   revision, and the blob is what the decision carry-over hash is taken over
 *   (`content-hash.service.ts`). A lifecycle field there would send every decided
 *   record back to pending the moment it was written, and lifecycle is written
 *   *after* the review — so it would un-decide a retrospective nobody can reopen.
 * - **not on the decision.** A decision is the human's verdict on whether to do
 *   the work; this is what happened when somebody did it. They move at different
 *   times, for different reasons, and the AI writes one of them.
 *
 * So: a table of versions on the holds / `thread_resolutions` pattern, keyed
 * `(retro_id, rid, version)` because a rid is minted per retrospective and is not
 * globally unique (`record.model.ts`).
 *
 * Three deliberate departures from that pattern, each earning its place:
 *
 * 1. **`status` is TEXT, not the 0/1 column `holds.held` and
 *    `thread_resolutions.resolved` are.** Those two chose a bit because "there
 *    are exactly two values and neither will grow a third". That is not true
 *    here: labels and tags were deferred rather than ruled out,
 *    and a third position (`wontfix`, say) is a plausible next ask. A widened
 *    CHECK is a one-line migration; unpicking a boolean is a rebuild. The CHECK
 *    is widened and never narrowed, like every other enum in this schema.
 * 2. **`refs` is a JSON array**, with `json_valid` — the precedent is
 *    `revisions.records` (`20260823120200_create_revisions.ts`), which is the
 *    only other column in the schema holding a list. Free text, unvalidated
 *    beyond a non-empty trim, because there are several kinds of reference
 *    and a shape that knew which was which would refuse the fourth.
 * 3. **`actor` is a column**, which no other append-only table has. Every one of
 *    them is single-writer, so the author is implied by the table; this one is
 *    written by both — the AI resolving what it fixed, the human resolving from
 *    the browser — and nothing else would record who did it.
 *
 * The append-only triggers ship in the same migration as the table, so no schema
 * version ever exists in which it is unprotected (migrations.md). They apply here
 * even though the AI writes too: the triggers are about immutability, not about
 * authorship, and "reopening is a new row" is a rule both authors obey.
 */
export const migration: Migration = {
  version: '20260829093000',
  name: 'create_record_lifecycle',

  up(db) {
    db.exec(`
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
    `)
  },

  down(db) {
    db.exec('DROP TABLE record_lifecycle;')
  },
}
