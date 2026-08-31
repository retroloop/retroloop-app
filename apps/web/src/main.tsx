import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createQueryClient, createTrpcClient } from '@/lib/trpc'
import { routeTree } from './routeTree.gen'
import './styles.css'

const queryClient = createQueryClient()
const trpcClient = createTrpcClient()

const router = createRouter({ routeTree, context: { queryClient, trpcClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('index.html is missing the #root mount point')

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
