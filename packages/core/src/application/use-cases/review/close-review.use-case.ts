import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { decisionsByRid } from '#application/views/record.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { FinishGateError } from '#domain/errors/finish-gate.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import { pendingRids, reviseRids } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type CloseReviewInput = {
  readonly actor: Actor
  readonly retro: RetroRef
}

export type CloseReviewOutput = {
  readonly retrospective: Retrospective
  readonly revisionN: number
}

/**
 * The AI closes the review to export — `reviewing → finished`, terminal, and
 * the last thing that ever happens to a retrospective.
 *
 * It exists because the human's Finish stopped being terminal
 * (`r-one-finish-button`). The human presses one button; the AI then reads what
 * they wrote and either files the next revision or takes the export. **That
 * second outcome is an act with a name and an event of its own** — a state this
 * important may not arrive as a side effect of something else, and `review
 * wait`, the tailer and the page all learn about it the same way they learn
 * about every other write.
 *
 * **It cannot decide anything, and it cannot run early.** Three guards, and
 * none of them is a matter of judgment:
 *
 * - **The human must have finished this round.** A `ReviewFinished` event for
 *   the latest revision is the only thing that opens this door, so the AI can
 *   never close a review the human has not put down. Nothing is inferred from
 *   silence, from an empty comment list, or from time passing.
 * - **The finish gate must still hold.** The human can undo a verdict after finishing
 *   (`r-verdict-revise`), and a record back in `pending` means the export would
 *   be ambiguous — so the gate is asked again here, not just at the finish.
 * - **No record may still ask to be rewritten.** A `revise` verdict is
 *   must-address-in-the-next-revision by the record's own direction; closing
 *   over one would file the human's ask as an outcome. The refusal names them.
 *
 * The actor is `ai`: the CLI is where this act lives (`retro review close`), and
 * the tRPC context is unconditionally `human`, so the browser cannot reach it
 * even if a procedure were added by mistake.
 */
export class CloseReviewUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: CloseReviewInput): Promise<CloseReviewOutput> {
    ForbiddenActorError.assert('ai', input.actor, 'closing a review')

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await resolveRetrospective(repositories, input.retro),
        'retrospective',
        describeRetroRef(input.retro),
      )
      if (retrospective.state === 'finished') {
        throw new ConflictError(`retrospective ${retrospective.id} is already finished`)
      }

      const revision = NotFoundError.require(
        await repositories.revisions.findLatestByRetro(retrospective.id),
        'revision',
        'latest',
      )

      const finished = await repositories.events.list({
        retroId: retrospective.id,
        names: ['ReviewFinished'],
      })
      if (!finished.some((event) => event.revisionN === revision.n)) {
        throw new ConflictError(
          `retrospective ${retrospective.id} revision ${revision.n} has not been finished by the reviewer`,
        )
      }

      const latest = decisionsByRid(
        await repositories.decisions.listLatestByRetro(retrospective.id),
      )
      const pending = pendingRids(revision.records, revision.n, latest)
      if (pending.length > 0) throw new FinishGateError(retrospective.id, pending)

      const revising = reviseRids(revision.records, revision.n, latest)
      if (revising.length > 0) {
        throw new ConflictError(
          `retrospective ${retrospective.id} cannot close: ${revising.join(', ')} ` +
            'asked for a revision — address it in the next revision',
        )
      }

      const at = timestamp(this.clock)
      const closed = NotFoundError.require(
        await repositories.retrospectives.setState(retrospective.id, 'finished', at),
        'retrospective',
        retrospective.id,
      )
      await repositories.events.append(
        newDomainEvent(
          'ReviewClosed',
          at,
          {
            sessionId: retrospective.sessionId,
            retroId: retrospective.id,
            revisionN: revision.n,
          },
          { records: revision.records.length },
        ),
      )

      return { retrospective: closed, revisionN: revision.n }
    })
  }
}
