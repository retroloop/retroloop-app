import type { Store } from '#application/ports/store.port'
import type { RetroListSession } from '#application/use-cases/retros/list-retros.use-case'
import {
  definitionsById,
  type RecordAttributeView,
  type RecordLabelView,
  resolveRecordAttributes,
  resolveRecordLabels,
} from '#application/views/definition.view'
import { buildRecordView, type RecordView } from '#application/views/record.view'
import {
  type RecordRelationDetail,
  recordIdsById,
  resolveRecordRelations,
} from '#application/views/relation.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Decision, DecisionState } from '#domain/models/decision.model'
import type { RecordId } from '#domain/models/record-id.model'
import type {
  RecordLifecycleEntry,
  RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
import type { RecordRelationEntry } from '#domain/models/record-relation.model'
import type { Revision } from '#domain/models/revision.model'
import { recordKey } from '#domain/services/record-key.service'
import {
  type EffectiveLifecycle,
  effectiveLifecycle,
} from '#domain/services/record-lifecycle.service'

/**
 * One thing that happened to a record, in the order it happened — the owner's
 * *"We can have a timeline at the bottom that shows how the record evolved.
 * timeline can have events like status changes"*.
 *
 * Three kinds, and no fourth. **Comments are out by his later word** — *"let's
 * leave out the comments for now"* — so nothing here reads a thread, and a
 * record's conversation stays on the review page where it is written.
 *
 * Every one of them carries an `actor`, and two of the three get theirs from the
 * domain rather than from a column. A revision is the AI's — `CreateRevisionUseCase`
 * refuses any other actor — and a decision is the human's, for the same reason
 * one line down in `RecordDecisionUseCase`. So the author of those two events is
 * a fact about the system rather than a guess, and stating it here is what keeps
 * a reader of the timeline from having to know the rule to read the line. Only
 * the lifecycle entry has an author it could have had either way, which is why
 * that table is the one with an `actor` column (`record-lifecycle.model.ts`).
 */
export type RecordTimelineEntry =
  | {
      readonly kind: 'created'
      readonly at: string
      /** The revision the record first appeared in — not necessarily revision 1. */
      readonly revisionN: number
      readonly actor: Actor
    }
  | {
      readonly kind: 'decision'
      readonly at: string
      /** The revision this verdict was given against (D2). */
      readonly revisionN: number
      readonly state: DecisionState
      readonly actor: Actor
      /** 1-based and dense per `(retroId, rid)` — every verdict is kept, none is edited. */
      readonly version: number
    }
  | {
      readonly kind: 'lifecycle'
      readonly at: string
      /** The **act** somebody took, not where it left the record — see `RecordLifecycleStatus`. */
      readonly status: RecordLifecycleStatus
      readonly actor: Actor
      readonly refs: readonly string[]
      readonly note: string | undefined
      readonly version: number
    }

/** The author of a revision, which the write path refuses to let be anyone else. */
const FILED_BY: Actor = 'ai'
/** The author of a verdict, likewise (`record-decision.use-case.ts`). */
const DECIDED_BY: Actor = 'human'

export type GetRecordByIdInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
  /** The record's number in the whole ledger — what `/records/:id` carries. */
  readonly id: number
}

export type GetRecordByIdOutput = {
  readonly retroId: number
  /** Its retrospective's place in its session — the "Retro #n" of the identity line (KC-0011). */
  readonly retroNumber: number
  /** The same session shape `retros.list` and `records.listAll` carry, so one reader renders all three. */
  readonly session: RetroListSession
  /** The record at the **latest** revision, with the verdict in effect against it. */
  readonly record: RecordView
  /** Where it stands on the axis that outlives the review, entry in force resolved. */
  readonly lifecycle: EffectiveLifecycle
  /**
   * The labels the record wears — the same shape and the same join the review
   * card reads (`get-record.use-case.ts`), so a label reads identically on both
   * surfaces.
   */
  readonly labels: readonly RecordLabelView[]
  /**
   * The values it carries, with the name and type of each — **this page and no
   * other**.
   *
   * A label is a classification and is worth a tag wherever a record is listed;
   * a value is data *about* a record, which is a thing you go and look at. So
   * the review card carries labels and stops, and the block that renders
   * "external ticket ID · 4192" lives here, where a reader has come to find out
   * about one record. Every field on the wire is a field the typed mock has to
   * produce, and this is the one surface that pays for these.
   */
  readonly attributes: readonly RecordAttributeView[]
  /**
   * What somebody said this record has to do with another, both directions —
   * the owner's *"the relation reads from both sides"*.
   *
   * Each entry names the **other** record three ways: the global number a person
   * says out loud, the `(retroId, rid)` pair every read and write is addressed
   * by, and its title. The title is what makes the block a page rather than a
   * list of numbers, and it is why this read carries relations in a shape the
   * revision listing does not — a page holds one record and can afford to look
   * the other ends up (`relation.view.ts` §RecordRelationDetail).
   */
  readonly relations: readonly RecordRelationDetail[]
  /** Everything that has happened to it, oldest first. */
  readonly timeline: readonly RecordTimelineEntry[]
}

