import type { Store } from '#application/ports/store.port'
import { decisionsByRetro } from '#application/views/record.view'
import {
  finishedRoundsByRetro,
  type RetroDisplayState,
  retroDisplayState,
} from '#application/views/retro.view'
import type { Actor } from '#domain/models/actor.model'
import type { Decision } from '#domain/models/decision.model'
import type { Revision } from '#domain/models/revision.model'
import { effectiveDecision } from '#domain/services/record-state.service'

/**
 * The session a retrospective is shown under. Session id and `cwd` are the
 * identity line — "Retro #n · Session S · <cwd>" — and `cwd` is the anchor
 * because Claude Code pins it for the life of a session.
 */
export type RetroListSession = {
  readonly id: number
  readonly cwd: string
  readonly startedAt: string
}

/** The latest revision's records, split the way a dashboard row reads them. */
export type RetroListCounts = {
  /** Still waiting on the human — what the finish gate blocks on (D3). */
  readonly pending: number
  /** Approved or declined: everything the human has answered. */
  readonly decided: number
}

export type RetroListRow = {
  readonly retroId: number
  /** Its place within its session — the "Retro #n" of the identity line. */
  readonly retroNumber: number
  /** The latest revision's title; absent when that revision proposed none. */
  readonly title: string | undefined
  /**
   * The **displayed** state, `submitted` among them — this row and the review
   * page's header say the same word about the same retrospective, which is the
   * whole of why the tag they both render is one component (`retro-state.tsx`).
   */
  readonly state: RetroDisplayState
  readonly counts: RetroListCounts
  readonly session: RetroListSession
}

export type ListRetrosInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type ListRetrosOutput = {
  readonly retros: readonly RetroListRow[]
}

/**
 * How much of this retrospective's latest draft the human has answered.
 *
 * Counted from *effective* state, which is why it needs the verdicts and not
 * just the records: a decision carried over from an earlier revision counts as
 * decided, and a record whose narrative changed after it was decided counts as
 * pending again (D2). These are the same semantics `review status` and the
 * review page's pending count use, because they call the same function.
 */
function countRecords(
  revision: Revision | undefined,
  latest: ReadonlyMap<string, Decision> | undefined,
): RetroListCounts {
  if (revision === undefined) return { pending: 0, decided: 0 }

  let pending = 0
  for (const record of revision.records) {
    if (effectiveDecision(record, revision.n, latest?.get(record.rid)).state === 'pending') {
      pending += 1
    }
  }
  return { pending, decided: revision.records.length - pending }
}

/**
 * Every retrospective in the stage, newest first — the whole read model behind
 * dashboard v1.
 *
 * Flat and unfiltered: a retro is shown under its session and its cwd, and
 * nothing here groups, routes or filters by project. "Newest first" is retro id
 * descending, so the order does not depend on a clock, and the ordinal is the
 * retrospective's position *within its session* — the "Retro #n" of the identity
 * line, which is not stored anywhere because ids are global and #n is not.
 *
 * Five reads, whatever the number of rows: the retrospectives, the sessions, the
 * latest revision of each retrospective, the latest verdict on each decided
 * record, and every `ReviewFinished` there has ever been. Everything after that
 * is arithmetic over what is already in hand.
 *
 * The fifth was four until the intermediate status shipped, and it is here
 * deliberately rather than smuggled in beside the pin. `submitted` — the human
 * has put the round down and the AI has not closed it — is a reading of the
 * `ReviewFinished` events, the only record of that act, and there is nowhere
 * else to read it from: a row's `state` column says `reviewing` for the whole of
 * that window. One filtered query answers it for every retrospective at once
 * (`finishedRoundsByRetro`), so the count of reads still does not move with the
 * count of rows, which is what this pin has always been about. What it does grow
 * with is rounds finished across the store — a bound the events table sets, not
 * this dashboard.
 */
export class ListRetrosUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: ListRetrosInput): Promise<ListRetrosOutput> {
    const retrospectives = await this.store.retrospectives.listAll()
    if (retrospectives.length === 0) return { retros: [] }

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
    const finishedRounds = finishedRoundsByRetro(
      await this.store.events.list({ names: ['ReviewFinished'] }),
    )

    // Oldest first, so each session's retrospectives are numbered in the order
    // they were started; the answer is reversed at the end because the dashboard
    // reads newest first.
    const numbered = new Map<number, number>()
    const rows: RetroListRow[] = []
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

      rows.push({
        retroId: retrospective.id,
        retroNumber,
        title: revision?.title,
        state: retroDisplayState(
          retrospective.state,
          revision !== undefined && finishedRounds.get(retrospective.id)?.has(revision.n) === true,
        ),
        counts: countRecords(revision, decisions.get(retrospective.id)),
        session: { id: session.id, cwd: session.cwd, startedAt: session.startedAt },
      })
    }

    return { retros: rows.reverse() }
  }
}
