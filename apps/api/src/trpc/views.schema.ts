import {
  actorSchema,
  attributeTypeSchema,
  decisionStateSchema,
  involvementSchema,
  partySchema,
  recordLifecycleStateSchema,
  recordLifecycleStatusSchema,
  recordSectionSchema,
  recordTypeSchema,
  relationDirectionSchema,
  retroDisplayStateSchema,
  ridSchema,
  severitySchema,
  solutionLevelInputSchema,
  solutionLevelSchema,
} from '@retro/core'
import { z } from 'zod'

/**
 * The wire shapes, declared once and used by both `.input()` and `.output()`.
 *
 * The enums come from `@retro/core` rather than being restated here, so the
 * server cannot drift from the domain it speaks for. What is added on top is the
 * one systematic difference between the domain and the wire: **`undefined`
 * becomes `null`.** JSON has no undefined, and a key that vanishes is a key the
 * browser has to special-case; a nullable key is one it can read.
 */
export const revisionMetaSchema = z.strictObject({
  n: z.int().positive(),
  createdAt: z.string(),
  records: z.int().nonnegative(),
  /**
   * When the human finished **this round**, or null while they have not
   * (`r-finish-button-reenables`).
   *
   * It is not `retrospective.finishedAt`, which is the retro's own close by the
   * AI and stays null through every round but the last. The review page needs
   * "has the human finished the revision I am looking at?", and for a while
   * nothing on the wire answered it — so the bar's Sent state was in-memory
   * only and a refresh offered the button again for a round the store had
   * already recorded as finished. The store always knew: the CLI's review wait
   * answers this from the same events.
   */
  finishedAt: z.string().nullable(),
})

/**
 * Where a retrospective happened.
 *
 * Session id and `cwd` are the identity line — "Retro #n · Session S · <cwd>" —
 * and `cwd` is the anchor because Claude Code pins it
 * for the life of a session. Both retro views carry this same shape, so the one
 * reader that renders that line renders it identically from either of them: the
 * dashboard row and the review page cannot drift into two identity lines.
 */
export const sessionIdentitySchema = z.strictObject({
  id: z.int(),
  cwd: z.string(),
  startedAt: z.string(),
})

export const retroSchema = z.strictObject({
  retroId: z.int(),
  session: sessionIdentitySchema,
  /** Dormant and optional on the session; null when it was never given. */
  project: z.string().nullable(),
  /**
   * The retrospective's plain-language name — the **latest revision's** title,
   * null when that revision proposed none. Latest
   * wins because a title is part of the draft: the AI renames a retro by
   * redrafting it, which is the only way anything in a revision changes (D4).
   */
  title: z.string().nullable(),
  /** The retrospective's place in its session — the "Retro #n" of the breadcrumb. */
  retroNumber: z.int().positive(),
  /**
   * The state a reader is shown, which is not the state a row is stored in:
   * `submitted` — the human's round is down and the AI has not closed it — is derived
   * from the `ReviewFinished` events on the way out and written nowhere
   * (`retro.view.ts`). The other three are the retrospective's own.
   */
  state: retroDisplayStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  latestRevision: z.int().positive().nullable(),
  revisions: z.array(revisionMetaSchema),
})

/**
 * One row of the dashboard's flat list of retrospectives.
 *
 * Deliberately narrow: the identity line — "Retro #n ·
 * Session S · <cwd>" — the retro's name, its state, and how much of the
 * review is left. `project` is not here: nothing groups, routes or filters by
 * it, and every field on this row is a field the typed mock has to produce.
 *
 * `title` is null rather than a fallback string. "Retro #n — <cwd basename>" is
 * what a reader shows when a retro has no name, and inventing it server-side
 * would leave the page unable to tell a named retro from an unnamed one.
 */