/**
 * One record, reached by the number a human reads off the page — the read model
 * behind the record page (the owner's session-9 ask: *"when I go to the records
 * page and click on a record, it takes me to the retro page. each record should
 * have it's own dedicated page"*).
 *
 * **The global id is the whole reason this exists.** Every other record read in
 * the system is addressed by `(retroId, rid)`, which is what actually identifies
 * a record (A5) — and a pair is not a URL anyone types or pastes. So this one
 * runs the sequence backwards first (`recordIds.findById`) and then reads
 * exactly what the other record use cases read, against the pair it resolved.
 * A number nothing was minted for is a `NotFoundError`, which is the only shape
 * of miss this use case has: past that point the pair came out of the store's
 * own sequence and everything it names is there.
 *
 * **The latest revision, like every other page-facing read.** It is the revision
 * `records.listAll` lists, the one the export exports and the one
 * `SetRecordLifecycleUseCase` accepts a rid from, so everything this page shows
 * is something its own controls can act on. A record a later draft withdrew has
 * a number and a history and is not part of the retrospective's outcome; it
 * answers NotFound here, from the record lookup rather than from a branch of its
 * own.
 *
 * **Reads, whatever the record.** The number, the retrospective, its session,
 * the retrospectives of that session (for "Retro #n", which is stored nowhere),
 * every revision of the retrospective, every verdict on the record, every
 * lifecycle entry on it, the labels it wears, the values it carries, the two
 * vocabularies to resolve those against, and every relation written with this
 * record on either side. Nothing here is a scan of the store: everything but the
 * retrospective lookups is keyed on ids this use case already holds, and the two
 * vocabularies are tens of rows for one user, read whole rather than joined per
 * entry.
 *
 * **The relations cost a few more reads, and they are bounded by the record
 * rather than by the store**: one lookup per far end to turn a global id back
 * into the pair it stands for, and one latest-revision read per *distinct* far
 * retrospective to put a title on it. A record holds a handful of relations, and
 * a relation naming a record three retrospectives back is the feature — *"so
 * that AI can easily find past records"* — rather than an edge of it.
 */
export class GetRecordByIdUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: GetRecordByIdInput): Promise<GetRecordByIdOutput> {
    const minted = NotFoundError.require(
      await this.store.recordIds.findById(input.id),
      'record',
      input.id,
    )
    const retrospective = NotFoundError.require(
      await this.store.retrospectives.findById(minted.retroId),
      'retrospective',
      minted.retroId,
    )
    const session = NotFoundError.require(
      await this.store.sessions.findById(retrospective.sessionId),
      'session',
      retrospective.sessionId,
    )

    const revisions = await this.store.revisions.listByRetro(retrospective.id)
    const latest = NotFoundError.require(revisions.at(-1), 'revision', 'latest')
    const record = NotFoundError.require(
      latest.records.find((candidate) => candidate.rid === minted.rid),
      'record',
      input.id,
    )

    const decisions = await this.store.decisions.listForRecord(retrospective.id, minted.rid)
    const entries = await this.store.recordLifecycle.listForRecord(retrospective.id, minted.rid)
    const view = buildRecordView(record, minted.id, latest.n, decisions.at(-1))

    // Four more reads: what the record wears, what it carries, and the two
    // vocabularies to resolve them against. The vocabularies are tens of rows
    // for one user, so they are read whole rather than joined per entry.
    const labelEntries = await this.store.recordLabels.listForRecord(retrospective.id, minted.rid)
    const valueEntries = await this.store.recordAttributeValues.listForRecord(
      retrospective.id,
      minted.rid,
    )

    // The counting pass `retros.list` and `records.listAll` both make: "Retro #n"
    // is a position within a session and is stored nowhere, so it is read off
    // the session's own retrospectives in the order they were started.
    const withinSession = await this.store.retrospectives.listBySession(session.id)

    // Both sides in one query, folded to what stands, then each far end turned
    // back into a record somebody can read and click.
    const relationEntries = await this.store.recordRelations.listForRecord(minted.id)
    const relations = await this.relationsOf(minted.id, relationEntries)

