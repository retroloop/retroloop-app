import type { Store } from '#application/ports/store.port'
import type { RetroListSession } from '#application/use-cases/retros/list-retros.use-case'
import {
  definitionsById,
  type RecordLabelView,
  resolveRecordLabels,
} from '#application/views/definition.view'
import { decisionsByRid, requireGlobalId } from '#application/views/record.view'
import type { Actor } from '#domain/models/actor.model'
import type { Decision, DecisionState } from '#domain/models/decision.model'
import {
  type Involvement,
  type Party,
  proposedLevel,
  type RecordType,
  type Severity,
  type SolutionLevel,
} from '#domain/models/record.model'
import type { RecordId } from '#domain/models/record-id.model'
import {
  claimsByRecord,
  type EffectiveClaim,
  effectiveClaim,
} from '#domain/services/record-claim.service'
import { labelEntriesByRecord } from '#domain/services/record-label.service'
import type { EffectiveLifecycle } from '#domain/services/record-lifecycle.service'
import {
  effectiveLifecycle,
  lifecycleByRecord,
  lifecycleKey,
} from '#domain/services/record-lifecycle.service'
import { effectiveDecision } from '#domain/services/record-state.service'

/**
 * One record, anywhere in the stage — the row behind a page that shows all the
 * retrospective items flat, with filtering, so that every item can be seen in
 * one list irrespective of the session, the retrospective or the cwd.
 *
 * Deliberately narrow, on the rule every wire row in this repo obeys: each field
 * here is a field the typed mock has to produce and keep producing. It carries
 * the identity line, enough of the record to read and filter it, where the
 * verdict stands, and where the lifecycle stands. What it does not carry — the
 * problem statement, the solutions, the reviewer's note, the involvement — is
 * one navigation away on the review page, which is the detail view for a record
 * and stays the only one (A6/A7).
 */
export type RecordListAllRow = {
  readonly retroId: number
  /** Its retrospective's place in its session — the "Retro #n" of the identity line. */
  readonly retroNumber: number
  /** Session id, cwd and start — the same shape `retros.list` carries, so one reader renders both. */
  readonly session: RetroListSession
  readonly rid: string
  /**
   * The number this page shows — the record's place in the whole ledger
   * (`record-id.model.ts`). It is what the global number exists for, and this
   * page is where the reason is plainest: three retrospectives' records in one
   * list, and every one of them used to open with a "#1".
   */
  readonly globalId: number
  /** Its position **within its own retrospective**, still real and no longer shown. */
  readonly num: number
  readonly title: string
  readonly type: RecordType
  /** Who raised it. One of the three filters this page offers. */
  readonly requester: Party
  /**
   * The verdict **in effect** — carried over from an earlier revision where it
   * still binds, and back to `pending` where the narrative changed under it
   * (D2). Resolved by `effectiveDecision`, which writes nothing.
   */
  readonly state: DecisionState
  /**
   * The severity in effect: the human's once they have decided, the AI's
   * proposal until then. The same rule the three dials follow, and the reason
   * this is not `record.defaults.severity` — a page that filtered on SEV3 while
   * the reviewer had moved it to SEV5 would be filtering on a superseded number.
   */
  readonly severity: Severity
  /**
   * What the AI proposed as the ceiling, whichever shape the record was filed
   * in: the authored field on a legacy record, the recommended solution's level
   * on one with solutions. `proposedLevel()` is the one function that answers
   * this, so this row cannot disagree with the review page or the export.
   */
  readonly proposedLevel: SolutionLevel
  /**
   * Where the record stands on the axis that outlives the review — `open`,
   * `resolved` or `archived` — plus the latest entry's refs, note and actor.
   * Derived from the entry in force and, while there is none, from the verdict
   * beside it: a declined record is archived from birth (`lifecycle.md`).
   */
  readonly lifecycle: EffectiveLifecycle
  /**
   * **How much of the human this record's fix needs** — the involvement in
   * effect, the human's once they have decided and the AI's proposal until then,
   * exactly like `severity` and `state` above.
   *
   * It is here because the dashboard's fourth stat tile counts the records that
   * are open **and** `interactive`, and a count over every open record cannot be
   * answered by the per-record read: that is one round trip per open record.
   *
   * **This widened the wire, and it was taken knowingly.** The tradeoffs are
   * real: two of the five values (`other`, `undecided`) cannot be read as
   * needs-the-human without a human reading a free text note, `undecided` is
   * also the field's default, and on a store where nearly every record is
   * `autonomous` the tile reads very low. `interactive` is still the single
   * value that counts, so the field ships and the tile is honest about what it
   * is counting rather than approximating it from something already on the row.
   *
   * From `effectiveDecision`, never from `record.defaults` — a page counting the
   * AI's proposal while the reviewer had changed it would be counting a
   * superseded value, the same reason `severity` is derived and not authored.
   */
  readonly involvement: Involvement
  /**
   * The labels the record wears, resolved against the vocabulary — the fourth
   * thing this page can be narrowed by, and the reason the row carries names
   * rather than ids: a row that carried ids would make every reader of this
   * listing hold the vocabulary too, and the filter is the only part of the page
   * that needs it (`records-filter.tsx`).
   *
   * **Not the attribute values.** A value is data about one record and is a
   * thing you go and look at, so it lives on the record's own page; a row that
   * carried both would be a row producing a field nothing on this page renders.
   */
  readonly labels: readonly RecordLabelView[]
  /**
   * **Who is holding this record right now**, if anybody — the in-progress
   * marker (`record-claim.model.ts`).
   *
   * It is on the row for the reason `lifecycle` is: this page is where somebody
   * looks to see what is going on across every retrospective at once, and "an
   * agent is on this one" is the single most perishable thing a row can say. A
   * reader that had to open each record to find out would be making one round
   * trip per record on the store to render one badge.
   *
   * `undefined` is a record nobody is holding — the same answer for one nobody
   * ever held and one somebody gave back (`record-claim.service.ts`).
   */
  readonly claim: EffectiveClaim | undefined
}

