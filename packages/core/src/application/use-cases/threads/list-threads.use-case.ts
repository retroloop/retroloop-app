import type { Store } from '#application/ports/store.port'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type ListThreadsInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  /** Only this record's threads. */
  readonly rid?: string
  /** `comment list --unanswered`: threads whose last message is the human's. */
  readonly unansweredOnly?: boolean
}

export type ListThreadsOutput = {
  readonly retroId: number
  readonly threads: readonly ThreadView[]
}

/**
 * "Unanswered" is defined by the last message being human — not by any flag a
 * writer sets, so it cannot drift out of sync with the conversation itself.
 *
 * "Resolved" is the opposite kind of thing and is stored: it is the human saying
 * they are done with a thread, which nothing about the conversation implies
 * (`r-resolvable-comments`). The two live side by side on every view here.
 */
export class ListThreadsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListThreadsInput): Promise<ListThreadsOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )

    const threads = await this.store.threads.listByRetro(retrospective.id, {
      rid: input.rid,
      unansweredOnly: input.unansweredOnly,
    })

    return {
      retroId: retrospective.id,
      threads: await loadThreadViews(this.store, retrospective.id, threads),
    }
  }
}