export const retroListRowSchema = z.strictObject({
  retroId: z.int(),
  retroNumber: z.int().positive(),
  title: z.string().nullable(),
  state: retroDisplayStateSchema,
  counts: z.strictObject({
    /** What the finish gate is waiting on, in the latest revision (D3). */
    pending: z.int().nonnegative(),
    /** Approved or declined — everything the human has answered. */
    decided: z.int().nonnegative(),
  }),
  session: sessionIdentitySchema,
})

/**
 * Where a record stands **after** the review that filed it closed — the
 * lifecycle axis, on the wire.
 *
 * `status` is the derived reading — `open`, `resolved` or `archived` — not the
 * act that was written; the acts are `resolved`, `reopened`, `archived` and
 * `unarchived`, and the last one of them is what the four fields below describe.
 * `refs` is a list rather than a nullable string because several kinds of
 * reference exist and a fix can cite more than one — it is non-empty exactly
 * when the record is resolved, which is why a reader can treat "has refs" and
 * "is resolved" as the same question.
 *
 * The other three are null on a record nobody has touched: there is no entry, so
 * there is no note, no author and no moment. Null rather than absent, like every
 * other optional on this wire — **including on an archived record that nobody
 * archived**, which is the born-archived reading of a declined verdict
 * (`docs/design/lifecycle.md`). A page rendering "archived by" reads `actor`
 * and finds null there, which is the truth: the decline is what put it there.
 */
export const recordLifecycleSchema = z.strictObject({
  status: recordLifecycleStateSchema,
  refs: z.array(z.string()),
  note: z.string().nullable(),
  /** Who wrote the entry in force. Both actors write these, which is why it is asked. */
  actor: actorSchema.nullable(),
  at: z.string().nullable(),
})

/**
 * **Who is holding a record right now, and since when** — the in-progress
 * marker, on the wire (`record-claim.service.ts`).
 *
 * Two fields and no third. `version` is on the table and is not here: a reader
 * of this key asks one question — is anybody on this, and who — and a number
 * that only says how many times the record has changed hands is a field the
 * typed mock would have to produce for nothing.
 *
 * `actor` is asked because either party may hold a record. The AI is who the
 * marker exists for, but the human does the work too, and a badge that could
 * only mean "an agent has this" would go up beside a record the human is
 * editing themselves (`claim-record.use-case.ts`).
 *
 * **Nullable wherever it rides, never absent**, which is this file's one
 * systematic conversion: a record nobody is holding and one somebody gave back
 * read identically, and they read as `null`.
 */
export const recordClaimSchema = z.strictObject({
  /** When the claim in force was taken — the `at` of the row that took it. */
  claimedAt: z.string(),
  actor: actorSchema,
})

/**
 * One entry of a vocabulary, as the settings page manages it.
 *
 * Each label or attribute is a global thing — so
 * there is no retrospective, no session and no scope of any kind on this shape,
 * and the page that edits it is `/settings` rather than anything inside a
 * review.
 *
 * `retiredAt` is a nullable timestamp rather than a `retired` boolean, and the
 * difference earns its place on the settings page itself: the row that says a
 * label stopped being offered is a row a reader will want a date on. What a
 * *record's* label carries is the boolean (`recordLabelSchema` below), because
 * there the only question is whether the page may still offer it.
 */
export const labelDefinitionSchema = z.strictObject({
  id: z.int().positive(),
  name: z.string(),
  retiredAt: z.string().nullable(),
  createdAt: z.string(),
})

/**
 * The attribute vocabulary — its label twin plus the one field that makes the
 * primitive worth having: an attribute can be declared to always hold a number,
 * which makes it easier to query.
 *
 * The type is on the definition and never on a value, and there is no procedure
 * anywhere that changes one: every value already stored was accepted under it
 * (`attribute.model.ts`).
 */
export const attributeDefinitionSchema = z.strictObject({
  id: z.int().positive(),
  name: z.string(),
  type: attributeTypeSchema,
  retiredAt: z.string().nullable(),
  createdAt: z.string(),
})