export type ListAllRecordsInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type ListAllRecordsOutput = {
  readonly records: readonly RecordListAllRow[]
}

/** The latest decision of each record, grouped by the retrospective it belongs to. */
function decisionsByRetro(
  decisions: readonly Decision[],
): ReadonlyMap<number, ReadonlyMap<string, Decision>> {
  const rows = new Map<number, Decision[]>()
  for (const decision of decisions) {
    const known = rows.get(decision.retroId)
    if (known === undefined) rows.set(decision.retroId, [decision])
    else known.push(decision)
  }
  return new Map([...rows].map(([retroId, forRetro]) => [retroId, decisionsByRid(forRetro)]))
}

/**
 * Every record's global number, grouped by the retrospective it belongs to.
 *
 * Grouped rather than kept flat under a joined key, because a rid is minted per
 * retrospective and this is the one listing that holds two retrospectives'
 * records at once (A5) — the same reason the lifecycle beside it is keyed on the
 * pair. Inside a group the rid is unique, which is what the store's own
 * `UNIQUE (retro_id, rid)` says.
 */
function globalIdsByRetro(
  minted: readonly RecordId[],
): ReadonlyMap<number, ReadonlyMap<string, number>> {
  const rows = new Map<number, Map<string, number>>()
  for (const record of minted) {
    const forRetro = rows.get(record.retroId) ?? new Map<string, number>()
    rows.set(record.retroId, forRetro)
    forRetro.set(record.rid, record.id)
  }
  return rows
}

/** Nothing minted for a retrospective at all — see `requireGlobalId` for why that shouts. */
const NO_GLOBAL_IDS: ReadonlyMap<string, number> = new Map()

/** A record nobody has labelled, which on most stores is most of them. */
const NO_LABELS: readonly [] = []

/**
 * Every record of every retrospective, flat — the read model behind the records
 * page.
 *
 * **A fixed number of reads, whatever the number of rows**: the retrospectives,
 * the sessions, the latest revision of each retrospective, the latest verdict on
 * each decided record, the lifecycle entry in force for each record that has
 * one, the global number of every record there is, the label entry in force for
 * every `(record, label)` pair, and the label vocabulary to resolve those
 * against. Everything after that is arithmetic over what is already in hand —
 * the same shape `retros.list` has, four reads wider.
 *
 * **The latest revision of each retrospective, and only that.** It is the
 * revision `retros.list` counts, the one the export exports, and the one
 * `SetRecordLifecycleUseCase` will accept a rid from — so everything listed here
 * is resolvable and everything resolvable is listed. A record a later draft
 * withdrew is not part of the retrospective's outcome and is not an item on this
 * page.
 *
 * **Newest first, and within a retrospective by record number.** Newest is retro
 * id descending, so the order does not depend on a clock; `num` ascending inside
 * it is the order the reviewer read them in, and the order the revision stores
 * them in.
 *
 * **No filtering arguments**, deliberately (A4). The page filters, and it filters
 * client-side: the counts are small enough that the client can hold every row,
 * and a filter on the wire would be a decision made ahead of the evidence about
 * which filters matter — the same reasoning `retros.list` gives for taking no
 * input at all.
 */
