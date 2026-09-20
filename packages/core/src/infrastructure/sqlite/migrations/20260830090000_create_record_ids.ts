import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * Every record gets one number that means the same thing everywhere. Without it
 * a record has no unique id: record ids start again from #1 in every
 * retrospective, and what a reader wants is a global sequence rather than a
 * per-retrospective prefix.
 *
 * **Its own table, and the reason is physical.** A record has no row: it lives
 * inside `revisions.records`, which is one immutable JSON document
 * (`20260823120200_create_revisions.ts`), and `rid`/`num` inside it are fields
 * the *AI* authored — `create-revision.use-case.ts` copies them across
 * field by field so that `revision get --content` is byte for byte the draft
 * that was submitted, which SKILL.md promises can be resubmitted as-is. A global
 * number is the one thing about a record the AI does not author, so it cannot go
 * in the blob: putting it there would rewrite an immutable document, break that
 * promise, and change the content hash every decision was carried over on
 * (`content-hash.service.ts`).
 *
 * So: `(retro_id, rid)` — the identity a record actually has (`record.model.ts`)
 * — mapped to one `AUTOINCREMENT` id. `AUTOINCREMENT` rather than a plain
 * rowid alias because this number is shown to a human and cited back at us: SQLite
 * reuses the largest rowid after a delete, and though nothing here deletes, the
 * keyword is what says the sequence never hands the same number out twice.
 *
 * The append-only triggers ship with the table, as they do for every table in
 * this schema (migrations.md): an identity that could be updated is not an
 * identity.
 *
 * ## Why this one backfills, when the house doctrine refuses to
 *
 * Two migrations state the rule that derived data is not backfilled —
 * `solutions_anchor_and_selection.ts` leaves `selected_solution` NULL because
 * *"there is no value to backfill and no honest default: NULL is the answer
 * 'this reviewer was never asked'"*, and `sessions_project_optional.ts` says the
 * same about a project nobody gave. Both are about **asserting a fact about the
 * past that nobody recorded**.
 *
 * This migration asserts nothing about the past. It *assigns new identity*, once,
 * to records that had none — the same act the write path takes from here on, run
 * over what is already stored. There is no earlier answer for it to contradict,
 * and the alternative is a product where the number a record shows depends on
 * whether it was filed before or after this release.
 *
 * ## The order, and why it is the order
 *
 * Retrospectives by `id` ascending, then each retrospective's records by `num`
 * ascending. Clock-free — the same reasoning `list-all-records.use-case.ts` gives
 * for ordering on retro id rather than on `started_at`: a wall clock is a thing
 * two rows can disagree about and an autoincrementing id is not.
 *
 * **Within a retrospective, `num` order *is* first-appearance order**, and that
 * is a consequence rather than a coincidence: `checkIdentityStability` keeps the
 * numbers a retrospective has handed out dense from 1 at every write, and never
 * renumbers or reuses one — so a record a later draft introduces can only take a
 * number above every number already spoken for. Ordering on the revision a record
 * first appeared in as well would be a second way of saying the same thing, and a
 * term no fixture the product can produce is able to disagree with is a term no
 * test can catch being wrong. (Checked against a real store as well as
 * argued: every retrospective in it, both orders identical.)
 *
 * **Every revision, not only the latest.** The forward rule is "a rid the
 * retrospective has not seen yet gets the next number", so the backfill is that
 * same rule applied to history — otherwise a store migrated today would answer
 * differently from a store that was written a record at a time under the new
 * code. It matters in exactly one case: a record the AI withdrew in a later draft
 * (`create-revision.use-case.ts` allows it — density is per rid). Reading only
 * the latest revision would leave that record with no number at all, and
 * `records.list --revision 1` still shows it. In a store where no record was
 * ever withdrawn both readings assign the same numbers; this one also answers
 * for the store where one was.
 */
export const migration: Migration = {
  version: '20260830090000',
  name: 'create_record_ids',

  up(db) {
    db.exec(`
      CREATE TABLE record_ids (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id INTEGER NOT NULL REFERENCES retrospectives (id),
        rid      TEXT    NOT NULL,
        UNIQUE (retro_id, rid)
      );

      ${appendOnlyTriggers('record_ids', 'a number is minted once and never moves')}
    `)

    /**
     * One row per `(retro_id, rid)` the store has ever held, ordered the way the
     * header argues.
     *
     * `DISTINCT` over the triple rather than over the pair, deliberately: a rid
     * whose `num` moved between revisions would come back as two rows and trip
     * `UNIQUE (retro_id, rid)`, which is a migration that refuses loudly. Folding
     * it away with a `MIN(num)` would pick one of the two silently, and identity
     * stability is exactly the invariant that would have been broken.
     *
     * **Read first, then inserted one at a time**, rather than as one ordered
     * `INSERT … SELECT`. The order *is* the migration here: the ids come out of
     * `AUTOINCREMENT` in insertion order and nothing else decides them. SQLite
     * happens to feed an `INSERT … SELECT` in the order the SELECT produces, but
     * that is an implementation detail of the query planner rather than a
     * documented guarantee, and this is not a thing to leave to a flattening
     * decision. A loop says the order out loud, and `record-ids-migration.test.ts`
     * reads the ids back to prove it.
     */
    const appearances = db
      .query<{ retro_id: number; rid: string }, []>(
        `SELECT DISTINCT r.retro_id                       AS retro_id,
                         json_extract(rec.value, '$.rid') AS rid,
                         json_extract(rec.value, '$.num') AS num
           FROM revisions r, json_each(r.records) rec
          ORDER BY retro_id ASC, num ASC`,
      )
      .all()

    const mint = db.prepare<unknown, [number, string]>(
      'INSERT INTO record_ids (retro_id, rid) VALUES (?, ?)',
    )
    for (const appearance of appearances) mint.run(appearance.retro_id, appearance.rid)
  },

  /**
   * The table goes, and with it every number it handed out.
   *
   * That is what reversing this means: the numbers are not derivable from
   * anything else — `AUTOINCREMENT` is the sequence — so a second `up` mints them
   * again from the same order and lands on the same values only because the order
   * is deterministic. As always, `down` is the development and test affordance
   * that proves `up` said everything it does; production undoes a batch by
   * restoring its snapshot (migrations.md).
   */
  down(db) {
    db.exec('DROP TABLE record_ids;')
  },
}