/**
 * A label **as a record wears it** — resolved against the vocabulary, so a row
 * or a card renders the word without holding the vocabulary itself.
 *
 * `retired` is a boolean here where the definition carries a timestamp, and that
 * is the whole difference between the two shapes: on a record the only question
 * is whether this is still something anyone can add, and a page that drew a
 * retirement date beside a tag would be answering a question nobody asked there.
 *
 * A retired label still arrives, because retiring stops a label being *offered*
 * and not being read — the records that wear it go on wearing it
 * (`label.model.ts`).
 */
export const recordLabelSchema = z.strictObject({
  id: z.int().positive(),
  name: z.string(),
  retired: z.boolean(),
})

/**
 * A value **as a record carries it** — the name and the type beside it, so the
 * page can render "external ticket ID · 4192" and treat a `url` as a link
 * without a second query.
 *
 * The value is always a string, whatever the type says: SQLite has no date and
 * no discriminated column, and a `number` attribute holding `'42'` is the same
 * fact as one holding `42`. The type is what the store accepted it under and
 * what a reader may assume; it is not what the column is.
 */
export const recordAttributeSchema = z.strictObject({
  id: z.int().positive(),
  name: z.string(),
  type: attributeTypeSchema,
  value: z.string(),
  retired: z.boolean(),
})

/**
 * A relation **as one of its two records sees it** — the relation reads from
 * both sides, on the wire.
 *
 * It names the **other** record and never this one: a page standing on #5 wants
 * to know about #12, and repeating #5 on every line would be the page telling
 * itself what it already knows. Which of the two the stored row calls `from` is
 * on `direction` instead, so the one row answers both pages and nothing is lost.
 *
 * The `(retroId, rid)` pair is deliberately not here. A browser addresses a
 * record by its number — `/records/:id` is the whole reason the number exists —
 * so a pair on this shape would be two more fields the typed mock has to produce
 * for a link nobody builds from them. The CLI's read-back carries the pair
 * instead, and for the mirror-image reason: what a machine does with a relation
 * is go and read the record at the other end (`relation.view.ts`).
 *
 * `how` is never empty: the words are half the act, and the schema that accepts
 * a write says so (`record-relation-input.schema.ts`).
 */
export const recordRelationRefSchema = z.strictObject({
  /** The **other** record's number in the whole ledger — what the link goes to. */
  globalId: z.int().positive(),
  how: z.string(),
  /** `outgoing` when this record is the `from` side of the stored row, `incoming` when it is the `to`. */
  direction: relationDirectionSchema,
  /** Who related them. Not nullable, unlike the lifecycle's: every relation is an act somebody took. */
  actor: actorSchema,
  at: z.string(),
})

/**
 * The same relation with the other record's **name** beside its number — the
 * record page's shape, and it is `recordRelationRefSchema` **extended** rather
 * than restated, for `recordPageSchema`'s reason one level down.
 *
 * The title is the one field on this wire that costs a read of a *different
 * retrospective*, which is affordable on a page holding one record and is not on
 * a write's answer or a listing. So the extension is exactly where the cost is
 * paid, and the two shapes cannot come to disagree about what a relation is.
 */
export const recordRelationSchema = recordRelationRefSchema.extend({
  /**
   * The other record's title at its retrospective's latest revision, or its rid
   * where a later draft withdrew it — the name fallback the rest of this surface
   * already makes (`relation.view.ts`). Never null: a record always has one of
   * the two.
   */
  title: z.string(),
})

/**
 * Where a relation write leaves the record it was authored from — every relation
 * standing on it now, which is the shape `labels.set` and `records.setLifecycle`
 * both answer in.
 *
 * The relations come back **without titles**, which is the one place this parts
 * from the read: a write resolves the two records it names and nothing else, and
 * making it read every far retrospective to put a name on a line the browser is
 * about to re-fetch anyway would be work done for nobody. The page invalidates
 * `records.byId` and gets the named shape from there.
 */
