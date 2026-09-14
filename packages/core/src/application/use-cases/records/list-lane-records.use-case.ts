import type { Store } from '#application/ports/store.port'
import { type LaneSolutionView, laneSolution } from '#application/views/lane.view'
import { decisionsByRetro, requireGlobalId } from '#application/views/record.view'
import {
  type RecordRelationView,
  recordIdsById,
  resolveRecordRelations,
} from '#application/views/relation.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { DomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { CommentThread } from '#domain/models/comment-thread.model'
import type { RecordType, RootCause } from '#domain/models/record.model'
import {
  claimsByRecord,
  type EffectiveClaim,
  effectiveClaim,
} from '#domain/services/record-claim.service'
import { recordKey } from '#domain/services/record-key.service'
import { type LaneState, laneState } from '#domain/services/record-lane.service'
import {
  type EffectiveLifecycle,
  effectiveLifecycle,
  lifecycleByRecord,
} from '#domain/services/record-lifecycle.service'
import { type EffectiveDecision, effectiveDecision } from '#domain/services/record-state.service'

/**
 * **One record as the solving side needs it** — the identity to address it by,
 * the problem to understand it, the human's own words about it, the fix that was
 * chosen, and where it stands on all three axes.
 *
 * It is a wide row on purpose, and that is the departure from `RecordListAllRow`
 * next door, which is deliberately narrow because *"each field here is a field
 * the typed mock has to produce"*. Nothing here is on the wire: this row is read
 * by a CLI command in the same process, by an agent that is about to go and do
 * the work, and the cost of it being narrow is a second read per record — the AI
 * listing a queue of twenty and then opening twenty records to find out what the
 * human said about each. The fields are the ones that decide whether to pick the
 * record up.
 */
export type LaneRecordRow = {
  /** The record's number in the whole ledger — what `claim`, `get` and `relations` take. */
  readonly recordId: number
  readonly retroId: number
  /** Its retrospective's place in its session — the "Retro #n" of the identity line (KC-0011). */
  readonly retroNumber: number
  readonly sessionId: number
  /** The Claude session UUID, so an agent can tell whose session filed this. */
  readonly claudeSession: string
  readonly cwd: string
  /** The record's own name, minted per retrospective (`record.model.ts`). */
  readonly rid: string
  /** Its position within its own retrospective — the order the reviewer read them in. */
  readonly num: number
  readonly title: string
  readonly type: RecordType
  readonly problem: string
  readonly rootCause: RootCause
  /**
   * **The evidence the AI diagnosed from**, as it wrote it — and `undefined` on
   * a record filed before the field existed (`record.model.ts`).
   *
   * It is on the row for the reason the row is wide at all: whoever takes this
   * record off the queue is about to go and reproduce the friction, and the logs
   * and timings the AI already gathered are where that starts. A second read per
   * record to fetch them is the cost this shape exists to avoid.
   */
  readonly diagnosticData: string | undefined
  /**
   * **What the human said about this record, in his words** — the reviewer's
   * note on the verdict first, then every comment he wrote on the record's
   * threads, oldest first.
   *
   * One field rather than two because they are one thing to the reader: the
   * human's instructions. The note is first because it is the one he wrote *with*
   * the verdict, which is the sentence most likely to change how the work is
   * done. The AI's own replies are not here — an agent re-reading what an agent
   * said is noise, and the thread is where a conversation is read.
   */
  readonly ownerWords: readonly string[]
  /** The fix in effect, with its files (`lane.view.ts`). */
  readonly selectedSolution: LaneSolutionView
  /** The verdict in effect, carry-over resolved (D2). */
  readonly decision: EffectiveDecision
  /** Where it stands on the axis that outlives the review. */
  readonly lifecycle: EffectiveLifecycle
  /** Who is holding it right now, if anybody. */
  readonly claim: EffectiveClaim | undefined
  /** The three above, folded into the one word the lane calls it by. */
  readonly laneState: LaneState
  /** What it was said to have to do with other records, both directions. */
  readonly relations: readonly RecordRelationView[]
  /**
   * Where the **review** stands, which is what makes a record lane work at all:
   * the queue is the approved records of rounds the human has finished, and
   * finishing is an event rather than a state (`retrospective.model.ts`).
   */
  readonly review: {
    readonly finished: boolean
    readonly finishedAt: string | undefined
    readonly closed: boolean
  }
}

export type ListLaneRecordsInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
  /**
   * `queue` is the work: approved, unresolved, not archived, in a retrospective
   * the human has finished. `all` is every record of every retrospective's
   * latest revision, whatever state it is in — the history deep dive.
   */
  readonly scope: 'queue' | 'all'
  /** Narrows to one record by its global number; `NotFoundError` when it names none. */
  readonly recordId?: number
  /** Filters on the lane state — the one vocabulary, verdicts included. */
  readonly state?: LaneState
  /** Case-insensitive substring over the title, the rid, the problem and the root cause. */
  readonly text?: string
}

export type ListLaneRecordsOutput = {
  readonly records: readonly LaneRecordRow[]
}