export class ListAllRecordsUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: ListAllRecordsInput): Promise<ListAllRecordsOutput> {
    const retrospectives = await this.store.retrospectives.listAll()
    if (retrospectives.length === 0) return { records: [] }

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
    const globalIds = globalIdsByRetro(await this.store.recordIds.listAll())
    // Two more reads for the labels: every entry in force across the whole
    // store, and the vocabulary to resolve them against. Both are one query
    // whatever the number of rows, which is the shape every read on this page
    // has.
    // The marker beside the lifecycle, keyed the same way and read in the same
    // shape: one query for the whole page, whatever the number of rows.
    const claims = claimsByRecord(await this.store.recordClaims.listLatestForEachRecord())
    const labels = labelEntriesByRecord(await this.store.recordLabels.listLatestForEachRecord())
    const labelDefinitions = definitionsById(await this.store.labelDefinitions.listAll())

    // Oldest first, so each session's retrospectives are numbered in the order
    // they were started; the answer is reversed at the end because the page
    // reads newest first. The same pass `retros.list` makes, for the same
    // reason: "Retro #n" is a position within a session and is stored nowhere.
    const numbered = new Map<number, number>()
    // One group per retrospective, so the reverse below flips the *retros* and
    // leaves each retro's records in the order the reviewer read them. Reversing
    // one flat array would have turned every retro's records upside down too.
    const groups: RecordListAllRow[][] = []
    for (const retrospective of retrospectives) {
      const session = sessions.get(retrospective.sessionId)
      if (session === undefined) {
        // Foreign keys make this unreachable; saying so beats a row whose
        // identity line is blank.
        throw new Error(
          `retrospective ${retrospective.id} belongs to session ${retrospective.sessionId}, which is not there`,
        )
      }

      // Counted before the skip below: the dashboard numbers every
      // retrospective, so a records page that numbered only the ones with
      // records would call the same retro "#1" while the dashboard calls it "#2".
      const retroNumber = (numbered.get(session.id) ?? 0) + 1
      numbered.set(session.id, retroNumber)

      const revision = revisions.get(retrospective.id)
      if (revision === undefined) continue

      const latestDecisions = decisions.get(retrospective.id)
      const mintedHere = globalIds.get(retrospective.id) ?? NO_GLOBAL_IDS
      const forRetro: RecordListAllRow[] = []
      for (const record of revision.records) {
        const decision = effectiveDecision(record, revision.n, latestDecisions?.get(record.rid))
        forRetro.push({
          retroId: retrospective.id,
          retroNumber,
          session: { id: session.id, cwd: session.cwd, startedAt: session.startedAt },
          rid: record.rid,
          globalId: requireGlobalId(mintedHere, retrospective.id, record.rid),
          num: record.num,
          title: record.title,
          type: record.type,
          requester: record.requester,
          state: decision.state,
          severity: decision.severity,
          proposedLevel: proposedLevel(record),
          involvement: decision.involvement,
          // The verdict rides in because a record nobody has touched is `open`
          // unless it was declined, in which case it is `archived` from birth
          // and nothing wrote a row saying so. It is `decision.state` above and
          // not a second reading of the decisions table, so this row can never
          // show "declined" beside "open".
          lifecycle: effectiveLifecycle(
            lifecycle.get(lifecycleKey(retrospective.id, record.rid)),
            decision.state,
          ),
          // The same key the lifecycle above is grouped by, because a rid is
          // minted per retrospective and this is the one listing holding two
          // retrospectives' records at once. `NO_LABELS` rather than `?? []`
          // inline: a shared empty array keeps identity across rows, which is
          // what stops a memo in the browser seeing a new value on every render.
          // Keyed on the pair like the lifecycle above, and folded through the
          // one function every reader of a claim folds with.
          claim: effectiveClaim(claims.get(lifecycleKey(retrospective.id, record.rid))),
          labels: resolveRecordLabels(
            labels.get(lifecycleKey(retrospective.id, record.rid)) ?? NO_LABELS,
            labelDefinitions,
          ),
        })
      }

      // The revision stores its records ordered by `num`, and this does not
      // trust that: the order the reviewer read them in is the order this page
      // shows them in, whatever a blob happens to hold.
      forRetro.sort((left, right) => left.num - right.num)
      groups.push(forRetro)
    }

    return { records: groups.reverse().flat() }
  }
}