export const recordRelationsResultSchema = z.strictObject({
  fromId: z.int().positive(),
  toId: z.int().positive(),
  version: z.int().positive(),
  relations: z.array(recordRelationRefSchema),
})

/** Where a label write leaves the record: which version it wrote, and what it wears now. */
export const recordLabelsResultSchema = z.strictObject({
  retroId: z.int(),
  rid: ridSchema,
  version: z.int().positive(),
  labels: z.array(recordLabelSchema),
})

/** The same, one table over. */
export const recordAttributesResultSchema = z.strictObject({
  retroId: z.int(),
  rid: ridSchema,
  version: z.int().positive(),
  values: z.array(recordAttributeSchema),
})

/**
 * The global settings — one key, and it is a standing guarantee rather
 * than a preference: while it is disabled, the user can be certain that the AI
 * cannot mess around.
 *
 * A named boolean rather than a key-value bag. There is exactly one setting,
 * every reader wants this one, and a map would make the page ask "is
 * `ai_config_write` in here, and what does a missing key mean" — a question the
 * core already answers once, where the default lives
 * (`config-write.service.ts`).
 *
 * The **version** the write produced is deliberately not here. The store keeps
 * every version and the history is the point of the table, but nothing on the
 * page renders one, and every field on this wire is a field the typed mock has
 * to produce.
 */
export const settingsSchema = z.strictObject({
  aiConfigWrite: z.boolean(),
})

/**
 * A record as the column shows it. Deliberately not the whole record: the detail
 * pane fetches that, and every field here is a field the typed mock must produce
 * (R-MOCK-LOCK), so the list carries identity, heading and verdict and stops.
 *
 * **No labels here**, and that is the split rather than an omission: the review
 * *column* is a rail of state icons and truncated titles, and the card below it
 * is what renders a record's tags. A label on both would be a field the mock
 * produces twice for one reading.
 */
export const recordSummarySchema = z.strictObject({
  rid: ridSchema,
  /**
   * The number the reader is shown — the record's place in the whole ledger,
   * minted once and the same on every page it appears on (`record-id.model.ts`).
   *
   * It sits beside `rid` and `num` rather than replacing either. `(retroId, rid)`
   * is still what every link, testid and write is addressed by, and `num` is
   * still the record's position within its own retrospective; what changed is
   * which of the three the page prints.
   */
  globalId: z.int().positive(),
  /** Its place within its own retrospective, dense from 1 — real, and not displayed. */
  num: z.int().positive(),
  title: z.string(),
  type: recordTypeSchema,
  /**
   * Who raised it. On the summary since `r-additional-filters`, because the
   * review bar filters and counts by it and a filter cannot count what only the
   * per-record detail query carries — the counts are over every record, and the
   * detail is fetched only for the cards on screen.
   */
  requester: partySchema,
  state: decisionStateSchema,
  /** The revision the binding decision was made against; null while pending. */
  decidedOnRevision: z.int().positive().nullable(),
  carriedOver: z.boolean(),
  /** Set when the narrative changed after a decision, which sent it back to pending (D2). */
  contentChangedSince: z.int().positive().nullable(),
  /**
   * Where the record stands after the review that filed it closed — the same
   * shape `records.listAll` already carries, on the review's own list.
   *
   * The core use case has always returned it; the summary simply did not pass
   * it on. It is declared above this schema rather than below it because a
   * strict object cannot reference a shape TypeScript has not seen yet.
   */
  lifecycle: recordLifecycleSchema,
  /**
   * **Whether somebody has picked this record up** — the "in progress" badge the
   * review card wears, and null while nobody is holding it.
   *
   * It is on the *review's* list and on the record's own page, and deliberately
   * not on `recordListAllRowSchema`: the flat cross-retro page is a place to
   * find a record and filter for one, and a marker that changes under the reader
   * while an agent works the queue earns nothing there. Every element earns its
   * place (CLAUDE.md).
   *
   * The badge is driven by this field and by nothing else. Nothing on the page
   * infers "somebody is on this" from a lifecycle position, a verdict or the
   * passage of time — a claim is a row somebody wrote, and the absence of one is
   * an answer rather than a gap.
   */
  claim: recordClaimSchema.nullable(),
})

