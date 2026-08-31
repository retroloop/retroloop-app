import type { AppRouter } from '@retro/api'
import type { TRPCLink } from '@trpc/client'

/**
 * The one seam R-MOCK-LOCK swaps.
 *
 * `@/lib/transport` supplies the links the tRPC client talks through. The
 * production build resolves it to the HTTP links; `vite build --mode mocked`
 * resolves it to `test/trpc-mock.ts`, the single typed mock. Both sides declare
 * themselves against this type, so the swap is checked by the compiler rather
 * than hoped for — and because the seam is *behind* the client, no test ever has
 * a request to intercept.
 *
 * It lives in its own file so neither implementation has to import the other.
 */
export type TrpcLinkFactory = () => TRPCLink<AppRouter>[]
