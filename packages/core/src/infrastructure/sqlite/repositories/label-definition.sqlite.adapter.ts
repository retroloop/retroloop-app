import type { Database } from 'bun:sqlite'
import type { LabelDefinition, NewLabelDefinition } from '#domain/models/label.model'
import type { LabelDefinitionRepository } from '#domain/repositories/label-definition.repository'
import { NoSuchDefinitionError } from '#infrastructure/no-such-definition'
import { optionalText } from '#infrastructure/sqlite/rows'

type LabelRow = {
  id: number
  name: string
  retired_at: string | null
  created_at: string
}

const COLUMNS = 'id, name, retired_at, created_at'

function toDefinition(row: LabelRow): LabelDefinition {
  return {
    id: row.id,
    name: row.name,
    retiredAt: optionalText(row.retired_at),
    createdAt: row.created_at,
  }
}

/**
 * **The one adapter in this package that runs `UPDATE`.** Every other table here
 * is append-only and has triggers that would refuse one; this table is
 * configuration rather than human data, and the argument for the distinction is
 * in `label-definition.repository.ts`.
 *
 * Every mutator reads the row back rather than trusting what it wrote, which is
 * the same shape every `add` in this package has: the row that comes back is the
 * row the database holds, columns the caller did not mention included.
 */
export class SqliteLabelDefinitionRepository implements LabelDefinitionRepository {
  constructor(private readonly db: Database) {}

  async add(definition: NewLabelDefinition): Promise<LabelDefinition> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO label_definitions (name, retired_at, created_at) VALUES (?, ?, ?)',
      [definition.name, definition.retiredAt ?? null, definition.createdAt],
    )
    return requireLabel(this.db, Number(lastInsertRowid))
  }

  async rename(id: number, name: string): Promise<LabelDefinition> {
    this.db.run('UPDATE label_definitions SET name = ? WHERE id = ?', [name, id])
    return requireLabel(this.db, id)
  }

  async retire(id: number, at: string): Promise<LabelDefinition> {
    this.db.run('UPDATE label_definitions SET retired_at = ? WHERE id = ?', [at, id])
    return requireLabel(this.db, id)
  }

  /** `NULL`, which is what "still offered" is in this column (`optionalText`). */
  async unretire(id: number): Promise<LabelDefinition> {
    this.db.run('UPDATE label_definitions SET retired_at = NULL WHERE id = ?', [id])
    return requireLabel(this.db, id)
  }

  async findById(id: number): Promise<LabelDefinition | undefined> {
    const row = this.db
      .query<LabelRow, [number]>(`SELECT ${COLUMNS} FROM label_definitions WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toDefinition(row)
  }

  /** Minting order — the one order both stores answer without choosing a collation. */
  async listAll(): Promise<readonly LabelDefinition[]> {
    return this.db
      .query<LabelRow, []>(`SELECT ${COLUMNS} FROM label_definitions ORDER BY id ASC`)
      .all()
      .map(toDefinition)
  }
}

/**
 * The row after a write, or the shout that says it vanished.
 *
 * `UPDATE … WHERE id = ?` matching nothing is not an error in SQLite, so without
 * this a rename of a definition that is not there would answer with whatever the
 * read found — which is `null`. The use cases resolve the definition inside the
 * same unit of work before calling either mutator, so reaching this is the store
 * having changed under an open transaction rather than a caller asking about
 * something that might not exist (`no-such-definition.ts`).
 *
 * A module function rather than a private method, for the reason the memory
 * adapter's twin gives: `private` is compile-time only, and a helper on the
 * prototype is a method the actor-invariants sweep reads as part of the
 * repository's surface.
 */
function requireLabel(db: Database, id: number): LabelDefinition {
  const row = db
    .query<LabelRow, [number]>(`SELECT ${COLUMNS} FROM label_definitions WHERE id = ?`)
    .get(id)
  if (row === null) throw new NoSuchDefinitionError('label', id)
  return toDefinition(row)
}
