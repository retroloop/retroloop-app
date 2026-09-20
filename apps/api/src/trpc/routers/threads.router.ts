import { recordSectionSchema, ridSchema } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { threadSchema } from '#trpc/views.schema'
import { toWireThread } from '#trpc/wire'

/** Where a new thread hangs: one section of one record, or the review itself. */
const targetSchema = z.union([
  z.strictObject({ kind: z.literal('record'), rid: ridSchema, section: recordSectionSchema }),
  z.strictObject({ kind: z.literal('review') }),
])

/**
 * The revision the writer had on screen. Optional, and stored when it is given.
 *
 * A revision is announced and never swapped in, so the reader may be pinned to
 * `?rev=1` while revision 2 exists — and what they write belongs to what they
 * were reading, which only the page knows. Left out, the comment is stamped with
 * the latest revision, in the same unit of work as the write.
 */
const revisionSchema = z.int().positive()

/**
 * Comments from the browser, which means comments from the human — the context's
 * actor is `human` unconditionally (trpc.md), so nothing here decides authorship.
 *
 * `reply` takes only a thread id: a thread already knows which retrospective it
 * belongs to, and asking the page to repeat it would only create a way for the
 * two to disagree.
 */
export const threadsRouter = router({
  /**
   * **Every thread of the retrospective, record-level and review-level alike.**
   *
   * This filtered to review-level threads at first, and the reason it gave — one
   * thread, one source — now points the other way. Inline comments in the retro
   * body were replaced by comments in the side panel, so that the human sees all
   * comments in one place. A panel that is the one comments surface needs one
   * call that answers "every comment in this retrospective", and no arrangement
   * of record-scoped calls can: the review's own threads hang off no record.
   *
   * **This is that one source.** `records.get` no longer carries a record's
   * threads at all (`views.schema.ts` §recordDetailSchema) — the key came off
   * the wire at the same time, with the inline rendering that read it. Two
   * procedures answering for the same threads would be two answers to keep in
   * agreement, and the one scoped to a record was never able to give the whole.
   */
  list: procedure
    .input(z.strictObject({ retroId: z.int() }))
    .output(z.array(threadSchema))
    .query(async ({ input, ctx }) => {
      const { threads } = await ctx.app.threads.list.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
      })
      return threads.map(toWireThread)
    }),

  reply: procedure
    .input(
      z.strictObject({
        threadId: z.int(),
        text: z.string().min(1),
        revision: revisionSchema.optional(),
      }),
    )
    .output(threadSchema)
    .mutation(async ({ input, ctx }) => {
      const { thread } = await ctx.app.threads.addComment.execute({
        actor: ctx.actor,
        target: { kind: 'thread', threadId: input.threadId },
        text: input.text,
        revisionN: input.revision,
      })
      return toWireThread(thread)
    }),

  open: procedure
    .input(
      z.strictObject({
        retroId: z.int(),
        target: targetSchema,
        text: z.string().min(1),
        revision: revisionSchema.optional(),
      }),
    )
    .output(threadSchema)
    .mutation(async ({ input, ctx }) => {
      const { thread } = await ctx.app.threads.addComment.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        target:
          input.target.kind === 'record'
            ? { kind: 'record', rid: input.target.rid, section: input.target.section }
            : { kind: 'review' },
        text: input.text,
        revisionN: input.revision,
      })
      return toWireThread(thread)
    }),

  /**
   * The human marks a thread dealt with, or takes it back
   * (`r-resolvable-comments`).
   *
   * One procedure with a boolean rather than a `resolve`/`reopen` pair, because
   * the page has one control and its two positions are the same act: the use
   * case appends a version either way, so nothing is undone, only said again.
   *
   * The browser is the only caller it could ever have — the CLI writes as `ai`
   * and the use case refuses that actor before it looks at anything else.
   */
  resolve: procedure
    .input(z.strictObject({ threadId: z.int(), resolved: z.boolean() }))
    .output(threadSchema)
    .mutation(async ({ input, ctx }) => {
      const { thread } = await ctx.app.threads.resolve.execute({
        actor: ctx.actor,
        threadId: input.threadId,
        resolved: input.resolved,
      })
      return toWireThread(thread)
    }),
})
