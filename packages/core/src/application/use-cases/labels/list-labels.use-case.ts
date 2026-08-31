import type { Store } from '#application/ports/store.port'
import type { Actor } from '#domain/models/actor.model'
import type { LabelDefinition } from '#domain/models/label.model'

export type ListLabelsInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type ListLabelsOutput = { readonly labels: readonly LabelDefinition[] }

/**
 * The whole label vocabulary, **retired entries included**, in minting order.
 *
 * One list rather than an offerable/retired pair, because every caller wants
 * both halves and wants them together: the settings page shows the retired ones
 * greyed out, a record page has to resolve a name for a label that may since
 * have been retired, and the filter offers a retired label as long as any record
 * still wears it. Filtering is the reader's, over a list it already holds —
 * there are tens of these, not thousands.
 *
 * **Empty is the normal answer on a store nobody has configured**, and there is
 * no fallback list anywhere: *"we will not hardcode any labels or attributes"*.
 */
export class ListLabelsUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: ListLabelsInput): Promise<ListLabelsOutput> {
    return { labels: await this.store.labelDefinitions.listAll() }
  }
}
