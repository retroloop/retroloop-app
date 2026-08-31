/**
 * A global setting, versioned and append-only — today there is exactly one of
 * them, and it is a guarantee rather than a preference.
 *
 * **OWNER RULING 2**, dictated at the session-10 scope alignment:
 *
 * > *"In the config page add a toggle that the user can enable to give the AI
 * > the ability to update the configs. Otherwise, if it is disabled, the user
 * > can be certain that the AI cannot mess around."*
 *
 * *"The user can be certain"* is the requirement, and certainty is what
 * separates this from a convention: the toggle is read **in core, inside the
 * unit of work that would do the writing** (`config-write.service.ts`), so it
 * holds against a bypassed UI, a hand-rolled tRPC call, and the CLI the AI
 * actually uses. The settings page renders the switch; it does not enforce it.
 */
export const AI_CONFIG_WRITE = 'ai_config_write'

/**
 * Every key the store knows. A closed union rather than free-form strings,
 * because a setting nobody declared is a setting nothing reads and nothing can
 * default — and the CHECK on the table says the same thing at L1.
 */
export const SETTING_KEYS = [AI_CONFIG_WRITE] as const

export type SettingKey = (typeof SETTING_KEYS)[number]

/**
 * One act of somebody changing a setting.
 *
 * **A table of versions, not a row that gets edited**, on the same pattern
 * `decisions`, `thread_resolutions` and `record_lifecycle` follow — and here the
 * append-only shape is doing work none of those needed it for. The owner's ask
 * is that he can be *certain* about what the AI may do; "the toggle is off now"
 * is a weaker answer than "it has been off since 09:14 on the 27th, and here is
 * every time it moved". A column would have thrown that away on the first
 * change.
 *
 * There is deliberately **no `actor` column**, unlike `record_lifecycle`. That
 * table has one because both actors write it; this one is single-writer — the
 * human, forever, whatever the setting currently says — so the author is implied
 * by the table exactly as it is for every other human-authored table in this
 * schema (`record-lifecycle.model.ts` §3).
 */
export type SettingEntry = {
  readonly id: number
  readonly key: SettingKey
  /** 1-based, dense per key. The highest version is the one in force. */
  readonly version: number
  /**
   * What it was set to. Text, because a settings table with one boolean in it
   * today is still a settings table, and `'on' | 'off'` reads in a `sqlite3`
   * session where `1 | 0` has to be looked up.
   */
  readonly value: string
  readonly at: string
}

export type NewSettingEntry = Omit<SettingEntry, 'id'>

/** The two values the one setting takes. */
export const SETTING_ON = 'on'
export const SETTING_OFF = 'off'
