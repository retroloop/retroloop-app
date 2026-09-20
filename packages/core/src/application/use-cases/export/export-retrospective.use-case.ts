import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { buildRetroExport, type RetroExport } from '#application/views/export.view'
import { decisionsByRid, globalIdsByRid } from '#application/views/record.view'
import { loadThreadViews } from '#application/views/thread.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import { pendingRids } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type ExportRetrospectiveInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  /** `--state approved` narrows the handoff; the default carries every decided record. */
  readonly state?: DecisionState
}

export type ExportRetrospectiveOutput = {
  readonly export: RetroExport
}

/**
 * Renders a finished retrospective as `retro.export.v1` — the product's one
 * public, versioned contract.
 *
 * **Only a finished retrospective can be exported.** The schema states
 * `state: "finished"` and requires `finishedAt`, and the finish gate is what
 * makes every record's verdict explicit — so an export of a review still in
 * progress would be a document asserting things that are not true yet. Asking
 * for one is a `ConflictError`, not an empty file.
 *
 * The default carries **all decided records with their states**: an export
 * is a handoff of the whole outcome, and hiding declines by default would
 * surprise the import script that reads it.
 */
export class ExportRetrospectiveUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: ExportRetrospectiveInput): Promise<ExportRetrospectiveOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    if (retrospective.state !== 'finished' || retrospective.finishedAt === undefined) {
      throw new ConflictError(
        `retrospective ${retrospective.id} is ${retrospective.state}; only a finished review can be exported`,
      )
    }

    const session = NotFoundError.require(
      await this.store.sessions.findById(retrospective.sessionId),
      'session',
      retrospective.sessionId,
    )
    const revision = NotFoundError.require(
      await this.store.revisions.findLatestByRetro(retrospective.id),
      'revision',
      'latest',
    )

    const decisions = decisionsByRid(await this.store.decisions.listLatestByRetro(retrospective.id))

    // The finish gate should have made this impossible. If a record is somehow
    // undecided, say so loudly rather than emit a document whose `state` field
    // the schema does not allow.
    const pending = pendingRids(revision.records, revision.n, decisions)
    if (pending.length > 0) {
      throw new ConflictError(
        `retrospective ${retrospective.id} is finished but ${pending.length} record(s) carry no decision: ${pending.join(', ')}`,
      )
    }

    const document = buildRetroExport({
      session,
      retrospective,
      finishedAt: retrospective.finishedAt,
      revisions: await this.store.revisions.countByRetro(retrospective.id),
      revision,
      globalIds: globalIdsByRid(await this.store.recordIds.listByRetro(retrospective.id)),
      decisions,
      finishMessages: await this.store.finishMessages.listLatestByRetro(retrospective.id),
      threads: await loadThreadViews(
        this.store,
        retrospective.id,
        await this.store.threads.listByRetro(retrospective.id),
      ),
      generatedAt: timestamp(this.clock),
    })

    if (input.state === undefined) return { export: document }
    return {
      export: {
        ...document,
        records: document.records.filter((record) => record.state === input.state),
      },
    }
  }
}
