import type { FinishMessage, NewFinishMessage } from '#domain/models/finish-message.model'
import type { FinishMessageRepository } from '#domain/repositories/finish-message.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryFinishMessageRepository implements FinishMessageRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(message: NewFinishMessage): Promise<FinishMessage> {
    const row: FinishMessage = { id: this.db.nextId(), ...message }
    this.db.tables.finishMessages.push(row)
    return clone(row)
  }

  async findLatest(retroId: number, revisionN: number): Promise<FinishMessage | undefined> {
    return clone(
      this.db.tables.finishMessages
        .filter((message) => message.retroId === retroId && message.revisionN === revisionN)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listLatestByRetro(retroId: number): Promise<readonly FinishMessage[]> {
    const latest = new Map<number, FinishMessage>()
    for (const message of this.db.tables.finishMessages) {
      if (message.retroId !== retroId) continue
      const known = latest.get(message.revisionN)
      if (known === undefined || message.version > known.version) {
        latest.set(message.revisionN, message)
      }
    }
    return clone([...latest.values()].sort((left, right) => left.revisionN - right.revisionN))
  }
}
