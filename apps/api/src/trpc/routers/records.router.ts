import { recordLifecycleStatusSchema, ridSchema } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import {
  recordDetailSchema,
  recordLifecycleResultSchema,
  recordListAllRowSchema,
  recordListSchema,
  recordPageSchema,
  recordRelationsResultSchema,
} from '#trpc/views.schema'
import {
  toWireClaim,
  toWireLifecycle,
  toWireRecordAttribute,
  toWireRecordDetail,
  toWireRecordListAllRow,
  toWireRecordRelation,
  toWireRecordRelationRef,
  toWireTimelineEntry,
} from '#trpc/wire'

const retroAndRevision = {
  retroId: z.int(),
  revision: z.int().positive().optional(),
}

/**
 * The records column and the record pane.
 *
 * Both report the **effective** state — a decision carried over from an earlier
 * revision counts as decided, and a record whose narrative changed since counts
 * as pending again (D2). That distinction is the whole reason the reviewer can
 * trust the column, so it is on the wire rather than recomputed in the browser.
 *
 * Both reported a `hold` on its own key for one session and no longer do
 * (`r-remove-hold`): the lifecycle flag was removed on first contact, and
 * "not to be done without me" is `involvement`, which rides on the decision.
 */
export const recordsRouter = router({
  list: procedure
    .input(z.strictObject(retroAndRevision))
    .output(recordListSchema)
    .query(async ({ input, ctx }) => {
      const { retroId, revisionN, records } = await ctx.app.records.list.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        revision: input.revision,
      })

      return {
        retroId,
        revision: revisionN,
        pending: records.filter((view) => view.decision.state === 'pending').length,
        records: records.map((view) => ({
          rid: view.record.rid,
          // Off the view rather than out of the record: the number lives beside
          // the narrative, never in it (`record.view.ts`).
          globalId: view.globalId,
          num: view.record.num,
          title: view.record.title,
          type: view.record.type,
          requester: view.record.requester,
          state: view.decision.state,
          decidedOnRevision: view.decision.decidedOnRevision ?? null,
          carriedOver: view.decision.carriedOver,
          contentChangedSince: view.decision.contentChangedSince ?? null,
          // The use case has always returned this; the summary simply did not
          // pass it on. Same shape `records.listAll` sends, through the
          // same converter, so a record reads the same on both lists.
          lifecycle: toWireLifecycle(view.lifecycle),
          // Who has picked it up, if anybody — the card's "in progress" badge.
          // There is no procedure to write one: the claim is the
          // solving side's and it is taken through the CLI, in the AI's own
          // process, so this wire carries the reading and nothing else.
          claim: toWireClaim(view.claim),
        })),
      }
    }),

  get: procedure
    .input(z.strictObject({ ...retroAndRevision, rid: ridSchema }))
    .output(recordDetailSchema)
    .query(async ({ input, ctx }) => {
      const { retroId, record, labels } = await ctx.app.records.get.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        rid: input.rid,
        revision: input.revision,
      })

      return toWireRecordDetail(retroId, record, labels)
    }),

  /**
   * **One record, reached by the number a human reads off the page** — the
   * record page (`/records/:id`). Clicking a record on the records page used to
   * land on its retrospective page; each record has its own dedicated page
   * instead.
   *
   * `id` is the **global** number, which is the one name a record has that is
   * not a pair. Every other record procedure here takes `(retroId, rid)`,
   * because that is what actually addresses a record (A5) — and a pair is not
   * something anyone types, pastes into a message, or bookmarks. So this
   * procedure exists for the URL: the resolver runs the store's own sequence
   * backwards and everything after it is the same read the others make.
   *
   * **It is not `records.get` with a different argument.** `records.get` answers
   * for a record *inside a review the caller is already on* — it takes a
   * revision, because the review page can be pinned to an older one, and it
   * answers nothing about where the record came from because the page is already
   * holding `retros.get`. This answers for a record on its own: the latest
   * revision and only that, plus the identity line, plus where the lifecycle
   * stands, plus the timeline. Widening `records.get` to carry all of it would
   * have put five keys on every card of every review to serve one page.
   *
   * A read, so both actors may call it — only writes are actor-bound.
   */
  byId: procedure
    .input(z.strictObject({ id: z.int().positive() }))
    .output(recordPageSchema)
    .query(async ({ input, ctx }) => {
      const answer = await ctx.app.records.byId.execute({ actor: ctx.actor, id: input.id })

      return {
        ...toWireRecordDetail(answer.retroId, answer.record, answer.labels),
        retroNumber: answer.retroNumber,
        session: {
          id: answer.session.id,
          cwd: answer.session.cwd,
          startedAt: answer.session.startedAt,
        },
        lifecycle: toWireLifecycle(answer.lifecycle),
        // Beside the lifecycle and not inside it: a claim is not a fourth
        // position on that axis — a claimed record is still open — and the
        // review card reads the same key off `list` above.
        claim: toWireClaim(answer.claim),
        // The one key this page adds that the review card does not read: a
        // value is data about a record and is something you go and look at
        // (`views.schema.ts` §recordPageSchema).
        attributes: answer.attributes.map(toWireRecordAttribute),
        // Both directions, each naming the *other* record — the page renders one
        // block and the direction is what tells the two apart
        // (`views.schema.ts` §recordRelationSchema).
        relations: answer.relations.map(toWireRecordRelation),
        timeline: answer.timeline.map(toWireTimelineEntry),
      }
    }),

  /**
   * **Every record of every retrospective, flat** — the page that shows all the
   * retro items flat with filtering, so every item can be seen in one list
   * irrespective of its session, retrospective or cwd.
   *
   * No arguments at all, and `z.strictObject({})` rejects anything sent anyway —
   * the same call `retros.list` makes and for the same reason. Filtering was
   * asked for and the filters are the page's: the whole store is hundreds of
   * records for one user, so the browser can hold every row, and a filter
   * parameter would be a decision made ahead of the evidence about which filters
   * matter (A4).
   *
   * A read, so both actors may call it — only writes are actor-bound.
   */
  listAll: procedure
    .input(z.strictObject({}))
    .output(z.array(recordListAllRowSchema))
    .query(async ({ ctx }) => {
      const { records } = await ctx.app.records.listAll.execute({ actor: ctx.actor })
      return records.map(toWireRecordListAllRow)
    }),

  /**
   * The human marks a record resolved after it was fixed, reopens it, puts it
   * out of the way, or brings it back.
   *
   * **One procedure carrying the act**, rather than a procedure per position:
   * all four write a version of the same thing, and the four *names* that do
   * exist live in the outbox, where a consumer needs to tell them apart without
   * unpacking a payload. `threads.resolve` made the same call with a boolean;
   * this takes the status word instead, because a third position was a
   * plausible next ask when this was written and turned out to be two — the
   * input widened here and the procedure count did not move.
   *
   * `refs` and `note` are transport-optional here and the **domain** decides
   * which pairings are legal, who may take which act, and from which state.
   * A resolve cites at least one reference and nothing else cites any; archiving
   * and unarchiving are the human's; an act is only legal from the states
   * `LIFECYCLE_ACT_FROM` names. Restating any of that in this file would be a
   * second copy of it, free to disagree with the CLI's; the use case raises
   * `ValidationError`, `ForbiddenActorError` or `ConflictError` and the
   * middleware maps each one.
   *
   * The actor is the context's, which is `human` unconditionally and has nothing
   * to negotiate (`context.ts`). The AI writes these rows too — resolving is the
   * reason the feature exists — but it does it in its own process through the
   * CLI, which is where every AI write in this system happens. So
   * there is no actor argument here, and no way for a browser to claim to be the
   * AI — which also means this transport can never be refused by the human-only
   * rule, and the rule is in the use case precisely so that is not what enforces
   * it.
   */
  setLifecycle: procedure
    .input(
      z.strictObject({
        retroId: z.int(),
        rid: ridSchema,
        status: recordLifecycleStatusSchema,
        refs: z.array(z.string()).optional(),
        note: z.string().optional(),
      }),
    )
    .output(recordLifecycleResultSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.records.setLifecycle.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        rid: input.rid,
        status: input.status,
        refs: input.refs,
        note: input.note,
      })

      return {
        retroId: result.retroId,
        rid: result.rid,
        version: result.version,
        lifecycle: toWireLifecycle(result.lifecycle),
      }
    }),

  /**
   * **Two records said to belong together, in the words of whoever relates
   * them** — or the relation taken off. Both actors can relate records, each
   * relation carries how-they-relate words, and the relation reads from both
   * sides, so that the AI can easily find past records and build holistic
   * solutions.
   *
   * **One procedure carrying both acts**, on the standing `records.setLifecycle`
   * pattern two procedures up: the input widens here and the procedure count
   * does not move. The input it widens with is `labels.set`'s boolean rather than
   * that one's status word, and the difference is the difference those two
   * argued: a lifecycle position turned out to be a scale that grew from two to
   * four inside a session, and relating is on and off with no third position for
   * a relation to occupy. Either way the alternative here was a second procedure
   * the typed mock has to cover, holding a second copy of the same guards.
   *
   * **Both ends are global ids, and that is the only addressing available.**
   * Every other record procedure here takes `(retroId, rid)`, which is what
   * identifies a record (A5); a relation identifies two, and a four-field input
   * made of two pairs is an input nobody can read. The number is also what the
   * page is already holding — it is the number in the URL of both records.
   *
   * `how` is transport-optional and the **domain** decides the pairing: required
   * and non-empty on a relate, refused on an un-relate, which carries forward the
   * words of the relation it takes off. Restating that here would be a second
   * copy of it, free to disagree with the CLI's; the use case raises
   * `ValidationError`, `NotFoundError` or `ConflictError` and the middleware maps
   * each one.
   *
   * The actor is the context's, which is `human` unconditionally
   * (`context.ts`). The AI writes these rows too — both actors can relate
   * records — but it does it in its own process
   * through the CLI, which is where every AI write in this system happens.
   */
  relate: procedure
    .input(
      z.strictObject({
        fromId: z.int().positive(),
        toId: z.int().positive(),
        related: z.boolean(),
        how: z.string().optional(),
      }),
    )
    .output(recordRelationsResultSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.records.relate.execute({
        actor: ctx.actor,
        fromId: input.fromId,
        toId: input.toId,
        related: input.related,
        how: input.how,
      })

      return {
        fromId: result.fromId,
        toId: result.toId,
        version: result.version,
        // Where the write leaves the record it was authored from — the shape
        // `labels.set` and `records.setLifecycle` both answer in. Without titles:
        // naming the far end costs a read of its retrospective, and the page
        // invalidates `records.byId` and gets the named shape from there
        // (`views.schema.ts` §recordRelationsResultSchema).
        relations: result.relations.map(toWireRecordRelationRef),
      }
    }),
})
