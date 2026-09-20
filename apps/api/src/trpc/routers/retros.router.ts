import { retroDisplayState } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { retroListRowSchema, retroSchema } from '#trpc/views.schema'
import { toWireRetroListRow } from '#trpc/wire'

/**
 * The retrospective namespace: one retro for the review page, and every retro
 * for the dashboard. Both answer "Retro #n within its session", which is not
 * stored anywhere — retrospectives have ids, and #n is where one falls among its
 * session's.
 */
export const retrosRouter = router({
  /**
   * `retros.get` — the breadcrumb, the retro's state, and the revision list the
   * `?rev=k` selector pins against (trpc.md).
   *
   * The breadcrumb reads "Session › Retro #n · Rev k", with the project ahead of
   * it only on the sessions that still carry one, so the retrospective's
   * **position within its session** is part of the answer.
   *
   * The session rides as the same identity shape `retros.list` carries, because
   * the page above the records states the same line a dashboard row does —
   * "Retro #n · Session S · <cwd>". The session was already read here for the
   * project crumb, so the `cwd` costs nothing to answer with.
   */
  get: procedure
    .input(z.strictObject({ retroId: z.int() }))
    .output(retroSchema)
    .query(async ({ input, ctx }) => {
      const { retrospective, revisions } = await ctx.app.revisions.list.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
      })
      const session = await ctx.app.sessions.get.execute({
        actor: ctx.actor,
        session: retrospective.sessionId,
      })

      return {
        retroId: retrospective.id,
        session: {
          id: session.session.id,
          cwd: session.session.cwd,
          startedAt: session.session.startedAt,
        },
        project: session.session.project ?? null,
        title: revisions.at(-1)?.title ?? null,
        retroNumber:
          session.retrospectives.findIndex((candidate) => candidate.id === retrospective.id) + 1,
        // The displayed reading, not the stored column: `submitted` is
        // `reviewing` plus a finished latest round, and the round's own
        // `finishedAt` two fields down is where that fact already came from —
        // one events read serving both (`retro.view.ts`).
        state: retroDisplayState(retrospective.state, revisions.at(-1)?.finishedAt !== undefined),
        startedAt: retrospective.startedAt,
        finishedAt: retrospective.finishedAt ?? null,
        latestRevision: revisions.at(-1)?.n ?? null,
        revisions: revisions.map((revision) => ({
          n: revision.n,
          createdAt: revision.createdAt,
          records: revision.records,
          // Per revision, and not the retro's own close two fields up: this is
          // the round the human finished, which is what the review bar's
          // submitted state has to survive a reload on
          // (`r-finish-button-reenables`).
          finishedAt: revision.finishedAt ?? null,
        })),
      }
    }),

  /**
   * `retros.list` — the dashboard, whole.
   *
   * Every retrospective across every session, newest first, each row carrying
   * the identity line, the name, the state and how much of the review is left.
   * It takes no input at all: dashboard v1 is one flat list with no grouping,
   * no filtering and no paging, and a parameter nothing sends would be a
   * decision made ahead of the evidence. `z.strictObject({})` says so and
   * rejects anything sent anyway.
   */
  list: procedure
    .input(z.strictObject({}))
    .output(z.array(retroListRowSchema))
    .query(async ({ ctx }) => {
      const { retros } = await ctx.app.retros.list.execute({ actor: ctx.actor })
      return retros.map(toWireRetroListRow)
    }),
})
