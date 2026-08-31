import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * The retrospective's name, carried on the revision that proposed it (KC-0020).
 *
 * Additive, and nullable for the same reason it is optional in the schema: every
 * revision already filed has no title, and the reader falls back to
 * "Retro #n — <cwd basename>" rather than to an empty string.
 *
 * `ADD COLUMN` does not fire the table's append-only triggers and does not
 * rewrite a single row, so the immutability the revisions table enforces
 * (D4) is untouched by this — the column arrives empty and stays empty for every
 * draft that predates it.
 */
export const migration: Migration = {
  version: '20260825091000',
  name: 'revisions_add_title',

  up(db) {
    db.exec('ALTER TABLE revisions ADD COLUMN title TEXT;')
  },

  down(db) {
    db.exec('ALTER TABLE revisions DROP COLUMN title;')
  },
}
