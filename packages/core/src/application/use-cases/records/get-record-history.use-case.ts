import type { Store } from '#application/ports/store.port'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Decision } from '#domain/models/decision.model'
import type { RecordSection, RetroRecord } from '#domain/models/record.model'
import { changedSections } from '#domain/services/content-hash.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type RecordAppearance = {
  readonly revisionN: number
  readonly createdAt: string
  readonly record: RetroRecord
  /** Sections that differ from this record's previous appearance; empty for the first. */
  readonly changedSections: readonly RecordSection[]
  /** The decision the human made against this revision's content, if they made one. */
  readonly decision: Decision | undefined
}

export type GetRecordHistoryInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
}

export type GetRecordHistoryOutput = {
  readonly retroId: number
  readonly rid: string
  readonly appearances: readonly RecordAppearance[]
}

/**
 * One record across every revision it appears in: the unit of evolution
 * the reviewer cares about is the record, so there is no whole-revision diff
 * anywhere in the product — this is the diff.
 *
 * Each appearance carries the sections that changed since the record was last
 * seen and the decision made against that revision, which is what lets the UI say
 * "you approved this on rev 1, the root cause changed in rev 2".
 */
export class GetRecordHistoryUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetRecordHistoryInput): Promise<GetRecordHistoryOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revisions = await this.store.revisions.listByRetro(retrospective.id)
    const decisions = await this.store.decisions.listForRecord(retrospective.id, input.rid)

    const appearances: RecordAppearance[] = []
    let previous: RetroRecord | undefined
    for (const revision of revisions) {
      const record = revision.records.find((candidate) => candidate.rid === input.rid)
      if (record === undefined) continue

      appearances.push({
        revisionN: revision.n,
        createdAt: revision.createdAt,
        record,
        changedSections: previous === undefined ? [] : changedSections(previous, record),
        decision: decisions.filter((decision) => decision.revisionN === revision.n).at(-1),
      })
      previous = record
    }

    if (appearances.length === 0) throw new NotFoundError('record', input.rid)

    return { retroId: retrospective.id, rid: input.rid, appearances }
  }
}
