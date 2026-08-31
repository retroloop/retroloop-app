import type { DomainEvent } from '@retro/core'
import { tracked } from '@trpc/server'
import { z } from 'zod'
import { createEventQueue } from '#events/queue'
import { procedure, router } from '#trpc/trpc'
import { toWireEvent } from '#trpc/wire'

/**
 * `events.onRetro` — the one stream a review page opens (realtime.md).
 *
 * **Order matters here, and it is the whole design.** The listener is registered
 * *before* the replay query, so an event committed between the two waits in the
 * queue instead of falling down the gap; the replay then yields history, and the
 * live loop skips anything the replay already covered. Registering after the
 * query would lose events; not de-duplicating would send them twice.
 *
 * **No `lastEventId` means "from now", not "from the beginning".** A page that
 * has just fetched its queries wants what happens next — replaying the whole
 * ledger at every first connect would be both wasteful and wrong, since the
 * queries already carry that state. Replay exists for reconnects, where the
 * browser supplies the id it got to.
 *
 * Scope is the retrospective **and its session** (trpc.md): events of the retro
 * itself, plus session-level ones like a note being added. Another session's
 * retrospective never appears.
 *
 * There is no `.output()`: tRPC validates a subscription's yielded value as the
 * `tracked()` envelope rather than the payload inside it, so declaring one
 * rejects every event. The payload is typed through `toWireEvent` instead.
 */
export const eventsRouter = router({
  onRetro: procedure
    .input(z.strictObject({ retroId: z.int(), lastEventId: z.string().nullish() }))
    .subscription(async function* ({ input, ctx, signal }) {
      const { retrospective } = await ctx.app.revisions.list.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
      })

      const belongs = (event: DomainEvent): boolean =>
        event.retroId === retrospective.id ||
        (event.sessionId !== undefined && event.sessionId === retrospective.sessionId)

      const queue = createEventQueue(signal)
      const unsubscribe = ctx.tailer.listen(queue.push)

      try {
        let lastId = 0
        if (input.lastEventId === undefined || input.lastEventId === null) {
          const head = await ctx.app.events.list.execute({ actor: ctx.actor, limit: 1 })
          lastId = head.latestId
        } else {
          const resumeFrom = Number.parseInt(input.lastEventId, 10)
          lastId = Number.isInteger(resumeFrom) && resumeFrom > 0 ? resumeFrom : 0

          const { events } = await ctx.app.events.list.execute({
            actor: ctx.actor,
            afterId: lastId,
          })
          for (const event of events) {
            if (!belongs(event)) continue
            lastId = Math.max(lastId, event.id)
            yield tracked(String(event.id), toWireEvent(event))
          }
        }

        for await (const event of queue.drain()) {
          if (event.id <= lastId || !belongs(event)) continue
          lastId = event.id
          yield tracked(String(event.id), toWireEvent(event))
        }
      } finally {
        unsubscribe()
      }
    }),
})
