import type { Decision, NewDecision } from '#domain/models/decision.model'

/**
 * Human-authored and append-only: `add` writes a new version, and there is no
 * update or delete anywhere on this type. The append-only SQLite triggers back
 * the same guarantee by rejecting `UPDATE`/`DELETE` outright.
 */
export type DecisionRepository = {
  add(decision: NewDecision): Promise<Decision>
  /** Highest `version` for the record, or `undefined` if it was never decided. */
  findLatest(retroId: number, rid: string): Promise<Decision | undefined>
  /** Every version for one record, ascending — the decision history. */
  listForRecord(retroId: number, rid: string): Promise<readonly Decision[]>
  /** The latest version of every decided record in the retrospective. */
  listLatestByRetro(retroId: number): Promise<readonly Decision[]>
  /**
   * The same, for every retrospective at once. The dashboard counts pending and
   * decided records per row, and each count needs the verdicts that bind — one
   * query for the whole list rather than one per retro.
   */
  listLatestForEachRetro(): Promise<readonly Decision[]>
}
