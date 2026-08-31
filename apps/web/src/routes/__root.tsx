import type { AppRouter } from '@retro/api'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { TRPCClient } from '@trpc/client'
import { ThemeProvider } from '@/components/chrome/theme-provider'
import { TRPCProvider } from '@/lib/trpc'

export type RouterContext = {
  readonly queryClient: QueryClient
  readonly trpcClient: TRPCClient<AppRouter>
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout })

function RootLayout() {
  const { queryClient, trpcClient } = Route.useRouteContext()

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
}
