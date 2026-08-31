import type { Database } from 'bun:sqlite'
import type {
  AttributeDefinition,
  AttributeType,
  NewAttributeDefinition,
} from '#domain/models/attribute.model'
import type { AttributeDefinitionRepository } from '#domain/repositories/attribute-definition.repository'
import { NoSuchDefinitionError } from '#infrastructure/no-such-definition'
import { checked, optionalText } from '#infrastructure/sqlite/rows'

type AttributeRow = {
  id: number
  name: string
  type: string
  retired_at: string | null
  created_at: string
}

const COLUMNS = 'id, name, type, retired_at, created_at'

function toDefinition(row: AttributeRow): AttributeDefinition {
  return {
    id: row.id,
    name: row.name,
    // The column's CHECK restricts it to exactly this union, so the narrowing is
    // backed by the database rather than by hope (`rows.ts` §checked).
    type: checked<AttributeType>(row.type),
    retiredAt: optionalText(row.retired_at),
    createdAt: row.created_at,
  }
}

/**
 * The attribute half of the definition pair — `UPDATE`s a row like its label
 * twin, and for the same reason (`label-definition.sqlite.adapter.ts`).
 *
 * There is no `retype`, and the absence is the point: every value already stored
 * was accepted under the type this row carries, and changing it would leave the
 * definition claiming something its own values do not satisfy
 * (`attribute.model.ts`).
 */
export class SqliteAttributeDefinitionRepository implements AttributeDefinitionRepository {
  constructor(private readonly db: Database) {}

  async add(definition: NewAttributeDefinition): Promise<AttributeDefinition> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO attribute_definitions (name, type, retired_at, created_at) VALUES (?, ?, ?, ?)',
      [definition.name, definition.type, definition.retiredAt ?? null, definition.createdAt],
    )
    return requireAttribute(this.db, Number(lastInsertRowid))
  }

  async rename(id: number, name: string): Promise<AttributeDefinition> {
    this.db.run('UPDATE attribute_definitions SET name = ? WHERE id = ?', [name, id])
    return requireAttribute(this.db, id)
  }

  async retire(id: number, at: string): Promise<AttributeDefinition> {
    this.db.run('UPDATE attribute_definitions SET retired_at = ? WHERE id = ?', [at, id])
    return requireAttribute(this.db, id)
  }

  /** `NULL`, which is what "still offered" is in this column (`optionalText`). */
  async unretire(id: number): Promise<AttributeDefinition> {
    this.db.run('UPDATE attribute_definitions SET retired_at = NULL WHERE id = ?', [id])
    return requireAttribute(this.db, id)
  }

  async findById(id: number): Promise<AttributeDefinition | undefined> {
    const row = this.db
      .query<AttributeRow, [number]>(`SELECT ${COLUMNS} FROM attribute_definitions WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toDefinition(row)
  }

  async listAll(): Promise<readonly AttributeDefinition[]> {
    return this.db
      .query<AttributeRow, []>(`SELECT ${COLUMNS} FROM attribute_definitions ORDER BY id ASC`)
      .all()
      .map(toDefinition)
  }
}

/** See `label-definition.sqlite.adapter.ts` §requireLabel — including why it is not a method. */
function requireAttribute(db: Database, id: number): AttributeDefinition {
  const row = db
    .query<AttributeRow, [number]>(`SELECT ${COLUMNS} FROM attribute_definitions WHERE id = ?`)
    .get(id)
  if (row === null) throw new NoSuchDefinitionError('attribute', id)
  return toDefinition(row)
}
