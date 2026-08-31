import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { decisionsByRid } from '#application/views/record.view'
import { FinishGateError } from '#domain/errors/finish-gate.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import { refuseWhenFinished } from '#domain/services/finish-lock.service'
import { pendingRids } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type FinishReviewInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  /**
   * His final word on the round, offered and never demanded
   * (`r-finish-confirm-message`). Blank is the same as absent: an empty box is
   * not a message, and nothing is ever inferred from silence (KC-0010).
   */
  readonly finishMessage?: string
}

export type FinishReviewOutput = {
  readonly retrospective: Retrospective
  readonly revisionN: number
  /**
   * False when this call absorbed a repeat press of the same round's one
   * button: nothing was written and the answer is the one the first press got.
   */
  readonly finishedNow: boolean
}

/**
 * The human's explicit "Finish review" — **the one terminal action on the page**
 * (retro 4 `r-one-finish-button`), and the end of *his* side of this round.
 *
 * It is not the end of the retrospective. The owner removed the second button
 * because the choice it asked him to restate is already in what he wrote:
 * *"there should be just one button, I say finish review, and you then look at
 * what I requested and, based on it, send a new revision — or say OK, there are
 * no new requests."* So this appends `ReviewFinished` and leaves the
 * retrospective `reviewing`; the AI reads the round and either files the next
 * revision or closes the review to export (`close-review.use-case.ts`). Nothing
 * here is inferred from silence — the AI acts only *after* this explicit press,
 * and only on words the human actually wrote (KC-0010).
 *
 * **The finish gate:** refused while any record of the latest revision is
 * effectively pending. That is what makes an export unambiguous — every record
 * in it carries a verdict a human actually gave. `revise` is one of those
 * verdicts (`r-verdict-revise`): asking for a rewrite is an answer, and the gate
 * wants an answer.
 *
 * **Once per round** (retro 4 `r-request-changes-multi-press`, the owner:
 * *"why am I able to press it multiple times?"*). A second press for
 * the same revision is absorbed: no second event, no error to read, and the
 * same outcome comes back. The page disables the button on the first press;
 * this is the half that holds when something gets past the page.
 *
 * **The final message rides the press** (`r-finish-confirm-message`, the owner:
 * *"if it is actually valid and can be closed then it should show a text box
 * where the human can enter their final message before they close so this
 * message is going to be delivered separately from the comments"*). It is
 * optional, it is written in the same unit of work as the event, and a blank one
 * writes no row at all. An absorbed press carries no message either, for the
 * reason it carries no event: the round was already closed, and a second word on
 * a round that already has one would be an edit by another name.
 */
export class FinishReviewUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: FinishReviewInput): Promise<FinishReviewOutput> {
    ForbiddenActorError.assert('human', input.actor, 'finishing a review')

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await resolveRetrospective(repositories, input.retro),
        'retrospective',
        describeRetroRef(input.retro),
      )
      refuseWhenFinished(retrospective, 'its review is closed')

      const revision = NotFoundError.require(
        await repositories.revisions.findLatestByRetro(retrospective.id),
        'revision',
        'latest',
      )

      const pending = pendingRids(
        revision.records,
        revision.n,
        decisionsByRid(await repositories.decisions.listLatestByRetro(retrospective.id)),
      )
      if (pending.length > 0) throw new FinishGateError(retrospective.id, pending)

      const already = await repositories.events.list({
        retroId: retrospective.id,
        names: ['ReviewFinished'],
      })
      if (already.some((event) => event.revisionN === revision.n)) {
        return { retrospective, revisionN: revision.n, finishedNow: false }
      }

      const at = timestamp(this.clock)

      // Written before the event and inside the same `tx`, so the word he left
      // exists if and only if the round it closes does (KC-0005).
      const message = input.finishMessage?.trim() ?? ''
      if (message.length > 0) {
        const previous = await repositories.finishMessages.findLatest(retrospective.id, revision.n)
        await repositories.finishMessages.add({
          retroId: retrospective.id,
          revisionN: revision.n,
          version: (previous?.version ?? 0) + 1,
          message,
          at,
        })
      }

      await repositories.events.append(
        newDomainEvent(
          'ReviewFinished',
          at,
          {
            sessionId: retrospective.sessionId,
            retroId: retrospective.id,
            revisionN: revision.n,
          },
          { records: revision.records.length },
        ),
      )

      return { retrospective, revisionN: revision.n, finishedNow: true }
    })
  }
}
