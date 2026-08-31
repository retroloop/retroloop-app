import { FinishGateError, isDomainError } from '@retro/core'
import { TRPCError } from '@trpc/server'

/** The message an unknown failure is allowed to show a browser. */
export const SCRUBBED_MESSAGE = 'Internal server error'

/**
 * The domain-error → TRPCError map (trpc.md §Error map).
 *
 * `FinishGateError` is the one that carries a payload: refusing to finish a
 * review is only useful if the page can say *which* records are still undecided,
 * so the pending rids travel in `cause` and are read back out by the router's
 * error shaping below.
 *
 * Anything that is not a domain error is scrubbed. A `NOT_FOUND` tells the caller
 * something true about their request; a stack trace from a broken query tells
 * them about our internals, and the browser has no use for it.
 */
export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error

  if (isDomainError(error)) {
    switch (error.code) {
      case 'NOT_FOUND':
        return new TRPCError({ code: 'NOT_FOUND', message: error.message, cause: error })
      case 'CONFLICT':
        return new TRPCError({ code: 'CONFLICT', message: error.message, cause: error })
      case 'FORBIDDEN_ACTOR':
        return new TRPCError({ code: 'FORBIDDEN', message: error.message, cause: error })
      case 'VALIDATION':
        return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error })
      case 'FINISH_GATE':
        return new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: error.message,
          cause: error,
        })
    }
  }

  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: SCRUBBED_MESSAGE })
}

/** The rids the finish gate refused on, when that is what happened. */
export function pendingRidsOf(error: unknown): readonly string[] | undefined {
  const cause = error instanceof TRPCError ? error.cause : error
  return cause instanceof FinishGateError ? cause.pendingRids : undefined
}
