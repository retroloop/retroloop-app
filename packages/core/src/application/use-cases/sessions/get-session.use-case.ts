import type { Store } from '#application/ports/store.port'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import type { Session, SessionStatus } from '#domain/models/session.model'
import {
  deriveSessionStatus,
  resolveSession,
  type SessionRef,
} from '#domain/services/reference.service'

export type GetSessionInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
  readonly session: SessionRef
}

export type GetSessionOutput = {
  readonly session: Session
  readonly status: SessionStatus
  readonly retrospectives: readonly Retrospective[]
  /** What `session get` shows as the notes summary (cli.md). */
  readonly notes: { readonly ai: number; readonly human: number }
}

export class GetSessionUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetSessionInput): Promise<GetSessionOutput> {
    const session = NotFoundError.require(
      await resolveSession(this.store.sessions, input.session),
      'session',
      input.session,
    )
    const retrospectives = await this.store.retrospectives.listBySession(session.id)
    const notes = await this.store.notes.listBySession(session.id)

    return {
      session,
      status: deriveSessionStatus(retrospectives),
      retrospectives,
      notes: {
        ai: notes.filter((note) => note.author === 'ai').length,
        human: notes.filter((note) => note.author === 'human').length,
      },
    }
  }
}
