import { initTRPC } from '@trpc/server'
import type { Context } from '#trpc/context'
import { pendingRidsOf, toTRPCError } from '#trpc/errors'

const t = initTRPC.context<Context>().create({
  /**
   * Shapes the wire error. The pending rids of a refused finish ride in `data`
   * so the review page can name the records rather than just report a failure.
   */
  errorFormatter({ shape, error }) {
    const pendingRids = pendingRidsOf(error)
    if (pendingRids === undefined) return shape
    return { ...shape, data: { ...shape.data, pendingRids: [...pendingRids] } }
  },
})

export const router = t.router
export const createCallerFactory = t.createCallerFactory

/**
 * Every procedure is built from this one, so the error map applies to all of
 * them without anyone remembering to apply it.
 *
 * **The middleware inspects the result; it does not wrap the call in try/catch.**
 * In tRPC v11 `next()` *resolves* with `{ok: false, error}` rather than throwing,
 * so a `catch` block here would never run and every domain error would reach the
 * browser as `INTERNAL_SERVER_ERROR` — the failure would be silent and the map
 * would look correct. That is the same shape of trap as a yargs `fail` handler
 * that returns instead of throwing.
 */
export const procedure = t.procedure.use(async (opts) => {
  const result = await opts.next()
  if (result.ok) return result

  // Input validation failed before the handler ran: tRPC has already made this a
  // BAD_REQUEST, which is what the map says a ValidationError becomes.
  if (result.error.code === 'BAD_REQUEST' && result.error.cause?.name === 'ZodError') {
    return result
  }

  throw toTRPCError(result.error.cause ?? result.error)
})
