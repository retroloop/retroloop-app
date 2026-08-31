import type { AttributeDefinition, NewAttributeDefinition } from '#domain/models/attribute.model'
import type { AttributeDefinitionRepository } from '#domain/repositories/attribute-definition.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'
import { NoSuchDefinitionError } from '#infrastructure/no-such-definition'

/**
 * The attribute half of the definition pair — `label-definition.memory.adapter.ts`
 * carries the note on why these two write in place while everything they are
 * applied to appends.
 *
 * There is no `retype`: the repository does not offer one, because a value
 * already stored was accepted under the old type and this store never rewrites
 * what somebody wrote (`attribute.model.ts`).
 */
export class MemoryAttributeDefinitionRepository implements AttributeDefinitionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(definition: NewAttributeDefinition): Promise<AttributeDefinition> {
    const row: AttributeDefinition = { id: this.db.nextId(), ...definition }
    this.db.tables.attributeDefinitions.push(row)
    return clone(row)
  }

  async rename(id: number, name: string): Promise<AttributeDefinition> {
    return replace(this.db, id, (row) => ({ ...row, name }))
  }

  async retire(id: number, at: string): Promise<AttributeDefinition> {
    return replace(this.db, id, (row) => ({ ...row, retiredAt: at }))
  }

  async unretire(id: number): Promise<AttributeDefinition> {
    return replace(this.db, id, (row) => ({ ...row, retiredAt: undefined }))
  }

  async findById(id: number): Promise<AttributeDefinition | undefined> {
    return clone(this.db.tables.attributeDefinitions.find((row) => row.id === id))
  }

  async listAll(): Promise<readonly AttributeDefinition[]> {
    return clone([...this.db.tables.attributeDefinitions].sort((left, right) => left.id - right.id))
  }
}

/** See `label-definition.memory.adapter.ts` §replace — including why it is not a method. */
function replace(
  db: MemoryDatabase,
  id: number,
  change: (row: AttributeDefinition) => AttributeDefinition,
): AttributeDefinition {
  const index = db.tables.attributeDefinitions.findIndex((row) => row.id === id)
  const row = db.tables.attributeDefinitions[index]
  if (row === undefined) throw new NoSuchDefinitionError('attribute', id)

  const updated = change(row)
  db.tables.attributeDefinitions[index] = updated
  return clone(updated)
}
