import type { Store } from '#application/ports/store.port'
import type { Actor } from '#domain/models/actor.model'
import type { AttributeDefinition } from '#domain/models/attribute.model'

export type ListAttributesInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type ListAttributesOutput = { readonly attributes: readonly AttributeDefinition[] }

/**
 * The whole attribute vocabulary, retired entries included, in minting order —
 * the same shape and the same reasoning `ListLabelsUseCase` has.
 *
 * It is a second list rather than one call answering for both primitives, which
 * is the shape the owner's ruling asks for: labels and attributes are pure and
 * independent, and a single `definitions.list` would make every reader of either
 * hold both. The settings page asks for two answers because it renders two
 * sections; the record page asks for two because it renders two blocks.
 */
export class ListAttributesUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: ListAttributesInput): Promise<ListAttributesOutput> {
    return { attributes: await this.store.attributeDefinitions.listAll() }
  }
}
