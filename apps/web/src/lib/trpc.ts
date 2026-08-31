import type { AppRouter } from '@retro/api'
import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient } from '@trpc/client'
import { createTRPCContext } from '@trpc/tanstack-react-query'
import { createTrpcLinks } from '@/lib/transport'

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()

/**
 * `retry: false` because a failure here is information, not noise: `retros.get`
 * answering NOT_FOUND is how an unknown id renders "not found", and retrying it
 * three times only delays the page saying so.
 *
 * The `refetchInterval` is realtime.md's safety net, not the update mechanism —
 * the subscription is. It exists so a page whose stream died quietly still
 * converges on what the database says instead of drifting.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchInterval: 30_000 },
      mutations: { retry: false },
    },
  })
}

export function createTrpcClient() {
  return createTRPCClient<AppRouter>({ links: createTrpcLinks() })
}