/**
 * **The lane** — the read model behind `record queue`, `record get`,
 * `record relations` and `record list --all`.
 *
 * One use case rather than four, because the four are the same row asked for
 * with different filters. Two projections that drifted would mean `record queue`
 * and `record get` disagreeing about the record an agent is holding open in two
 * terminals, which is the class of bug #103 `r-lifecycle-projection-gap` was
 * filed about — and there the two projections were of *one* field.
 *
 * **The queue's definition is three clauses, and each of them is load-bearing:**
 *
 * - **the human finished the round.** Finishing is his one button (retro 4
 *   `r-one-finish-button`) and the gate behind it guarantees every record was
 *   decided, so a finished round is the point at which an approval means
 *   "go" rather than "he has not got to it yet". It is read from the
 *   `ReviewFinished` events rather than from `retrospective.state`, because that
 *   state only moves on the AI's own close — a round he finished an hour ago is
 *   work, closed or not.
 * - **approved.** Nothing is inferred from silence: a pending record is one he
 *   has not answered, not one he would have said yes to.
 * - **still open.** Resolved is done and archived is out of the way. A
 *   **claimed** record stays on the queue with its marker showing, because the
 *   person reading the queue needs to see what is in progress — hiding it would
 *   answer "there is nothing to do" to somebody who is standing beside two
 *   agents doing things.
 *
 * **The latest revision of each retrospective, and only that** — the revision
 * `records.listAll` lists, the export exports and every write accepts a rid
 * from. Everything the lane offers can be acted on, and everything actionable is
 * on the lane.
 *
 * **A fixed number of reads, whatever the number of rows**: the retrospectives,
 * the sessions, each retrospective's latest revision, the verdict in force on
 * each decided record, the lifecycle entry in force, the claim in force, every
 * global number, every relation in force, and the `ReviewFinished` events —
 * plus one thread read per retrospective, which is the one read that scales with
 * retrospectives rather than being constant. Everything else is arithmetic over
 * what is already in hand.
 */
export class ListLaneRecordsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListLaneRecordsInput): Promise<ListLaneRecordsOutput> {
    const rows = await this.build()

    if (input.recordId !== undefined) {
      const one = rows.find((row) => row.recordId === input.recordId)
      /**
       * The same miss for a number nothing was minted for and for a record a
       * later draft withdrew, and they are the same miss to a caller: a number
       * that does not name a record of the retrospective as it now stands. It is
       * the rule `records.byId` applies, restated here because the lane resolves
       * its rows in one pass rather than by looking one record up.
       */
      return { records: [NotFoundError.require(one, 'record', input.recordId)] }
    }

    const wanted = input.text?.trim().toLowerCase()
    return {
      records: rows.filter(
        (row) =>
          (input.scope === 'all' || onTheQueue(row)) &&
          (input.state === undefined || row.laneState === input.state) &&
          (wanted === undefined || wanted.length === 0 || matches(row, wanted)),
      ),
    }
  }

  /**
   * Every record of every retrospective's latest revision, in lane shape and in
   * lane order — retrospective id ascending, then `num`.
   *
   * Oldest first, which is where this parts from `records.listAll`: that page is
   * a reader catching up and reads newest first; a queue is worked from the
   * front, and the record that has been waiting longest is the one at the top.
   */
  private async build(): Promise<readonly LaneRecordRow[]> {
    const retrospectives = await this.store.retrospectives.listAll()
    if (retrospectives.length === 0) return []

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
    const lifecycle = lifecycleByRecord(await this.store.recordLifecycle.listLatestForEachRecord())
    const claims = claimsByRecord(await this.store.recordClaims.listLatestForEachRecord())
    const minted = await this.store.recordIds.listAll()
    const identities = recordIdsById(minted)
    const relations = await this.store.recordRelations.listLatestForEachPair()
    // One events read for the whole store, filtered to the one name that decides
    // whether a retrospective's records are work (`retro.view.ts` folds the same
    // rows for the dashboard).
    const finishes = finishesByRetro(await this.store.events.list({ names: ['ReviewFinished'] }))

    const numbered = new Map<number, number>()
    const rows: LaneRecordRow[] = []

    for (const retrospective of retrospectives) {
      const session = sessions.get(retrospective.sessionId)
      if (session === undefined) {
        // Foreign keys make this unreachable; saying so beats a row whose
        // identity line is blank (`list-all-records.use-case.ts`).
        throw new Error(
          `retrospective ${retrospective.id} belongs to session ${retrospective.sessionId}, which is not there`,
        )
      }

      // Counted before the skip below, so a retrospective with no records still
      // takes its number — otherwise the lane would call a retro "#1" while the
      // dashboard calls it "#2".
      const retroNumber = (numbered.get(session.id) ?? 0) + 1
      numbered.set(session.id, retroNumber)

      const revision = revisions.get(retrospective.id)
      if (revision === undefined) continue

      const finishedAt = finishes.get(`${retrospective.id} ${revision.n}`)
      const review = {
        finished: finishedAt !== undefined,
        finishedAt,
        closed: retrospective.state === 'finished',
      }

      // One thread read per retrospective rather than one per record: a record's
      // threads are a slice of its retrospective's, and the human's words are
      // read off the same rows for every record on the page.
      const words = ownerWordsByRid(await this.store.threads.listByRetro(retrospective.id))
      const latestDecisions = decisions.get(retrospective.id)
      const globalIds = globalIdsOf(minted, retrospective.id)

      const forRetro: LaneRecordRow[] = []
      for (const record of revision.records) {
        const decision = effectiveDecision(record, revision.n, latestDecisions?.get(record.rid))
        const key = recordKey(retrospective.id, record.rid)
        const standing = effectiveLifecycle(lifecycle.get(key), decision.state)
        const claim = effectiveClaim(claims.get(key))
        const recordId = requireGlobalId(globalIds, retrospective.id, record.rid)

        forRetro.push({
          recordId,
          retroId: retrospective.id,
          retroNumber,
          sessionId: session.id,
          claudeSession: session.claudeSession,
          cwd: session.cwd,
          rid: record.rid,
          num: record.num,
          title: record.title,
          type: record.type,
          problem: record.problem,
          rootCause: record.rootCause,
          diagnosticData: record.diagnosticData,
          ownerWords: ownerWordsOf(decision, words.get(record.rid)),
          selectedSolution: laneSolution(record, decision),
          decision,
          lifecycle: standing,
          claim,
          laneState: laneState(decision, standing, claim),
          // Keyed on the global id, which is what a relation names — and on both
          // columns, because the relation reads from both sides.
          relations: resolveRecordRelations(
            recordId,
            relations.filter((entry) => entry.fromId === recordId || entry.toId === recordId),
            identities,
          ),
          review,
        })
      }

      // The revision stores its records ordered by `num`, and this does not
      // trust that: the order the reviewer read them in is the order the lane
      // offers them in, whatever a blob happens to hold.
      forRetro.sort((left, right) => left.num - right.num)
      rows.push(...forRetro)
    }

    return rows
  }
}

