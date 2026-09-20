import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * A comment records the revision it was written against.
 *
 * A comment shows the revision number it is associated with, while the thread
 * goes on showing across every revision — the label is per comment, and a thread
 * still spans every revision, because it is keyed on `(retroId, rid, section)`
 * and always was.
 *
 * **Nullable, and every row already written stays NULL forever.** Human data is
 * never rewritten, so there is no backfill here: what a comment was written
 * against is either something the writer captured or something a reader derives
 * from timestamps, and inventing a stored answer for a row nobody stamped would
 * be this migration asserting a fact it does not have. The derivation lives in
 * `thread.view.ts`, where both the CLI and the browser read it.
 *
 * `ADD COLUMN` does not fire the table's append-only triggers and rewrites no
 * row, so the immutability `comments` enforces at L1 (D4) is untouched — the
 * same reasoning `revisions_add_title` wrote down for the same operation.
 */
export const migration: Migration = {
  version: '20260827090000',
  name: 'comments_add_revision',

  up(db) {
    db.exec('ALTER TABLE comments ADD COLUMN revision_n INTEGER;')
  },

  down(db) {
    db.exec('ALTER TABLE comments DROP COLUMN revision_n;')
  },
}
