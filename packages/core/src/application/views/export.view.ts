import { requireGlobalId } from '#application/views/record.view'
import type { ThreadView } from '#application/views/thread.view'
import type { Actor } from '#domain/models/actor.model'
import type { Decision, DecisionState } from '#domain/models/decision.model'
import type { FinishMessage } from '#domain/models/finish-message.model'
import type {
  Involvement,
  Party,
  RecordSection,
  RecordType,
  Severity,
  SolutionLevel,
  SolutionLevelInput,
} from '#domain/models/record.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import type { Revision } from '#domain/models/revision.model'
import type { Session } from '#domain/models/session.model'
import { effectiveDecision } from '#domain/services/record-state.service'

/**
 * `retro.export.v1` — **the public contract** (`docs/export/export.v1.schema.json`).
 * User-written import scripts read this shape; breaking it is a major version,
 * so the types here are written to match the schema exactly rather than to be
 * convenient.
 *
 * Three places where the schema is stricter than the domain, and the difference
 * is deliberate:
 *
 * - **`reviewerNote`, `branch` and `project` are `null`, never
 *   absent.** All three are keys typed `string | null`. The domain says `undefined`, and
 *   `JSON.stringify` drops an undefined value entirely — which would produce a
 *   document missing a key an import script reads. They are converted, not
 *   passed through.
 * - **A record's state is never `pending`.** The finish gate refuses to finish a
 *   review while any record is undecided (D3), so by the time anything is
 *   exportable every record carries a human verdict. The type says so.
 * - **A thread with no messages is not exported.** `messages` has `minItems: 1`;
 *   an empty thread is an anchor nobody has written under yet, and it is not part
 *   of the outcome.
 */
export const EXPORT_FORMAT = 'retro.export.v1'

/** Record sections, plus `review` for threads anchored to the review itself. */
export type ExportThreadComponent = RecordSection | 'review'

export type ExportMessage = {
  readonly actor: Actor
  readonly at: string
  readonly text: string
  /**
   * Which revision this message belongs to — stored when the writer captured it,
   * derived from the revision timestamps when they did not (`thread.view.ts`).
   * Optional in the published schema, because a document written before
   * `comments_add_revision` has no such key and stays valid forever.
   */
  readonly revision: number
}

export type ExportThread = {
  readonly component: ExportThreadComponent
  readonly messages: readonly ExportMessage[]
  /**
   * Whether the human marked the thread dealt with (`r-resolvable-comments`).
   * `false` for every thread nobody marked, which is every thread in a document
   * written before the flag existed — optional in the schema for that reason.
   */
  readonly resolved: boolean
}

export type ExportHumanWords = {
  readonly verbatim: string
  readonly cleaned: string
  readonly context?: string
}

/** One of the AI's proposals, as the export carries it (the multi-solution design). */
export type ExportSolution = {
  readonly bullets: string
  readonly footprint: string
  readonly level: SolutionLevelInput
  readonly recommended: boolean
}

