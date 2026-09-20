import type { Store } from '#application/ports/store.port'
import {
  finishedAtByRevision,
  type RevisionMeta,
  toRevisionMeta,
} from '#application/views/revision.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type ListRevisionsInput = {
  readonly actor: Actor
  readonly retro: RetroRef
}

export type ListRevisionsOutput = {
  readonly retrospective: Retrospective
  readonly revisions: readonly RevisionMeta[]
}

export class ListRevisionsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListRevisionsInput): Promise<ListRevisionsOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revisions = await this.store.revisions.listByRetro(retrospective.id)
    /**
     * One events read for the whole list. The review page asks this for "has the
     * human finished the round I am looking at?", and until then nothing on the
     * wire answered it per revision — `retrospective.finishedAt` is the retro's
     * own close and stays null through every round but the last.
     */
    const finished = finishedAtByRevision(
      await this.store.events.list({ retroId: retrospective.id, names: ['ReviewFinished'] }),
    )

    return {
      retrospective,
      revisions: revisions.map((revision) => toRevisionMeta(revision, finished.get(revision.n))),
    }
  }
}
