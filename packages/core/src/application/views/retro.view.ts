import type { DomainEvent } from '#domain/events/domain-event.model'
import type { RetrospectiveState } from '#domain/models/retrospective.model'

/**
 * What a reader is told a retrospective is in — the three states it is *stored*
 * in, and a fourth that is only ever **derived**.
 *
 * `submitted` is the owner's session-11 add, carried on his ack ever since:
 * *"There should be a status in between that indicates that the human has
 * submitted but AI hasn't closed"*. Until now the product had the fact and no
 * word for it — the review bar said "Retro submitted" beside a header tag that
 * still read REVIEWING, and the dashboard row said REVIEWING too, so the one
 * screen that told him a round was with the AI was the one he had already
 * scrolled to the bottom of.
 *
 * **It is a reading, not a state.** `retrospective.state` is untouched: the
 * machine is still `open → reviewing → finished`, `ReviewFinished` is still an
 * event and not a transition, and `ReviewClosed` is still the only edge into
 * `finished` (`lifecycle.md`, `retrospective.model.ts`). Nothing is stored to
 * answer this and no migration carries it — it is the same kind of answer
 * `effectiveDecision` and `effectiveLifecycle` give on their own axes, and it
 * can be computed from facts every read model already has in hand.
 */
export type RetroDisplayState = RetrospectiveState | 'submitted'

/**
 * The reading, in one place so the dashboard row, the review header and
 * `review status` cannot disagree about it.
 *
 * `submitted` is `reviewing` **and** the human has finished the round that is
 * current. Both halves matter. Without the first, a finished retrospective —
 * whose last round is finished too — would read `submitted` forever instead of
 * `finished`. Without the second, the word would appear the moment a revision
 * was filed, which is the opposite of what it means.
 *
 * The round that counts is the **latest** one. A round he finished two
 * revisions ago is not what he is waiting on; the AI answered it by filing the
 * next draft, and the retro went back to being his.
 */
export function retroDisplayState(
  state: RetrospectiveState,
  latestRoundFinished: boolean,
): RetroDisplayState {
  return state === 'reviewing' && latestRoundFinished ? 'submitted' : state
}

/**
 * Which rounds have been finished, per retrospective — the cross-retro shape of
 * `finishedAtByRevision`, for the one read model that answers about every
 * retrospective at once (`list-retros.use-case.ts`).
 *
 * A set of revision numbers rather than a timestamp map: the dashboard asks
 * *whether* the round was put down, never *when*. The review page asks when,
 * and that is `revision.view.ts` — which reads one retrospective and keeps its
 * answer keyed the way a revision list needs it.
 *
 * Built in one pass over one query's rows, so a store with a hundred
 * retrospectives still costs the caller a single events read.
 */
export function finishedRoundsByRetro(
  events: readonly DomainEvent[],
): ReadonlyMap<number, ReadonlySet<number>> {
  const rounds = new Map<number, Set<number>>()
  for (const event of events) {
    if (event.name !== 'ReviewFinished') continue
    if (event.retroId === undefined || event.revisionN === undefined) continue
    const known = rounds.get(event.retroId)
    if (known === undefined) rounds.set(event.retroId, new Set([event.revisionN]))
    else known.add(event.revisionN)
  }
  return rounds
}