export type ExportRecord = {
  readonly rid: string
  /**
   * The record's number in the whole ledger — what the page shows and what a
   * reader cites (`record-id.model.ts`).
   *
   * Optional here and optional in the published schema, for the reason
   * `finishMessages` and `thread.resolved` are: every document written before
   * this field existed is still a valid `retro.export.v1`, and documents already
   * exported are the reason that matters. Emitted on every document written from
   * now on.
   *
   * `num` stays beside it and stays required: a record's position within its own
   * retrospective is a fact the document has carried since v1, and narrowing a
   * published contract is a new version.
   */
  readonly globalId?: number
  readonly num: number
  readonly title: string
  readonly type: RecordType
  /**
   * The finish gate guarantees a verdict, so `pending` cannot occur. `hold` can,
   * on a retrospective decided before `r-hold-semantics`: nothing writes one any
   * more, and a document that already carries one stays valid forever.
   *
   * `revise` is in the type because it is a verdict a human can give
   * (`r-verdict-revise`) and the published schema may never be narrower than the
   * type — but no document written today carries one: closing a review to
   * export refuses while any record still asks to be rewritten
   * (`close-review.use-case.ts`), which is what "must-address in the next
   * revision" means mechanically.
   */
  readonly state: Exclude<DecisionState, 'pending'>
  readonly severity: Severity
  readonly solutionLevel: SolutionLevel
  readonly involvement: Involvement
  readonly requester: Party
  readonly impacts: Party
  readonly problem: string
  readonly humanWords: readonly ExportHumanWords[]
  readonly rootCause: {
    readonly whatHappened: string
    readonly whys: readonly string[]
    readonly root: string
  }
  readonly workaround: string
  /**
   * The evidence the AI diagnosed from, as it wrote it.
   *
   * Optional here and optional in the published schema, on `globalId`'s standing
   * rather than `reviewerNote`'s: a record filed before the field existed has
   * none, and a document written before it existed is a valid `retro.export.v1`
   * forever. So the key is **absent** on such a record rather than converted to
   * `null` — a consumer reads "no diagnostic data" off the key not being there,
   * which is how it already reads a record's shape off `solutions` versus
   * `agreedDirection`. Emitted on every record that carries any, which from here
   * on is every record filed.
   */
  readonly diagnosticData?: string
  /**
   * The record's narrative direction and the tree of files it touches — **only
   * on a record filed before solutions existed.**
   *
   * They are optional here, and optional in the published schema, for the reason
   * `held` and `holdNote` are: this record object is `additionalProperties:
   * false`, so a key removed from v1 would invalidate every document written
   * while it existed. The builder stops emitting them; the contract goes on
   * admitting them. Narrow the write path, never the read path (data-model.md
   * §Hold).
   */
  readonly agreedDirection?: string
  readonly footprint?: string
  /** The AI's proposals — only on a record filed after solutions existed. */
  readonly solutions?: readonly ExportSolution[]
  /**
   * Which solution the human's verdict was made against, 1-based, matching
   * `solutions` by position. Present exactly when `solutions` is: it is the
   * human's answer to a question the legacy shape never asked.
   */
  readonly selectedSolution?: number
  readonly reviewerNote: string | null
  readonly threads: readonly ExportThread[]
}

export type ExportSession = {
  readonly id: number
  readonly claudeSession: string
  readonly project: string | null
  readonly cwd: string
  readonly branch: string | null
  readonly supervised: boolean
  readonly startedAt: string
}

/**
 * The human's final word on one round (`r-finish-confirm-message`).
 *
 * `revision` is the round it closes — the same key `ReviewFinished` carries — so
 * a retrospective that went three rounds can carry three of these and a reader
 * can tell which is which. It is delivered separately from the comments, and
 * this is what separately looks like in the document: its own array on the
 * retrospective, touching no thread.
 */
export type ExportFinishMessage = {
  readonly revision: number
  readonly message: string
  readonly at: string
}

export type ExportRetrospective = {
  readonly id: number
  /** The final revision's title — the retrospective's name, or null. */
  readonly title: string | null
  readonly state: 'finished'
  readonly finishedAt: string
  readonly revisions: number
  /**
   * One entry per round the human left a word on, ascending by revision; `[]`
   * when none was left. Always emitted, and optional in the schema, so
   * documents written before the field existed stay valid (the `thread.resolved`
   * precedent).
   */
  readonly finishMessages: readonly ExportFinishMessage[]
  /**
   * Constant by construction: only the human finishes a review, only in the UI
   * (data-model.md §Dropped from v2). Stated rather than stored.
   */
  readonly reviewed: 'human'
}

export type RetroExport = {
  readonly format: typeof EXPORT_FORMAT
  readonly generatedAt: string
  readonly project: string | null
  readonly session: ExportSession
  readonly retrospective: ExportRetrospective
  readonly records: readonly ExportRecord[]
  readonly reviewThreads: readonly ExportThread[]
}

export type BuildExportInput = {
  readonly session: Session
  readonly retrospective: Retrospective
  readonly finishedAt: string
  /** How many revisions the retrospective went through. */
  readonly revisions: number
  /** The final revision: its narrative is what the export carries. */
  readonly revision: Revision
  /** Each record's global number, by rid — this retrospective's `record_ids` rows. */
  readonly globalIds: ReadonlyMap<string, number>
  readonly decisions: ReadonlyMap<string, Decision>
  readonly threads: readonly ThreadView[]
  /** The word the human left on each round they left one on, ascending by revision. */
  readonly finishMessages: readonly FinishMessage[]
  readonly generatedAt: string
}