export const recordListSchema = z.strictObject({
  retroId: z.int(),
  revision: z.int().positive(),
  /** What the finish gate is waiting on. */
  pending: z.int().nonnegative(),
  records: z.array(recordSummarySchema),
})

/**
 * One row of the flat cross-retro records list — the page that shows all the
 * retro items flat with filtering, irrespective of session, retrospective or
 * cwd.
 *
 * Deliberately narrow, like every row on this wire: the identity line
 * (`retroNumber` + `session`), enough of the record to read and filter
 * it, and where each of its two axes stands. The narrative is not here — a row
 * links to the record's own page and `records.byId` answers for that (it was
 * the review page's anchor until then, A6/A7) — and neither is the
 * retro's title, because the identity line is
 * "Session S · Retro #n · cwd" and a field nothing renders is a field the mock
 * has to produce for nothing.
 */
export const recordListAllRowSchema = z.strictObject({
  retroId: z.int(),
  retroNumber: z.int().positive(),
  session: sessionIdentitySchema,
  rid: ridSchema,
  /**
   * The number this page shows. It is the whole reason the sequence exists: this
   * is the one surface that holds several retrospectives' records at once, and
   * every one of them used to open with a "#1" (`record-id.model.ts`).
   */
  globalId: z.int().positive(),
  num: z.int().positive(),
  title: z.string(),
  type: recordTypeSchema,
  requester: partySchema,
  /** The verdict in effect, carry-over resolved (D2) — one of the page's filters. */
  state: decisionStateSchema,
  /** The severity in effect: the human's once decided, the AI's proposal until then. */
  severity: severitySchema,
  /** What the AI proposed as the ceiling — `proposedLevel()`, so both record shapes answer. */
  proposedLevel: solutionLevelSchema,
  lifecycle: recordLifecycleSchema,
  /**
   * **How much of the human the fix needs** — the involvement in effect.
   *
   * The one field on this row that is here for a *count* rather than for a thing
   * the row renders: the dashboard's "Require human" tile counts
   * records that are open and `interactive`, and no per-record read can answer a
   * question about every open record without one request each.
   *
   * The widening was a deliberate call, made against the tradeoffs (`r-wire-widening-two-package`;
   * the reasoning is on `RecordListAllRow` in core). It is the only field on this
   * shape that no reader of a *row* draws, which is stated here rather than left
   * for someone to discover and delete as dead weight.
   */
  involvement: involvementSchema,
  /**
   * The labels the record wears — the fourth thing this page can be narrowed
   * by, and the one that arrives with names rather than ids: the filter is the
   * only reader that would hold the vocabulary, and every other reader of this
   * row just draws the word.
   *
   * **Not the attribute values.** A value is data about one record and is
   * something you go and look at, so it rides on `records.byId` and lives on
   * the record's own page; a row carrying both would produce a field nothing on
   * this page renders.
   */
  labels: z.array(recordLabelSchema),
})

/** What a lifecycle write answers: which version it wrote, and where that leaves the record. */
export const recordLifecycleResultSchema = z.strictObject({
  retroId: z.int(),
  rid: ridSchema,
  version: z.int().positive(),
  lifecycle: recordLifecycleSchema,
})

export const decisionSchema = z.strictObject({
  state: decisionStateSchema,
  decidedOnRevision: z.int().positive().nullable(),
  carriedOver: z.boolean(),
  contentChangedSince: z.int().positive().nullable(),
  severity: severitySchema,
  solutionLevel: solutionLevelSchema,
  /**
   * Which solution is in effect, 1-based — the human's pick once they have made
   * one, the AI's recommendation until then, and null on a record that proposes
   * no solutions to pick between.
   */
  selectedSolution: z.int().positive().nullable(),
  involvement: involvementSchema,
  reviewerNote: z.string().nullable(),
})

