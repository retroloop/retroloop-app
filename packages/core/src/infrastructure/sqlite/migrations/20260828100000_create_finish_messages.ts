import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The human's final word on a round, filed with his finish
 * (`r-finish-confirm-message`, owner-approved).
 *
 * His words: *"if it is actually valid and can be closed then it should show a
 * text box where the human can enter their final message before they close so
 * this message is going to be delivered separately from the comments"*. So it is
 * **not** a comment and not a note: comments are threads the AI answers, and a
 * note is invisible to the AI until drafting (KC-0015). This is a channel of its
 * own that the AI reads on the round read.
 *
 * **Why a table and not a column.** Nothing owns "the round" today — a round is a
 * `ReviewFinished` event keyed `(retro_id, revision_n)` and no row anywhere. The
 * event payload is not a candidate either: `events.data` is the outbox's audit
 * trail, flat scalars, and nothing in the app queries it. So the round gets its
 * first row here, keyed the way the event is.
 *
 * It is a human field, so it obeys every rule a human field obeys: written only
 * by the human's own act, and append-only enforced at L1 by triggers that ship in
 * the same migration as the table, so no schema version exists in which it is
 * unprotected (migrations.md).
 *
 * **`version` is here for the same reason it is on `decisions`, `holds` and
 * `thread_resolutions`** — human data is append-only *and versioned*
 * (CLAUDE.md §Actor invariants): if the product ever lets him amend the word he
 * left on a round, the amendment is a new row and the first one stays readable.
 * Exactly one version exists today, because the finish is once per round: a
 * second press of the same round's button is absorbed and writes nothing at all
 * (retro 4 `r-request-changes-multi-press`), and the message rides the press.
 *
 * `message` is `NOT NULL`: a row exists only when he actually wrote something.
 * An empty box is not a message, and the absence of one is the absence of a row
 * rather than a row carrying `''` — nothing is ever inferred from silence
 * (KC-0010).
 */
export const migration: Migration = {
  version: '20260828100000',
  name: 'create_finish_messages',

  up(db) {
    db.exec(`
      CREATE TABLE finish_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        retro_id   INTEGER NOT NULL REFERENCES retrospectives (id),
        revision_n INTEGER NOT NULL CHECK (revision_n > 0),
        version    INTEGER NOT NULL CHECK (version > 0),
        message    TEXT    NOT NULL,
        at         TEXT    NOT NULL,
        UNIQUE (retro_id, revision_n, version)
      );
      CREATE INDEX ix_finish_messages_retro ON finish_messages (retro_id, revision_n, version);

      ${appendOnlyTriggers('finish_messages', 'the word he left on a round is never edited')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE finish_messages;')
  },
}
