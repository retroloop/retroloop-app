import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import {
  definitionsById,
  type RecordLabelView,
  resolveRecordLabels,
} from '#application/views/definition.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import {
  describeLabelRef,
  isOfferable,
  type LabelRef,
  resolveLabel,
} from '#domain/services/definition.service'
import { latestLabelEntry } from '#domain/services/record-label.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type ApplyLabelInput = {
  /**
   * **Human only, whatever the AI-config-write toggle says.**
   *
   * The toggle governs the *definitions* — the ability to update the configs —
   * and this is not one: it is a mark on a human's record. Whether the AI may
   * ever suggest a label on its own draft is still open, and the default is
   * that the write side stays human-only until it is decided. So the guard here
   * is the blanket one `ResolveThreadUseCase` opens with, above the
   * transaction, and there is no CLI surface for it at all
   * (`apps/cli/src/commands/label.ts`).
   */
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
  readonly label: LabelRef
  /** `true` puts the label on, `false` takes it off. Removing is a row, never a delete. */
  readonly applied: boolean
}

export type ApplyLabelOutput = {
  readonly retroId: number
  readonly rid: string
  /** The version just written, 1-based and dense per `(retroId, rid, labelId)`. */
  readonly version: number
  /**
   * Every label the record wears now, resolved against the vocabulary — the
   * same shape and the same join a read of the record answers with.
   *
   * **Where that leaves the record, not what was written**, which is the shape
   * `records.setLifecycle` already answers in: a caller that had to take an id
   * away and look the name up would be doing the join every reader of a record
   * already does, and doing it differently.
   */
  readonly labels: readonly RecordLabelView[]
}

/**
 * A label goes on a record, or comes off it.
 *
 * **It works on a finished retrospective, and that is the point of the feature.**
 * The second usage archetype is a team that uses Retroloop to reach agreement
 * and then moves everything out: on completion of the retrospective they may
 * want to move everything into GitHub right away and manage the lifecycle there,
 * putting a label that says `migrated` on what they moved. That labelling
 * happens **after** the review closes, by construction, so this joins
 * `records.setLifecycle` as a write `refuseWhenFinished` deliberately does not
 * guard — and it is safe for the same reason: labels are not in the export, so a
 * document taken from a finished retrospective cannot change behind its reader
 * (`review.test.ts` enumerates the whole set in one place).
 *
 * **The record has to be in the latest revision**, exactly as it must be to be
 * resolved: a record a later draft withdrew is not part of the retrospective's
 * outcome, and labelling one would write a row nothing displays. Everything
 * listable is labellable and everything labellable is listable.
 *
 * **A retired label cannot be applied and can always be removed.** That is what
 * retiring means — it stops the label being offered, not being taken off — and
 * the asymmetry is deliberate: a record left wearing a retired label with no way
 * to remove it would be a classification nobody can correct.
 *
 * **A no-op is refused rather than absorbed.** Applying a label a record already
 * wears is a caller who believes the store says something it does not, which is
 * the standing `LIFECYCLE_ACT_FROM` sets. It parts from `threads.resolve`, which
 * writes a row for a repeat on the grounds that the human doing it again is a
 * thing that happened — and the difference is what the two acts are: resolving
 * a thread is the human declaring they are finished with a conversation, which
 * they can meaningfully do twice, while a label is a property of the record and
 * "already on" is not a thing anyone means to say again. The page never offers
 * the refused act either way, because it offers Apply for what is off and Remove
 * for what is on.
 */
export class ApplyLabelUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: ApplyLabelInput): Promise<ApplyLabelOutput> {
    ForbiddenActorError.assert(
      'human',
      input.actor,
      input.applied ? 'applying a label to a record' : 'removing a label from a record',
    )

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await resolveRetrospective(repositories, input.retro),
        'retrospective',
        describeRetroRef(input.retro),
      )
      const revision = NotFoundError.require(
        await repositories.revisions.findLatestByRetro(retrospective.id),
        'revision',
        'latest',
      )
      const record = NotFoundError.require(
        revision.records.find((candidate) => candidate.rid === input.rid),
        'record',
        input.rid,
      )
      const label = NotFoundError.require(
        await resolveLabel(repositories.labelDefinitions, input.label),
        'label',
        describeLabelRef(input.label),
      )

      if (input.applied && !isOfferable(label)) {
        throw new ConflictError(
          `the label "${label.name}" was retired at ${label.retiredAt} and is no longer offered; ` +
            'a retired label can still be removed from the records that wear it',
        )
      }

      const entries = await repositories.recordLabels.listForRecord(retrospective.id, record.rid)
      const previous = latestLabelEntry(entries, label.id)
      const standing = previous?.applied ?? false
      if (standing === input.applied) {
        throw new ConflictError(
          `record ${record.rid} of retrospective ${retrospective.id} ` +
            `${standing ? 'already carries' : 'does not carry'} the label "${label.name}"`,
        )
      }

      const at = timestamp(this.clock)
      const written = await repositories.recordLabels.add({
        retroId: retrospective.id,
        rid: record.rid,
        labelId: label.id,
        version: (previous?.version ?? 0) + 1,
        applied: input.applied,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          input.applied ? 'RecordLabelApplied' : 'RecordLabelRemoved',
          at,
          // Scoped to the retrospective and the record, and carrying no
          // `revisionN`: a label outlives every redraft of the record it is on,
          // which is the same reasoning a lifecycle act and a thread resolution
          // give for having none.
          { sessionId: retrospective.sessionId, retroId: retrospective.id, rid: record.rid },
          { labelId: label.id, name: label.name, version: written.version },
        ),
      )

      return {
        retroId: retrospective.id,
        rid: record.rid,
        version: written.version,
        // Folded from the entries the write just joined, through the one
        // function every reader folds with — so the answer a page gets back is
        // the answer the next read would give it.
        labels: resolveRecordLabels(
          [...entries, written],
          definitionsById(await repositories.labelDefinitions.listAll()),
        ),
      }
    })
  }
}