export const messageSchema = z.strictObject({
  id: z.int(),
  actor: actorSchema,
  text: z.string(),
  at: z.string(),
  /**
   * The revision this message belongs to — a comment shows the revision number
   * it is associated with.
   *
   * Always a number, never null. It is the revision the writer captured when
   * they wrote, and a derivation from the revision timestamps for the messages
   * written before the column existed (`thread.view.ts`), so a page never has to
   * decide what to print when the server has nothing to say.
   */
  revision: z.int().positive(),
})

export const threadSchema = z.strictObject({
  id: z.int(),
  rid: ridSchema.nullable(),
  section: recordSectionSchema.nullable(),
  openedAt: z.string(),
  messages: z.array(messageSchema),
  /**
   * Whether the human has marked this thread dealt with
   * (`r-resolvable-comments`). The effective value: the latest resolution
   * version's, and `false` when nobody has marked it — resolution is a state
   * somebody set, never something inferred from the conversation, which is what
   * separates it from `unanswered`.
   */
  resolved: z.boolean(),
})

export const recordDetailSchema = z.strictObject({
  retroId: z.int(),
  revision: z.int().positive(),
  /**
   * The record's number in the whole ledger — **outside `record`, deliberately**.
   *
   * `record` below is the narrative as the AI authored it and as the revision
   * stores it, field for field; this is the one name on a record the AI does not
   * author, so it hangs off the answer beside `retroId` rather than inside the
   * draft. The same placement `RecordView` uses in core, for the same reason
   * (`record-id.model.ts`).
   */
  globalId: z.int().positive(),
  record: z.strictObject({
    rid: ridSchema,
    num: z.int().positive(),
    title: z.string(),
    type: recordTypeSchema,
    problem: z.string(),
    humanWords: z.array(
      z.strictObject({
        verbatim: z.string(),
        cleaned: z.string(),
        context: z.string().nullable(),
      }),
    ),
    rootCause: z.strictObject({
      whatHappened: z.string(),
      whys: z.array(z.string()),
      root: z.string(),
    }),
    /**
     * The evidence the AI diagnosed from, as markdown — **null on a record
     * filed before the field existed**.
     *
     * Null and not an absent key, on this file's standing rule: a browser that
     * had to tell "this record has none" from "the server forgot" would be
     * branching on absence. The card renders the block only where this says
     * something, which is the one reading it needs.
     */
    diagnosticData: z.string().nullable(),
    workaround: z.string(),
    /**
     * A record carries **exactly one** of the two shapes below, and the wire
     * says so with nulls rather than absent keys (see this file's header).
     *
     * `agreedDirection` and `footprint` are the record's one direction and one
     * tree of files — every record filed before the multi-solution
     * design, which is all of retros 1–5. Null on a record that has
     * `solutions`, and the page renders the other branch.
     */
    agreedDirection: z.string().nullable(),
    footprint: z.string().nullable(),
    /**
     * One to three proposals, sorted from the lowest level to the highest with
     * exactly one recommended — null on a record filed before they existed.
     * The order is the identity: "Solution 2" is a position, and the human's
     * pick is stored as one.
     */
    solutions: z
      .array(
        z.strictObject({
          bullets: z.string(),
          footprint: z.string(),
          level: solutionLevelInputSchema,
          recommended: z.boolean(),
        }),
      )
      .nullable(),
    requester: partySchema,
    impacts: partySchema,
    /**
     * What the AI proposed; the human's values live on `decision`.
     *
     * `solutionLevel` is here for both shapes, and on a solutions record it is
     * the recommended solution's level — derived once when the revision was
     * written, so this key answers the same question it always did rather than
     * going null and making every reader of it branch.
     */
    proposed: z.strictObject({
      severity: severitySchema,
      solutionLevel: solutionLevelSchema,
      involvement: involvementSchema,
    }),
  }),
  decision: decisionSchema,
  /**
   * The labels the record wears — rendered on the review card beside the
   * record's other tags, and on the record's own page, which reads this same
   * shape through `records.byId`.
   *
   * **Labels and not values**, on this shape. A label is a classification and
   * belongs where a reviewer is scanning; a value is data about the record,
   * which is a thing you go and look at — so the attribute block is on
   * `recordPageSchema` below and nowhere else.
   */
  labels: z.array(recordLabelSchema),
  /**
   * **No `threads` here.** A record's comments used to ride on its detail and be
   * rendered inside the section they answered; every comment is now
   * read from `threads.list` and shown in the one panel, which replaced the
   * inline comments in the retro body so that the human sees all comments in
   * one place. Two procedures answering
   * for the same threads is two answers to keep in agreement, and the one that
   * was scoped to a record could never have carried the review's own.
   *
   * **Only the wire narrows.** `GetRecordUseCase` still returns them: it is the
   * core's read model for a record, and what a wire projection stopped needing
   * is not a reason to take a field off it. Narrowing the use case would be a
   * core-side decision about every future reader — and the schema is the wrong
   * place to make one, because from here the only reader in sight is the one
   * this file feeds.
   */
})

