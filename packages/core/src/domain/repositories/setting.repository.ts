import type { NewSettingEntry, SettingEntry, SettingKey } from '#domain/models/setting.model'

/**
 * Append-only, like every human-authored table here: `add` writes a new version
 * and there is no update and no delete. The table's own triggers reject
 * `UPDATE`/`DELETE` as the L1 backstop.
 *
 * One read, because the product asks in one shape: what is the value in force
 * for this key. There is deliberately no `listForKey` — nothing renders the
 * history of the toggle yet. The rows are there the moment something wants to,
 * which is the point of writing versions rather than a column, but a method
 * nothing calls is a method two adapters implement for nothing
 * (`thread-resolution.repository.ts` states the same rule).
 */
export type SettingRepository = {
  add(entry: NewSettingEntry): Promise<SettingEntry>
  /**
   * The version in force for a key, or `undefined` when nobody has ever set it.
   *
   * **`undefined` is a real answer and every reader has to have a default for
   * it** — for `ai_config_write` that default is *off*, which is what makes a
   * fresh install safe without anything having been written to make it so
   * (`config-write.service.ts`).
   */
  findLatest(key: SettingKey): Promise<SettingEntry | undefined>
}
