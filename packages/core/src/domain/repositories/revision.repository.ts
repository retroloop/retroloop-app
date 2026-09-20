import type { NewRevision, Revision } from '#domain/models/revision.model'

/**
 * Revisions are immutable. No update, no delete — the absence of those
 * methods is the enforcement at this layer.
 */
export type RevisionRepository = {
  add(revision: NewRevision): Promise<Revision>
  findByRetroAndN(retroId: number, n: number): Promise<Revision | undefined>
  findLatestByRetro(retroId: number): Promise<Revision | undefined>
  /**
   * `findLatestByRetro` for every retrospective at once, ascending by retro id.
   * The dashboard needs the latest revision of every row it draws; asking one
   * row at a time is the difference between a query and a query per retro.
   */
  listLatestForEachRetro(): Promise<readonly Revision[]>
  /** Ascending by `n`. */
  listByRetro(retroId: number): Promise<readonly Revision[]>
  countByRetro(retroId: number): Promise<number>
}
