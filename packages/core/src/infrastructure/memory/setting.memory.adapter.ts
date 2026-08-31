import type { NewSettingEntry, SettingEntry, SettingKey } from '#domain/models/setting.model'
import type { SettingRepository } from '#domain/repositories/setting.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemorySettingRepository implements SettingRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewSettingEntry): Promise<SettingEntry> {
    const row: SettingEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.settings.push(row)
    return clone(row)
  }

  async findLatest(key: SettingKey): Promise<SettingEntry | undefined> {
    return clone(
      this.db.tables.settings
        .filter((entry) => entry.key === key)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }
}
