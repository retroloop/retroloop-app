import { httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import type { TrpcLinkFactory } from '@/lib/link-contract'

/**
 * Where tRPC lives. The server owns the real constant (`TRPC_ENDPOINT` in
 * `@retro/api`), and it is a *value* — importing it would turn the type-only
 * `web -> api` edge into a runtime dependency, which `check-deps` rejects. So
 * the path is repeated here, and `apps/api/test/static.test.ts` is what keeps
 * the two honest: the SPA is served by the same server that answers on it.
 */
const TRPC_ENDPOINT = '/trpc'

/**
 * The production transport: batched HTTP for queries and mutations, SSE for the
 * one subscription (realtime.md — plain HTTP needs no TLS, because the server
 * listens on this machine only and a remote reader reaches it through an SSH
 * tunnel that is already encrypted; and `EventSource` reconnects with
 * `Last-Event-ID` on its own).
 */
export const createTrpcLinks: TrpcLinkFactory = () => [
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({ url: TRPC_ENDPOINT }),
    false: httpBatchLink({ url: TRPC_ENDPOINT }),
  }),
]