    return {
      retroId: retrospective.id,
      retroNumber: withinSession.findIndex((candidate) => candidate.id === retrospective.id) + 1,
      session: { id: session.id, cwd: session.cwd, startedAt: session.startedAt },
      record: view,
      lifecycle: effectiveLifecycle(entries.at(-1), view.decision.state),
      labels: resolveRecordLabels(
        labelEntries,
        definitionsById(await this.store.labelDefinitions.listAll()),
      ),
      attributes: resolveRecordAttributes(
        valueEntries,
        definitionsById(await this.store.attributeDefinitions.listAll()),
      ),
      relations,
      timeline: buildTimeline(revisions, minted.rid, decisions, entries),
    }
  }

  /**
   * The far end of every relation that stands, named the way a reader needs it.
   *
   * Two passes, and each is keyed on ids this method is already holding. The
   * first turns each far global id back into the `(retroId, rid)` pair it stands
   * for — `record_ids` is insert-only, so a number that reached the relation
   * table names a row. The second reads one latest revision per **distinct** far
   * retrospective, which is where the titles come from: several relations into
   * the same past retrospective cost one read between them.
   *
   * A record the far retrospective's latest draft withdrew has no title there,
   * and falls back to its rid — the record's own name, authored by the AI and
   * stable for its life, and the fallback the web surface already makes wherever
   * a record has no title to show. The relation is not hidden: the row was
   * written about a record that existed, and dropping the line would be this
   * page inferring something from an absence.
   */
  private async relationsOf(
    recordId: number,
    entries: readonly RecordRelationEntry[],
  ): Promise<readonly RecordRelationDetail[]> {
    const farIds = new Set<number>()
    for (const entry of entries) {
      farIds.add(entry.fromId === recordId ? entry.toId : entry.fromId)
    }

    const minted: RecordId[] = []
    for (const id of farIds) {
      const row = await this.store.recordIds.findById(id)
      if (row !== undefined) minted.push(row)
    }

    const titles = new Map<string, string>()
    for (const retroId of new Set(minted.map((row) => row.retroId))) {
      const latest = await this.store.revisions.findLatestByRetro(retroId)
      for (const record of latest?.records ?? []) {
        titles.set(recordKey(retroId, record.rid), record.title)
      }
    }

    return resolveRecordRelations(recordId, entries, recordIdsById(minted)).map((view) => ({
      ...view,
      title: titles.get(recordKey(view.retroId, view.rid)) ?? view.rid,
    }))
  }
}

/**
 * Everything that happened to the record, oldest first.
 *
 * **Built in the order the events can only have happened in, then sorted by the
 * clock — and the sort is stable, which is what settles a tie.** A revision is
 * filed before a verdict can be given against it, and a lifecycle act is taken
 * after the review that filed the record; so the construction order below *is*
 * the causal order, and sorting by `at` on top of it only moves an event whose
 * timestamp genuinely disagrees. Ties keep the causal order rather than
 * whichever the sort happened to reach first, which matters wherever a clock is
 * coarser than the acts it stamps — a frozen one in a suite, or two acts inside
 * one unit of work.
 *
 * **Every verdict, not the one in force.** The effective decision is on the
 * record above and answers "where does this stand"; the timeline answers "how
 * did it get here", and a page that showed only the latest would drop the
 * approval a redraft sent back to pending, which is the single most interesting
 * thing a record's history has to say (D2).
 */
function buildTimeline(
  revisions: readonly Revision[],
  rid: string,
  decisions: readonly Decision[],
  entries: readonly RecordLifecycleEntry[],
): readonly RecordTimelineEntry[] {
  const timeline: RecordTimelineEntry[] = []

  // The first revision that carries the rid, which is where the record was
  // filed. Later appearances are redrafts of the same record and are not events
  // on this list: what changed between two drafts is the record's diff, which
  // is a page of its own (KC-0012) rather than a line here.
  const filed = revisions.find((revision) =>
    revision.records.some((candidate) => candidate.rid === rid),
  )
  if (filed !== undefined) {
    timeline.push({
      kind: 'created',
      at: filed.createdAt,
      revisionN: filed.n,
      actor: FILED_BY,
    })
  }

  for (const decision of decisions) {
    timeline.push({
      kind: 'decision',
      at: decision.decidedAt,
      revisionN: decision.revisionN,
      state: decision.state,
      actor: DECIDED_BY,
      version: decision.version,
    })
  }

  for (const entry of entries) {
    timeline.push({
      kind: 'lifecycle',
      at: entry.at,
      status: entry.status,
      actor: entry.actor,
      refs: entry.refs,
      note: entry.note,
      version: entry.version,
    })
  }

  return timeline.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
}
