import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseAttributeValue } from '#application/schemas/definition-input.schema'
import {
  definitionsById,
  type RecordAttributeView,
  resolveRecordAttributes,
} from '#application/views/definition.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import {
  type AttributeRef,
  describeAttributeRef,
  isOfferable,
  resolveAttribute,
} from '#domain/services/definition.service'
import { latestAttributeEntry } from '#domain/services/record-attribute.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type SetAttributeValueInput = {
  /**
   * **Human only, whatever the AI-config-write toggle says** — the same standing
   * applying a label has, and for the same reason: the toggle governs the
   * definitions, and this is a value on a human's record
   * (`apply-label.use-case.ts`).
   */
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
  readonly attribute: AttributeRef
  /**
   * What to set it to, or **absent to clear it**.
   *
   * Clearing is an act rather than a missing field: the row it writes says the
   * record no longer carries a value, which is a different fact from never
   * having carried one. That is why absence here is meaningful where absence is
   * meaningful nowhere else in this system — the caller is saying "take it off",
   * not saying nothing.
   */
  readonly value?: string
}

export type SetAttributeValueOutput = {
  readonly retroId: number
  readonly rid: string
  /** The version just written, 1-based and dense per `(retroId, rid, attributeId)`. */
  readonly version: number
  /**
   * Every value the record carries now, resolved against the vocabulary — the
   * same shape a read of the record answers with, for the reason its label twin
   * gives (`apply-label.use-case.ts`).
   */
  readonly values: readonly RecordAttributeView[]
}

/**
 * A record gets a value for an attribute, or has one cleared — the second half
 * of the owner's pairing: *"whenever we add the migrated label, we should also
 * have an attribute that requires a GitHub issue id"*.
 *
 * The pairing is his team's convention and **nothing here checks it**. A record
 * can carry a value with no labels at all, and wear `migrated` with nothing set;
 * the system enforces no relationship between the two primitives, which is the
 * ruling in as many words: *"composition is the USER'S convention … never a
 * system mechanism"*.
 *
 * Everything else this use case does, `ApplyLabelUseCase` does one table over:
 * it is human-only, it works on a **finished** retrospective because that is
 * where the migrate story happens, it insists the record is in the latest
 * revision, and a retired attribute can be cleared but not set.
 *
 * Two places it deliberately differs from its twin:
 *
 * 1. **Validation, per the definition's type.** `parseAttributeValue` runs
 *    after the attribute is resolved, because the rule to check depends on the
 *    row — a `date` attribute and a `text` attribute take different values under
 *    the same call. It is deliberately light: a number parses, a URL names a web
 *    address, a date is a calendar day (*"we don't have to put in a lot of
 *    validations"*).
 * 2. **Setting the same value again is allowed**, where applying a label a
 *    record already wears is refused. A label is a bit and "already on" is not a
 *    thing anyone means to say twice; a value is an assignment, and re-asserting
 *    one is what `decisions.record` already permits for a verdict. What is still
 *    refused is **clearing what is not there**, which is the act that did
 *    nothing.
 */
export class SetAttributeValueUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: SetAttributeValueInput): Promise<SetAttributeValueOutput> {
    ForbiddenActorError.assert(
      'human',
      input.actor,
      input.value === undefined
        ? 'clearing an attribute value on a record'
        : 'setting an attribute value on a record',
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
      const attribute = NotFoundError.require(
        await resolveAttribute(repositories.attributeDefinitions, input.attribute),
        'attribute',
        describeAttributeRef(input.attribute),
      )

      if (input.value !== undefined && !isOfferable(attribute)) {
        throw new ConflictError(
          `the attribute "${attribute.name}" was retired at ${attribute.retiredAt} and is no ` +
            'longer offered; a retired attribute can still be cleared from the records that carry it',
        )
      }

      // After the resolve, because which rule applies is a fact about the row.
      const value =
        input.value === undefined ? undefined : parseAttributeValue(attribute.type, input.value)

      const entries = await repositories.recordAttributeValues.listForRecord(
        retrospective.id,
        record.rid,
      )
      const previous = latestAttributeEntry(entries, attribute.id)
      if (value === undefined && previous?.value === undefined) {
        throw new ConflictError(
          `record ${record.rid} of retrospective ${retrospective.id} carries no value for ` +
            `"${attribute.name}", so there is nothing to clear`,
        )
      }

      const at = timestamp(this.clock)
      const written = await repositories.recordAttributeValues.add({
        retroId: retrospective.id,
        rid: record.rid,
        attributeId: attribute.id,
        version: (previous?.version ?? 0) + 1,
        value,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          value === undefined ? 'RecordAttributeCleared' : 'RecordAttributeSet',
          at,
          // No `revisionN`: a value outlives every redraft of the record it is
          // on, the same reasoning a label and a lifecycle act give.
          { sessionId: retrospective.sessionId, retroId: retrospective.id, rid: record.rid },
          { attributeId: attribute.id, name: attribute.name, version: written.version },
        ),
      )

      return {
        retroId: retrospective.id,
        rid: record.rid,
        version: written.version,
        values: resolveRecordAttributes(
          [...entries, written],
          definitionsById(await repositories.attributeDefinitions.listAll()),
        ),
      }
    })
  }
}
