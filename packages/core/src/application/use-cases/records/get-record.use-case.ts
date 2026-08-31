import type { Store } from '#application/ports/store.port'
import {
  definitionsById,
  type RecordLabelView,
  resolveRecordLabels,
} from '#application/views/definition.view'
import { buildRecordView, type RecordView } from '#application/views/record.view'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Decision } from '#domain/models/decision.model'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

export type GetRecordInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
  readonly revision?: number
}

export type GetRecordOutput = {
  readonly retroId: number
  readonly record: RecordView
  /** Every decision version for this record, oldest first — nothing is lost. */
  readonly decisions: readonly Decision[]
  readonly threads: readonly ThreadView[]
  /**
   * The labels the record wears, resolved against the vocabulary — the review
   * card renders these beside the record's other tags.
   *
   * **Labels and not attribute values**, which is a deliberate split rather than
   * an omission. A label is a classification and belongs where the reviewer is
   * scanning; a value is data about the record, which is a thing you go and look
   * at, so it lives on the record's own page and rides on `records.byId`
   * (`get-record-by-id.use-case.ts`). Every field here is a field the typed mock
   * has to produce, so the one that nothing on this surface renders is not here.
   */
  readonly labels: readonly RecordLabelView[]
}

/** One record with its decision, its proposed defaults, its labels and its threads (cli.md `record get`). */
export class GetRecordUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetRecordInput): Promise<GetRecordOutput> {
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
    const record = NotFoundError.require(
      revision.records.find((candidate) => candidate.rid === input.rid),
      'record',
      input.rid,
    )

    const decisions = await this.store.decisions.listForRecord(retrospective.id, record.rid)
    const threads = await this.store.threads.listByRetro(retrospective.id, { rid: record.rid })
    const minted = NotFoundError.require(
      await this.store.recordIds.findByRecord(retrospective.id, record.rid),
      'record number',
      input.rid,
    )

    /**
     * The labels hang off the **record**, not off the revision being read — so a
     * page pinned to `?rev=1` shows the labels the record wears now, which is
     * the same thing the lifecycle does one table over. A label is not part of
     * any draft: it was never in the blob, and pinning a revision is a way of
     * reading old content rather than of reading an old world.
     */
    const labelEntries = await this.store.recordLabels.listForRecord(retrospective.id, record.rid)

    return {
      retroId: retrospective.id,
      record: buildRecordView(record, minted.id, revision.n, decisions.at(-1)),
      decisions,
      threads: await loadThreadViews(this.store, retrospective.id, threads),
      labels: resolveRecordLabels(
        labelEntries,
        definitionsById(await this.store.labelDefinitions.listAll()),
      ),
    }
  }
}
