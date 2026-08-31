import type { App, Clock } from '@retro/core'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createTailer, type EventSource, type Tailer } from '#events/tailer'
import { createStaticHandler } from '#static'
import { createContextFactory } from '#trpc/context.factory'
import { appRouter } from '#trpc/router'

/** Where tRPC lives; everything else is the web app. */
export const TRPC_ENDPOINT = '/trpc'

export const DEFAULT_STATIC_ROOT = new URL('../../web/dist', import.meta.url).pathname

export type RequestHandler = (request: Request) => Promise<Response>

export type ServerRuntimeOptions = {
  readonly app: App
  /**
   * The tailer's view of the store — **a different connection from the app's**.
   * `PRAGMA data_version` only moves for another connection's commits, so a
   * tailer sharing the writer's handle would never see the server's own writes.
   */
  readonly eventSource: EventSource
  readonly staticRoot?: string
  readonly clock?: Clock
  readonly pollIntervalMs?: number
}

export type ServerRuntime = {
  readonly handler: RequestHandler
  readonly tailer: Tailer
  /** Stops the tailer. The store belongs to whoever opened it. */
  stop(): Promise<void>
}

/**
 * Everything the server is, minus the listening socket — and **the only thing
 * this package assembles**.
 *
 * The composition root is the CLI's `serve` command (architecture.md
 * §Composition roots): it takes the stage lock *before* anything is migrated or
 * a port is bound, and it holds its two store handles for as long as the process
 * is up rather than for one command. Nothing here can do that, so nothing here
 * tries — this package hands over a mounted handler and lets the owner of the
 * stage own the listening socket. A second `serve()` living here would be a
 * second answer to "how does the server start", and the wrong one.
 *
 * Leaving the socket out is also what lets a test drive the handler with real
 * `Request` objects and no port at all.
 */
export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const tailer = createTailer(options.eventSource, {
    clock: options.clock,
    intervalMs: options.pollIntervalMs,
  })
  tailer.start()

  const createContext = createContextFactory({ app: options.app, tailer })
  const serveStatic = createStaticHandler({ root: options.staticRoot ?? DEFAULT_STATIC_ROOT })

  return {
    tailer,
    handler: async (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === TRPC_ENDPOINT || pathname.startsWith(`${TRPC_ENDPOINT}/`)) {
        return fetchRequestHandler({
          endpoint: TRPC_ENDPOINT,
          req: request,
          router: appRouter,
          createContext,
        })
      }
      return serveStatic(request)
    },
    stop: async () => {
      await tailer.stop()
    },
  }
}
