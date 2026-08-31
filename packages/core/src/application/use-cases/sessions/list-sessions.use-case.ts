import type { Store } from '#application/ports/store.port'
import type { SessionView } from '#application/views/session.view'
import type { Actor } from '#domain/models/actor.model'
import type { SessionStatus } from '#domain/models/session.model'
import { deriveSessionStatus } from '#domain/services/reference.service'

export type ListSessionsInput = {
  readonly actor: Actor
  readonly project?: string
  readonly status?: SessionStatus
  readonly limit?: number
}

export type ListSessionsOutput = {
  readonly sessions: readonly SessionView[]
}

/**
 * Newest first (cli.md `session list`).
 *
 * `status` is derived from each session's retrospectives, so the filter runs
 * after derivation and `limit` runs after the filter — otherwise a limit would
 * silently shrink a filtered page.
 */
export class ListSessionsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListSessionsInput): Promise<ListSessionsOutput> {
    const sessions = await this.store.sessions.list({
      project: input.project,
      limit: input.status === undefined ? input.limit : undefined,
    })

    const views: SessionView[] = []
    for (const session of sessions) {
      const retrospectives = await this.store.retrospectives.listBySession(session.id)
      const status = deriveSessionStatus(retrospectives)
      if (input.status !== undefined && status !== input.status) continue
      views.push({ session, status, retrospectives: retrospectives.length })
    }

    return {
      sessions: input.status === undefined ? views : views.slice(0, input.limit),
    }
  }
}
