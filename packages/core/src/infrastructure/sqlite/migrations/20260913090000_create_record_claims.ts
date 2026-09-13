import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * **Who is working on a record right now** — the in-progress marker the solving
 * lane needs so two agents do not pick up the same approved record, and so a
 * person looking at the review page can see that something is already being
 * done.
 *
 * ## It is a table beside the lifecycle, not a fourth position on it
 *
 * The obvious cheaper move was a fifth `record_lifecycle.status` word, and it is
 * refused here for the reason that table's own enum earned its width: the
 * lifecycle axis answers *"did we do it"* — `open`, `resolved`, `archived` — and
 * every value on it is a **settled** fact somebody reported. "Somebody is
 * holding this at the moment" is not on that axis at all: it is true and then it
 * is not, it says nothing about whether the record was ever fixed, and a record
 * that is claimed is still, in every sense the lifecycle means, `open`.
 *
 * Putting it on the status column would also have broken three things that are
 * promised elsewhere and are cheap to keep: the CHECK on
 * `record_lifecycle.status` (`20260831090000`), `RecordLifecycleStatus` and
 * `EffectiveLifecycle` (which the wire and the export are typed off), and
 * `LIFECYCLE_ACT_FROM`'s transition table — a claim would have needed an edge
 * out of every state and back into it. A marker that can be taken and given back
 * a dozen times while the record's standing never moves is its own table, and
 * the read models carry the two side by side.
 *
 * ## The shape
 *
 * `record_claims` is `(retro_id, rid, version, claimed, actor, at)` with
 * `UNIQUE (retro_id, rid, version)` and the append-only triggers — the
 * `record_labels` shape, one column narrower.
 *
 * **Addressed `(retro_id, rid)`**, which is the address every per-record table
 * here takes (`record-key.service.ts`) and the departure from `record_relations`
 * next door: that table is keyed on global ids because a relation names *two*
 * records, and a claim names one.
 *
 * **A bit rather than a status word**, on `record_labels`' argument: claimed and
 * not-claimed are on and off, and there is no third position a marker could
 * occupy. If "who is holding it" ever needs to be more than an actor, that is a
 * column, not a state.
 *
 * **`actor` is a column**, which only `record_lifecycle` and `record_relations`
 * otherwise have, and for their reason exactly: every other append-only table
 * here is single-writer so the author is implied by the table, and this one is
 * written by whoever picks the record up. The CLI writes `ai`; the column is
 * what makes a human's claim from the browser representable without a second
 * table, should the review UI ever offer one.
 *
 * **Append-only, and un-claiming is a row.** "Claimed at 10:00, released at
 * 11:40, claimed again at 14:00" is the history a person asks for when they want
 * to know why a record sat still for a day — and the version sequence is what a
 * write numbers itself after, so releasing by deleting the row would make the
 * next claim version 1 again and throw that away.
 *
 * **Nothing is backfilled and nothing could be.** A claim is somebody saying
 * they are on it right now; inferring one from a commit, a branch name or an
 * open record would be the store asserting a fact nobody recorded — the doctrine
 * `solutions_anchor_and_selection.ts` states and `create_record_ids.ts` names
 * its own exemption from.
 */
export const migration: Migration = {
  version: '20260913090000',
  name: 'create_record_claims',

  up(db) {
    db.exec(`
      CREATE TABLE record_claims (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        version  INTEGER NOT NULL CHECK (version > 0),
        claimed  INTEGER NOT NULL CHECK (claimed IN (0, 1)),
        actor    TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
        at       TEXT    NOT NULL,
        UNIQUE (retro_id, rid, version)
      );

      -- One index, because a claim names one record: both reads on this table
      -- ask for the highest version of a (retro_id, rid) pair, so one composite
      -- index leading with that pair serves them both. The relation table needs
      -- two only because its question has two sides.
      CREATE INDEX ix_record_claims_record ON record_claims (retro_id, rid, version);

      ${appendOnlyTriggers('record_claims', 'releasing a record is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE record_claims;')
  },
}