/** The three clauses of "this is work" (see the class docstring). */
function onTheQueue(row: LaneRecordRow): boolean {
  return row.review.finished && row.decision.state === 'approved' && row.lifecycle.status === 'open'
}

/**
 * The five fields a search reads, in one place.
 *
 * They are the ones somebody types a phrase out of when they are looking for
 * *"that record about the lock"*: what it is called, what it is named, what
 * happened, why it happened, and what was underneath. The human's own words are
 * deliberately not searched — a comment is a conversation, and a search that
 * matched one would return the record somebody argued about rather than the
 * record that is about the thing.
 */
function matches(row: LaneRecordRow, wanted: string): boolean {
  const haystack = [
    row.title,
    row.rid,
    row.problem,
    row.rootCause.whatHappened,
    ...row.rootCause.whys,
    row.rootCause.root,
  ]
  return haystack.some((field) => field.toLowerCase().includes(wanted))
}

/** The reviewer's note, then his comments on the record — see `LaneRecordRow.ownerWords`. */
function ownerWordsOf(
  decision: EffectiveDecision,
  comments: readonly string[] | undefined,
): readonly string[] {
  const note = decision.reviewerNote?.trim()
  return [...(note === undefined || note.length === 0 ? [] : [note]), ...(comments ?? [])]
}

/**
 * Every human comment on each record's threads, oldest first, keyed by rid.
 *
 * Flattened across the record's threads and sorted by the clock, because a
 * record has one thread per section and the human's instructions are one
 * conversation to whoever is about to act on them — the section they were
 * written under is on the thread and is read there.
 *
 * Review-level threads carry no rid and belong to no record, so they are not
 * here: a remark about the round is not an instruction about a record.
 */
function ownerWordsByRid(threads: readonly CommentThread[]): ReadonlyMap<string, string[]> {
  const said = new Map<string, { at: string; text: string }[]>()
  for (const thread of threads) {
    if (thread.rid === undefined) continue
    const forRecord = said.get(thread.rid) ?? []
    said.set(thread.rid, forRecord)
    for (const message of thread.messages) {
      if (message.actor !== 'human') continue
      forRecord.push({ at: message.at, text: message.text })
    }
  }

  return new Map(
    [...said].map(([rid, messages]) => [
      rid,
      messages
        .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
        .map((message) => message.text),
    ]),
  )
}

/**
 * When each round was finished, keyed `"<retroId> <revisionN>"`.
 *
 * The latest event wins, because the human may finish a round, take a verdict
 * back and finish it again — and what a lane row says is when he last put it
 * down.
 */
function finishesByRetro(events: readonly DomainEvent[]): ReadonlyMap<string, string> {
  const finishes = new Map<string, string>()
  for (const event of events) {
    if (event.retroId === undefined || event.revisionN === undefined) continue
    finishes.set(`${event.retroId} ${event.revisionN}`, event.at)
  }
  return finishes
}

/** One retrospective's global numbers, keyed by rid — the slice `requireGlobalId` asks. */
function globalIdsOf(
  minted: readonly { readonly retroId: number; readonly rid: string; readonly id: number }[],
  retroId: number,
): ReadonlyMap<string, number> {
  return new Map(minted.filter((row) => row.retroId === retroId).map((row) => [row.rid, row.id]))
}
