import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * One record related to another, in the words of whoever related them — the
 * owner's session-11 ask: *"both actors can relate records, each relation
 * carries how-they-relate words, and the relation reads from both sides, so that
 * AI can easily find past records and build holistic solutions."*
 *
 * **Both sides are `record_ids.id`, and that is the only shape available.**
 * Every other per-record table in this schema addresses one record as
 * `(retro_id, rid)`, because that pair is what identifies a record
 * (`record.model.ts`). A relation addresses *two*, and a four-column key made of
 * two pairs is a key nobody can read, join on, or cite. `record_ids` exists
 * precisely because *"nobody says a pair out loud"* (`record-id.model.ts`): it
 * is the one single-column handle a record has, it is minted once and never
 * moves, and it is the number the owner and the AI actually say to each other.
 * So it is the foreign key on both sides, and a relation crossing two
 * retrospectives costs this table nothing — which it has to, because *"find past
 * records"* is the feature.
 *
 * `CHECK (from_id != to_id)` at L1: a record related to itself says nothing, and
 * the store should not be able to hold the row even if a rogue writer opens the
 * database directly. The use case refuses it first, with a sentence.
 *
 * **`how` is NOT NULL, because his sentence made it a part of the act.** *"Each
 * relation carries how-they-relate words"* — not "may carry". A relation with no
 * words is the thing this feature is *instead of*: a bare link that leaves the
 * reader to guess whether the second record supersedes the first, duplicates it,
 * or was caused by it. Free text with no vocabulary, on the argument
 * `record_lifecycle.refs` already made and won: the owner named three kinds of
 * relation and *"a shape that insisted on knowing which of those it was would be
 * a shape that refuses the fourth kind"*. A vocabulary is a settings-page
 * feature, and labels are already that.
 *
 * ## The fork this table had to choose, consciously
 *
 * `record_lifecycle` took a widenable `status` word; `record_labels` took an
 * `applied` bit, on the ground that *"a label's two positions are on and off,
 * which is not a scale anything extends"* (`20260901090300:16-21`). **This takes
 * the bit**, and `record_labels` is the closer precedent for the reason it gave:
 * relating and un-relating are on and off. There is no third position a relation
 * could be in — a relation that means something different is different *words*,
 * which is the `how` column, or a different pair, which is a different row. The
 * lifecycle enum earned its width because a record's standing was a scale that
 * really did grow from two positions to four inside one session; nothing here is
 * a scale.
 *
 * So: the labels join-table pattern, one column wider. Dense `version` per
 * **ordered pair** `(from_id, to_id)`, an `applied` bit, and `UNIQUE (from_id,
 * to_id, version)`. A record holding four relations holds four independent v1
 * rows, which is why the repository's reads are ordered by `id`: insertion order
 * is the only order that means anything across four sequences — the sentence
 * `record_labels` wrote first and this table inherits unchanged.
 *
 * **Every row carries its own `how`, the un-relate rows included.** Re-relating
 * a pair somebody took apart is a new statement about it and may use new words;
 * an un-relate row copies forward the words of the relation it takes off, so the
 * history never holds two disagreeing accounts of one relation
 * (`relate-records.use-case.ts` has the argument, and is where the copy
 * happens — the caller is not asked for words it would be free to contradict).
 *
 * **One row per relation as authored, and never a mirror row.** *"Reads from
 * both sides"* is a property of the read: `listForRecord` asks for `from_id = ?
 * OR to_id = ?` and hands the caller the direction. A second, reversed row would
 * be a second thing to keep in agreement, a second thing to un-relate, and a
 * second version sequence to number — and it would make "who said this" unanswerable
 * the moment the two rows disagreed.
 *
 * **`actor` is a column**, which only `record_lifecycle` otherwise has, and for
 * its reason exactly (`20260829093000:39-43`): every other append-only table
 * here is single-writer so the author is implied by the table, and this one is
 * written by both — *"both actors can relate records"* is the first clause of
 * the ask. The append-only triggers ship with the table and apply to both
 * authors, because *"the guarantee is about immutability, which is not a property
 * of who writes"*.
 *
 * **Nothing is backfilled**, and there is nothing that could be: a relation is
 * an assertion somebody makes, and inferring one from two records that mention
 * the same file would be the store asserting a fact about the past nobody
 * recorded — the doctrine `solutions_anchor_and_selection.ts` states and
 * `create_record_ids.ts` names its own exemption from.
 */
export const migration: Migration = {
  version: '20260901090500',
  name: 'create_record_relations',

  up(db) {
    db.exec(`
      CREATE TABLE record_relations (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER NOT NULL REFERENCES record_ids (id),
        to_id   INTEGER NOT NULL REFERENCES record_ids (id),
        version INTEGER NOT NULL CHECK (version > 0),
        applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
        how     TEXT    NOT NULL,
        actor   TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
        at      TEXT    NOT NULL,
        CHECK (from_id != to_id),
        UNIQUE (from_id, to_id, version)
      );

      -- One index per side, because the read this table exists for asks both:
      -- "what did anyone relate this record to" and "what did anyone relate to
      -- this record" are one question with two halves, and a single composite
      -- index would serve only the half that leads with its first column.
      CREATE INDEX ix_record_relations_from ON record_relations (from_id, to_id, version);
      CREATE INDEX ix_record_relations_to   ON record_relations (to_id, from_id, version);

      ${appendOnlyTriggers('record_relations', 'un-relating two records is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE record_relations;')
  },
}