/**
 * One thing that happened to a record — a line of the record page's timeline,
 * which sits at the bottom of the page and shows how the record evolved through
 * events such as status changes.
 *
 * A discriminated union rather than one shape with everything nullable: the
 * three kinds carry genuinely different facts — a draft has a revision and no
 * version, a lifecycle act has references and no revision — and a flat shape
 * would put four nulls on every line to keep them one type. `kind` is what a
 * reader switches on, and `z.strictObject` inside each arm still refuses an
 * unknown key.
 *
 * **`comments` is not one of the kinds**, deliberately left out for now.
 * A record's conversation stays on the review page,
 * which is where it is written.
 *
 * Every arm carries an `actor`, and two of them get theirs from the domain
 * rather than from a stored column: a revision is the AI's and a verdict is the
 * human's, both refused to anyone else at the use case
 * (`get-record-by-id.use-case.ts`). So the timeline reads "who · what · when"
 * on every line rather than on the third of them that happens to store an
 * author.
 */
export const recordTimelineEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('created'),
    at: z.string(),
    /** The draft the record was filed in — not necessarily revision 1. */
    revision: z.int().positive(),
    actor: actorSchema,
  }),
  z.strictObject({
    kind: z.literal('decision'),
    at: z.string(),
    /** The revision the verdict was given against (D2). */
    revision: z.int().positive(),
    state: decisionStateSchema,
    actor: actorSchema,
    version: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal('lifecycle'),
    at: z.string(),
    /**
     * The **act** somebody took — `resolved`, `reopened`, `archived`,
     * `unarchived` — and not where it left the record. The four acts and the
     * three states are two vocabularies on purpose
     * (`record-lifecycle.model.ts`); `lifecycle.status` on the answer above is
     * the other one.
     */
    status: recordLifecycleStatusSchema,
    actor: actorSchema,
    refs: z.array(z.string()),
    note: z.string().nullable(),
    version: z.int().positive(),
  }),
])

