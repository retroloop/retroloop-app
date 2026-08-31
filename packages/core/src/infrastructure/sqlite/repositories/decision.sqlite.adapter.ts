import type { Database } from 'bun:sqlite'
import type { Decision, DecisionState, NewDecision } from '#domain/models/decision.model'
import type { Involvement, Severity } from '#domain/models/record.model'
import type { DecisionRepository } from '#domain/repositories/decision.repository'
import {
  checked,
  fromSolutionLevel,
  optionalText,
  toSolutionLevel,
} from '#infrastructure/sqlite/rows'

type DecisionRow = {
  id: number
  retro_id: number
  rid: string
  version: number
  state: string
  severity: number
  solution_level: string
  selected_solution: number | null
  involvement: string
  reviewer_note: string | null
  revision_n: number
  content_hash: string
  decided_at: string
}

const COLUMNS = `id, retro_id, rid, version, state, severity, solution_level, selected_solution,
                 involvement, reviewer_note, revision_n, content_hash, decided_at`

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    version: row.version,
    state: checked<DecisionState>(row.state),
    severity: row.severity as Severity,
    solutionLevel: toSolutionLevel(row.solution_level),
    // NULL on every decision made before solutions existed, and on every
    // decision about a record that proposes none: nobody was asked.
    selectedSolution: row.selected_solution ?? undefined,
    involvement: checked<Involvement>(row.involvement),
    reviewerNote: optionalText(row.reviewer_note),
    revisionN: row.revision_n,
    contentHash: row.content_hash,
    decidedAt: row.decided_at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * three reads, and the database rejects `UPDATE`/`DELETE` on the table even from
 * a writer that never came through here.
 */
export class SqliteDecisionRepository implements DecisionRepository {
  constructor(private readonly db: Database) {}

  async add(decision: NewDecision): Promise<Decision> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO decisions (retro_id, rid, version, state, severity, solution_level,
                              selected_solution, involvement, reviewer_note, revision_n,
                              content_hash, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        decision.retroId,
        decision.rid,
        decision.version,
        decision.state,
        decision.severity,
        fromSolutionLevel(decision.solutionLevel),
        decision.selectedSolution ?? null,
        decision.involvement,
        decision.reviewerNote ?? null,
        decision.revisionN,
        decision.contentHash,
        decision.decidedAt,
      ],
    )
    const row = this.db
      .query<DecisionRow, [number]>(`SELECT ${COLUMNS} FROM decisions WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('decision disappeared immediately after insert')
    return toDecision(row)
  }

  async findLatest(retroId: number, rid: string): Promise<Decision | undefined> {
    const row = this.db
      .query<DecisionRow, [number, string]>(
        `SELECT ${COLUMNS} FROM decisions
         WHERE retro_id = ? AND rid = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(retroId, rid)
    return row === null ? undefined : toDecision(row)
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly Decision[]> {
    return this.db
      .query<DecisionRow, [number, string]>(
        `SELECT ${COLUMNS} FROM decisions
         WHERE retro_id = ? AND rid = ?
         ORDER BY version ASC`,
      )
      .all(retroId, rid)
      .map(toDecision)
  }

  async listLatestByRetro(retroId: number): Promise<readonly Decision[]> {
    return this.db
      .query<DecisionRow, [number]>(
        `SELECT ${COLUMNS} FROM decisions d
         WHERE d.retro_id = ?
           AND d.version = (SELECT MAX(v.version) FROM decisions v
                            WHERE v.retro_id = d.retro_id AND v.rid = d.rid)
         ORDER BY d.id ASC`,
      )
      .all(retroId)
      .map(toDecision)
  }

  /** The same correlated subquery with the `retro_id` filter dropped. */
  async listLatestForEachRetro(): Promise<readonly Decision[]> {
    return this.db
      .query<DecisionRow, []>(
        `SELECT ${COLUMNS} FROM decisions d
         WHERE d.version = (SELECT MAX(v.version) FROM decisions v
                            WHERE v.retro_id = d.retro_id AND v.rid = d.rid)
         ORDER BY d.id ASC`,
      )
      .all()
      .map(toDecision)
  }
}
