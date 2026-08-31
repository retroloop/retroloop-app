import type { LabelDefinition, NewLabelDefinition } from '#domain/models/label.model'
import type { LabelDefinitionRepository } from '#domain/repositories/label-definition.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'
import { NoSuchDefinitionError } from '#infrastructure/no-such-definition'

/**
 * The one memory adapter with writes that are not appends.
 *
 * `rename`, `retire` and `unretire` replace the row in place, exactly as the
 * SQLite adapter's `UPDATE` does — a definition is configuration rather than human data, and the
 * argument for that is in `label-definition.repository.ts`. Everything else here
 * is the usual shape: rows cross the boundary by value, and `listAll` answers in
 * minting order.
 */
export class MemoryLabelDefinitionRepository implements LabelDefinitionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(definition: NewLabelDefinition): Promise<LabelDefinition> {
    const row: LabelDefinition = { id: this.db.nextId(), ...definition }
    this.db.tables.labelDefinitions.push(row)
    return clone(row)
  }

  async rename(id: number, name: string): Promise<LabelDefinition> {
    return replace(this.db, id, (row) => ({ ...row, name }))
  }

  async retire(id: number, at: string): Promise<LabelDefinition> {
    return replace(this.db, id, (row) => ({ ...row, retiredAt: at }))
  }

  async unretire(id: number): Promise<LabelDefinition> {
    return replace(this.db, id, (row) => ({ ...row, retiredAt: undefined }))
  }

  async findById(id: number): Promise<LabelDefinition | undefined> {
    return clone(this.db.tables.labelDefinitions.find((row) => row.id === id))
  }

  async listAll(): Promise<readonly LabelDefinition[]> {
    return clone([...this.db.tables.labelDefinitions].sort((left, right) => left.id - right.id))
  }
}

/**
 * The write half of both mutators, once.
 *
 * **A module function rather than a private method**, and that is not style: TS
 * `private` is compile-time only, so a helper on the prototype is a method the
 * actor-invariants sweep sees and demands a justification for
 * (`actor-invariants.test.ts` enumerates every repository's mutators by name).
 * A helper nobody outside this file can call should not be on the surface that
 * check reads.
 *
 * It **throws** on a missing row rather than returning `undefined`, which is the
 * one place a repository in this system does — and it is the same standing
 * `requireGlobalId` has: the use cases resolve the definition before they call
 * this, inside the same unit of work, so a miss here is a store that changed
 * under an open transaction rather than a caller asking about something that
 * might not exist. SQLite's `UPDATE … WHERE id = ?` matching nothing is the same
 * condition, and the adapter there says the same sentence.
 */
function replace(
  db: MemoryDatabase,
  id: number,
  change: (row: LabelDefinition) => LabelDefinition,
): LabelDefinition {
  const index = db.tables.labelDefinitions.findIndex((row) => row.id === id)
  const row = db.tables.labelDefinitions[index]
  if (row === undefined) throw new NoSuchDefinitionError('label', id)

  const updated = change(row)
  db.tables.labelDefinitions[index] = updated
  return clone(updated)
}