/**
 * The record page, whole — `records.byId`, the one record read addressed by the
 * number a human reads off the page rather than by `(retroId, rid)`.
 *
 * It is `recordDetailSchema` **extended**, not restated: the narrative, the
 * global number and the verdict in effect are the same shape the review page's
 * pane reads, so one component renders a record's body wherever it is shown and
 * the two surfaces cannot come to disagree about what a record is. What this
 * adds is what a page standing on its own needs and a pane inside a review does
 * not:
 *
 * - **`retroNumber` + `session`** — the identity line, in the same shape
 *   `retros.list` and `records.listAll` carry. The review page reads it
 *   from `retros.get`, because it is already holding that answer; this page
 *   holds one record and would otherwise need a second round trip to say where
 *   it came from — and where it came from is also the link this page offers
 *   back to the retrospective page.
 * - **`lifecycle`** — where the record stands on the axis that outlives the
 *   review, entry in force resolved. It is here rather than derived from
 *   `timeline` below because the page wears the status as a tag and offers
 *   exactly the acts that position permits, and deriving that in the browser
 *   would be a second copy of `effectiveLifecycle` — including its
 *   born-archived reading of a decline, which no lifecycle entry records.
 * - **`timeline`** — everything that has happened to it, oldest first.
 */
export const recordPageSchema = recordDetailSchema.extend({
  retroNumber: z.int().positive(),
  session: sessionIdentitySchema,
  lifecycle: recordLifecycleSchema,
  /**
   * **Who is holding it**, beside the lifecycle rather than inside it — the same
   * key the review card reads, so one component draws the badge on both
   * surfaces (`recordSummarySchema` above).
   *
   * It is here rather than only on the review's list because this page is the
   * one place a reader goes to ask where a record stands: the two axes are in
   * its header, and "somebody is working on this right now" is the third thing
   * that answers that question. It is not a fourth position on either axis — a
   * claimed record is still open and still approved (`docs/design/lifecycle.md`).
   */
  claim: recordClaimSchema.nullable(),
  /**
   * The values the record carries, with the name and type of each — **this page
   * and no other**.
   *
   * It is the "external ticket ID" on the record that went to GitHub,
   * and it is here rather than on `recordDetailSchema` for the reason the header
   * of this file gives about narrowness: the review card is already dense and a
   * value is not what a reviewer is scanning for. This page is where a reader
   * has come to find out about one record, and it is the only surface that pays
   * for these.
   */
  attributes: z.array(recordAttributeSchema),
  /**
   * What somebody said this record has to do with another, both directions —
   * **this page and no other**, on `attributes`' reasoning one step further out.
   *
   * A relation is not a property of the record that can be drawn as a tag on a
   * list row: it is a *second record*, with a name and a link and words about
   * why the two are together, and it is only worth the space where a reader has
   * come to find out about one record. The flat cross-retro page deliberately
   * does not widen for it — every element earns its place, and a list that drew
   * every row's relations would be drawing half the store twice.
   */
  relations: z.array(recordRelationSchema),
  timeline: z.array(recordTimelineEntrySchema),
})

export const decisionResultSchema = z.strictObject({
  rid: ridSchema,
  version: z.int().positive(),
  decision: decisionSchema,
})

export const reviewOutcomeSchema = z.strictObject({
  retroId: z.int(),
  /**
   * `submitted`, every time — and that is the point rather than a shortcut. The
   * press cannot have finished the retrospective (only the AI's close does
   * that) and cannot leave the round unfinished (that is what it just did), so
   * the reading is constant. It is the *same* reading `retros.get` gives a
   * moment later, which is what stops the mutation's answer and the query's
   * answer disagreeing about the retro the page is looking at.
   */
  state: retroDisplayStateSchema,
  revision: z.int().positive(),
  finishedAt: z.string().nullable(),
})

/**
 * The event as the browser sees it.
 *
 * `name` is what the invalidation mapping keys off (`apps/web/src/lib/live.ts`),
 * and `revisionN` is what the announce-don't-swap banner needs. The event's
 * `data` payload is not on the wire: nothing on the review page reads it, and
 * every field here is a field the mock has to produce.
 */
export const wireEventSchema = z.strictObject({
  id: z.int(),
  name: z.string(),
  at: z.string(),
  retroId: z.int().nullable(),
  revisionN: z.int().positive().nullable(),
  rid: z.string().nullable(),
})

export type WireEvent = z.infer<typeof wireEventSchema>
