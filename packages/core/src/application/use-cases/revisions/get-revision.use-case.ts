import type { Store } from '#application/ports/store.port'
import {
  buildRecordView,
  decisionsByRid,
  globalIdsByRid,
  type RecordView,
  requireGlobalId,
} from '#application/views/record.view'
import { type RevisionMeta, toRevisionMeta } from '#application/views/revision.view'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

export type GetRevisionInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  /** Defaults to the latest revision. */
  readonly revision?: number
}

export type GetRevisionOutput = {
  readonly retrospective: Retrospective
  readonly revision: RevisionMeta
  readonly records: readonly RecordView[]
  readonly threads: readonly ThreadView[]
}

/**
 * One revision with every piece of human feedback attached to its retrospective:
 * each record's effective decision, and all comment threads, record-level and
 * review-level alike (cli.md `revision get`).
 *
 * Requests rode here too until `r-remove-requests` removed the surface
 * that wrote them. Nothing has ever written one on any store, so the key could
 * only ever have been an empty array — a vestige of the living feature rather
 * than history. The rows, the table and the repository stay; no read path
 * surfaces them, exactly as with holds.
 */
export class GetRevisionUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetRevisionInput): Promise<GetRevisionOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revision = NotFoundError.require(
      await resolveRevision(this.store.revisions, retrospective.id, input.revision),
      'revision',
      input.revision ?? 'latest',
    )

    const latest = decisionsByRid(await this.store.decisions.listLatestByRetro(retrospective.id))
    const threads = await this.store.threads.listByRetro(retrospective.id)
    const globalIds = globalIdsByRid(await this.store.recordIds.listByRetro(retrospective.id))

    return {
      retrospective,
      revision: toRevisionMeta(revision),
      records: revision.records.map((record) =>
        buildRecordView(
          record,
          requireGlobalId(globalIds, retrospective.id, record.rid),
          revision.n,
          latest.get(record.rid),
        ),
      ),
      threads: await loadThreadViews(this.store, retrospective.id, threads),
    }
  }
}