function toExportThread(thread: ThreadView): ExportThread | undefined {
  if (thread.messages.length === 0) return undefined
  return {
    component: thread.section ?? 'review',
    messages: thread.messages.map((message) => ({
      actor: message.actor,
      at: message.at,
      text: message.text,
      revision: message.revision,
    })),
    resolved: thread.resolved,
  }
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}

/**
 * Builds the export document from what a finished retrospective holds.
 *
 * Content is the **final revision's narrative plus the final human decision
 * fields** (D6). Per-record history stays queryable through `record history` and
 * is deliberately not in the export: the export is the outcome, not the argument
 * that produced it.
 */
export function buildRetroExport(input: BuildExportInput): RetroExport {
  const recordThreads = new Map<string, ExportThread[]>()
  const reviewThreads: ExportThread[] = []

  for (const thread of input.threads) {
    const exported = toExportThread(thread)
    if (exported === undefined) continue
    if (thread.rid === undefined) {
      reviewThreads.push(exported)
      continue
    }
    const existing = recordThreads.get(thread.rid)
    if (existing === undefined) recordThreads.set(thread.rid, [exported])
    else existing.push(exported)
  }

  const records = input.revision.records
    .map((record): ExportRecord | undefined => {
      const decision = effectiveDecision(record, input.revision.n, input.decisions.get(record.rid))
      if (decision.state === 'pending') return undefined

      return {
        rid: record.rid,
        globalId: requireGlobalId(input.globalIds, input.retrospective.id, record.rid),
        num: record.num,
        title: record.title,
        type: record.type,
        state: decision.state,
        severity: decision.severity,
        solutionLevel: decision.solutionLevel,
        involvement: decision.involvement,
        requester: record.requester,
        impacts: record.impacts,
        problem: record.problem,
        humanWords: record.humanWords.map((words) => ({
          verbatim: words.verbatim,
          cleaned: words.cleaned,
          context: words.context,
        })),
        rootCause: {
          whatHappened: record.rootCause.whatHappened,
          whys: [...record.rootCause.whys],
          root: record.rootCause.root,
        },
        workaround: record.workaround,
        // `undefined` here means the key is not in the file at all, which is the
        // whole convention above — no conversion to null, and nothing emitted
        // for a record that was filed before the field existed.
        diagnosticData: record.diagnosticData,
        // The shape the record has, and only that shape: a document carries the
        // two legacy keys or it carries `solutions`, never both and never
        // neither. `undefined` members drop out of `JSON.stringify` entirely,
        // which is what "the builder stops emitting them" means concretely.
        ...(record.solutions === undefined
          ? { agreedDirection: record.agreedDirection, footprint: record.footprint }
          : {
              solutions: record.solutions.map((solution) => ({
                bullets: solution.bullets,
                footprint: solution.footprint,
                level: solution.level,
                recommended: solution.recommended,
              })),
              selectedSolution: decision.selectedSolution,
            }),
        reviewerNote: decision.reviewerNote ?? null,
        threads: recordThreads.get(record.rid) ?? [],
      }
    })
    .filter(isPresent)

  return {
    format: EXPORT_FORMAT,
    generatedAt: input.generatedAt,
    project: input.session.project ?? null,
    session: {
      id: input.session.id,
      claudeSession: input.session.claudeSession,
      project: input.session.project ?? null,
      cwd: input.session.cwd,
      branch: input.session.branch ?? null,
      supervised: input.session.supervised,
      startedAt: input.session.startedAt,
    },
    retrospective: {
      id: input.retrospective.id,
      title: input.revision.title ?? null,
      state: 'finished',
      finishedAt: input.finishedAt,
      revisions: input.revisions,
      finishMessages: input.finishMessages.map((stored) => ({
        revision: stored.revisionN,
        message: stored.message,
        at: stored.at,
      })),
      reviewed: 'human',
    },
    records,
    reviewThreads,
  }
}
