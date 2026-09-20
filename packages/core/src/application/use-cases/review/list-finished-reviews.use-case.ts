import type { Store } from '#application/ports/store.port'
import { decisionsByRetro } from '#application/views/record.view'
import { finishedAtByRetro } from '#application/views/retro.view'
import { countReviewRecords, type ReviewCounts } from '#application/views/review.view'
import type { Actor } from '#domain/models/actor.model'

export type FinishedReviewRow = {
  readonly retroId: number
  /** Its place within its session — the "Retro #n" of the identity line. */
  readonly retroNumber: number
  readonly sessionId: number
  /** The Claude session UUID, so an agent can tell whether the round is its own. */
  readonly claudeSession: string
  /** When the human pressed Finish on the revision below. */
  readonly finishedAt: string
  /**
   * Whether the AI has closed it — the *stored* terminal state, and the whole
   * reason both kinds of row are here. A finished round that is not closed is
   * work waiting on the AI; a closed one is a retrospective it can export.
   */
  readonly closed: boolean
  /** The revision that was finished, which is always the latest one. */
  readonly revisionN: number
  readonly counts: ReviewCounts
}

export type ListFinishedReviewsInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type ListFinishedReviewsOutput = {
  readonly reviews: readonly FinishedReviewRow[]
}

/**
 * Every round the human has put down, across the whole stage — the catch-up read
 * behind `review list --finished`.
 *
 * `review wait` is the other half of this and it answers a narrower question: one
 * retrospective, and only about a finish that lands while the command blocks. An
 * agent that was not running when the button was pressed has nowhere to ask what
 * happened — not "which retrospectives exist" (that is the dashboard's read) but
 * "which rounds are finished, and which of them is still waiting on me". So this
 * is addressed to nothing: no retrospective, no session, no actor's own work.
 *
 * **Finished means the latest revision was finished**, which is the same rule the
 * wait applies to a single event. `FinishReviewUseCase` refuses while any record
 * is pending, so a `ReviewFinished` exists only for a round the human answered in
 * full; but the event outlives the round, and a retrospective finished on
 * revision 1 and answered with revision 2 is back with the human. Reading the
 * event alone would list it forever.
 *
 * Oldest first is retro id ascending — the order the rounds happened in, and one
 * that does not depend on a clock. The ordinal beside it is the retrospective's
 * position *within its session*, which is not stored anywhere because ids are
 * global and "Retro #n" is not.
 *
 * Five reads, whatever the number of rows: the retrospectives, the sessions, the
 * latest revision of each retrospective, the latest verdict on each decided
 * record, and every `ReviewFinished` there has ever been. Everything after that
 * is arithmetic over what is already in hand — the same bound
 * `list-retros.use-case.ts` holds, and for the same reason: a stage with a
 * hundred retrospectives must not cost a hundred queries.
 */
export class ListFinishedReviewsUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: ListFinishedReviewsInput): Promise<ListFinishedReviewsOutput> {
    const retrospectives = await this.store.retrospectives.listAll()
    if (retrospectives.length === 0) return { reviews: [] }

    const sessions = new Map(
      (await this.store.sessions.list()).map((session) => [session.id, session]),
    )
    const revisions = new Map(
      (await this.store.revisions.listLatestForEachRetro()).map((revision) => [
        revision.retroId,
        revision,
      ]),
    )
    const decisions = decisionsByRetro(await this.store.decisions.listLatestForEachRetro())
    const finishes = finishedAtByRetro(await this.store.events.list({ names: ['ReviewFinished'] }))

    // Every retrospective is walked, not only the finished ones: the ordinal
    // counts a session's retrospectives in the order they were started, so one
    // that is skipped still moves the number of the next.
    const numbered = new Map<number, number>()
    const reviews: FinishedReviewRow[] = []
    for (const retrospective of retrospectives) {
      const session = sessions.get(retrospective.sessionId)
      if (session === undefined) {
        // Foreign keys make this unreachable; saying so beats a row whose
        // identity line is blank.
        throw new Error(
          `retrospective ${retrospective.id} belongs to session ${retrospective.sessionId}, which is not there`,
        )
      }

      const retroNumber = (numbered.get(session.id) ?? 0) + 1
      numbered.set(session.id, retroNumber)

      const revision = revisions.get(retrospective.id)
      if (revision === undefined) continue
      const finishedAt = finishes.get(retrospective.id)?.get(revision.n)
      if (finishedAt === undefined) continue

      reviews.push({
        retroId: retrospective.id,
        retroNumber,
        sessionId: session.id,
        claudeSession: session.claudeSession,
        finishedAt,
        closed: retrospective.state === 'finished',
        revisionN: revision.n,
        counts: countReviewRecords(revision, decisions.get(retrospective.id)),
      })
    }

    return { reviews }
  }
}
