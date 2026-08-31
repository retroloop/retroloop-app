import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * The global settings, versioned — one key today, and it is a guarantee.
 *
 * **OWNER RULING 2**, dictated: *"In the config page add a toggle that the user
 * can enable to give the AI the ability to update the configs. Otherwise, if it
 * is disabled, the user can be certain that the AI cannot mess around."*
 *
 * Three things about this table are that sentence rather than taste:
 *
 * 1. **A table of versions, not a row anyone edits.** *"The user can be
 *    certain"* is a claim about the past as well as the present: "it is off
 *    now" is weaker than "it has been off since the 27th, and here is every time
 *    it moved". A column would have thrown that away on the first change. The
 *    append-only triggers are what make the history a fact rather than a
 *    convention — an AI that opened this file directly still could not rewrite a
 *    row saying the toggle was on.
 * 2. **No row is the safe state.** Nothing is inserted here by this migration or
 *    by anything else at install, and `ai_config_write` with no row reads as
 *    *off* (`config-write.service.ts`). So a fresh store is in the state he
 *    asked for without anybody having written it, and turning the guarantee off
 *    is something a person had to do on purpose.
 * 3. **`key` is CHECKed rather than free.** A setting nobody declared is a
 *    setting nothing reads and nothing can default; a typo would otherwise be a
 *    row that silently governs nothing. Widened, never narrowed, like every
 *    other enum here.
 *
 * There is no `actor` column, unlike `record_lifecycle`. That table has one
 * because both actors write it; this one has a single writer — the human,
 * forever, whatever the setting currently says — so the author is implied by the
 * table, which is the rule every other append-only table in this schema follows.
 */
export const migration: Migration = {
  version: '20260901090200',
  name: 'create_settings',

  up(db) {
    db.exec(`
      CREATE TABLE settings (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        key     TEXT    NOT NULL CHECK (key IN ('ai_config_write')),
        version INTEGER NOT NULL CHECK (version > 0),
        value   TEXT    NOT NULL,
        at      TEXT    NOT NULL,
        UNIQUE (key, version)
      );
      CREATE INDEX ix_settings_key ON settings (key, version);

      ${appendOnlyTriggers('settings', 'changing a setting is a new version, not an edit')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE settings;')
  },
}
