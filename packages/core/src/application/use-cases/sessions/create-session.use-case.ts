import { z } from 'zod'
import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Session } from '#domain/models/session.model'

export type CreateSessionInput = {
  readonly actor: Actor
  /**
   * The Claude session UUID. Only ever used as an idempotency key, so it is
   * checked for presence and not for UUID syntax — a caller with a different
   * stable identifier is not the thing this rule exists to catch.
   */
  readonly claudeSession: string
  /** Optional and dormant — nothing downstream may depend on it. */
  readonly project?: string
  readonly cwd: string
  readonly branch?: string
  readonly supervised?: boolean
}

export type CreateSessionOutput = {
  readonly session: Session
  /** `false` when the call matched an existing registration and changed nothing. */
  readonly created: boolean
}

const inputSchema = z.strictObject({
  claudeSession: nonEmptyTextSchema,
  project: nonEmptyTextSchema.optional(),
  cwd: nonEmptyTextSchema,
  branch: nonEmptyTextSchema.optional(),
  supervised: z.boolean().optional(),
})

/**
 * Registers a session (cli.md `session create`). Idempotent by the Claude session
 * UUID: calling it twice returns the first registration and appends no second
 * event, because nothing happened the second time.
 *
 * Session identity is AI-written and write-once (data-model.md §Mutability
 * matrix) — a re-registration never updates the stored row, so a later call
 * carrying a different project or cwd cannot rewrite history.
 */
export class CreateSessionUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateSessionInput): Promise<CreateSessionOutput> {
    ForbiddenActorError.assert('ai', input.actor, 'registering a session')
    const fields = parseOrThrow(
      inputSchema,
      {
        claudeSession: input.claudeSession,
        project: input.project,
        cwd: input.cwd,
        branch: input.branch,
        supervised: input.supervised,
      },
      'session',
    )

    return this.store.tx(async (repositories) => {
      const existing = await repositories.sessions.findByClaudeSession(fields.claudeSession)
      if (existing !== undefined) return { session: existing, created: false }

      const at = timestamp(this.clock)
      const session = await repositories.sessions.add({
        claudeSession: fields.claudeSession,
        project: fields.project,
        cwd: fields.cwd,
        branch: fields.branch,
        supervised: fields.supervised ?? false,
        startedAt: at,
      })
      await repositories.events.append(
        newDomainEvent(
          'SessionCreated',
          at,
          { sessionId: session.id },
          { project: session.project ?? null },
        ),
      )
      return { session, created: true }
    })
  }
}
