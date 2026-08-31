import type { AttributeDefinition, AttributeType } from '#domain/models/attribute.model'
import type { LabelDefinition } from '#domain/models/label.model'
import type { RecordAttributeValueEntry } from '#domain/models/record-attribute-value.model'
import type { RecordLabelEntry } from '#domain/models/record-label.model'
import { setAttributeValues } from '#domain/services/record-attribute.service'
import { appliedLabelIds } from '#domain/services/record-label.service'

/**
 * What a record wears, joined to the vocabulary it wears it from.
 *
 * The store keeps the two apart — a `record_labels` row names a definition id
 * and nothing else — which is what makes a rename change every record at once
 * (`rename-label.use-case.ts`). Every reader therefore does this join, and doing
 * it here rather than in three use cases is what keeps the record page, the
 * review card and the flat list from resolving a name three ways.
 *
 * **The join carries `retired`**, which is the one fact about a definition a
 * record's reader still needs: a retired label goes on rendering where it was
 * applied, and the page draws it differently so the reader is not left wondering
 * why it is not on the list of labels they can add.
 */
export type RecordLabelView = {
  readonly id: number
  readonly name: string
  /** Retired definitions stop being offerable and go on rendering where applied. */
  readonly retired: boolean
}

export type RecordAttributeView = {
  readonly id: number
  readonly name: string
  readonly type: AttributeType
  readonly value: string
  readonly retired: boolean
}

/**
 * The labels a record wears, resolved — **in the vocabulary's own order**, which
 * is minting order.
 *
 * Not alphabetical, deliberately: the settings page lists the vocabulary in
 * minting order too, so the tags on a record read in the same order as the list
 * they came from. Alphabetical would have been a second ordering for a reader to
 * hold, and it would reshuffle every record's tags the day somebody renames one.
 *
 * A definition a row points at is always there — the column is a foreign key —
 * so a miss is a store that lost a row rather than a state the product can
 * reach, and it shouts on the same standing `requireGlobalId` does: naming the
 * label with no definition beats rendering a blank tag.
 */
export function resolveRecordLabels(
  entries: readonly RecordLabelEntry[],
  definitions: ReadonlyMap<number, LabelDefinition>,
): readonly RecordLabelView[] {
  return appliedLabelIds(entries).map((labelId) => {
    const definition = definitions.get(labelId)
    if (definition === undefined) {
      throw new Error(`record label ${labelId} has no definition; the store is missing a row`)
    }
    return {
      id: definition.id,
      name: definition.name,
      retired: definition.retiredAt !== undefined,
    }
  })
}

/** The values a record carries, resolved — same order and same reasoning. */
export function resolveRecordAttributes(
  entries: readonly RecordAttributeValueEntry[],
  definitions: ReadonlyMap<number, AttributeDefinition>,
): readonly RecordAttributeView[] {
  return setAttributeValues(entries).map(({ attributeId, value }) => {
    const definition = definitions.get(attributeId)
    if (definition === undefined) {
      throw new Error(
        `record attribute ${attributeId} has no definition; the store is missing a row`,
      )
    }
    return {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      value,
      retired: definition.retiredAt !== undefined,
    }
  })
}

/** A vocabulary, keyed by id — the shape both joins above take. */
export function definitionsById<T extends { readonly id: number }>(
  definitions: readonly T[],
): ReadonlyMap<number, T> {
  return new Map(definitions.map((definition) => [definition.id, definition]))
}
