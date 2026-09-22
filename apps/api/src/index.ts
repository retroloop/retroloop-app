/**
 * `@retro/api` — the server (L4a).
 *
 * `apps/web` imports **types only** from here: `AppRouter` is the mock-lock
 * anchor and `Context` is the request shape. A value import across that edge
 * would survive type erasure and `check-deps` rejects it (R-MOCK-LOCK).
 */
export { createEventQueue, type EventQueue } from '#events/queue'
export {
  createTailer,
  DEFAULT_POLL_INTERVAL_MS,
  type EventListener,
  type EventSource,
  TAILER_CURSOR,
  type Tailer,
  type TailerStats,
} from '#events/tailer'
export {
  createServerRuntime,
  DEFAULT_STATIC_ROOT,
  type RequestHandler,
  type ServerRuntime,
  type ServerRuntimeOptions,
  TRPC_ENDPOINT,
} from '#server'
export {
  createStaticHandler,
  type StaticHandlerOptions,
  WEB_BUILD_COMMAND,
  WEB_BUILD_INDEX,
  webBuildRootFrom,
} from '#static'
export type { Context } from '#trpc/context'
export { type ContextFactoryOptions, createContextFactory } from '#trpc/context.factory'
export { pendingRidsOf, SCRUBBED_MESSAGE, toTRPCError } from '#trpc/errors'
export {
  type AppRouter,
  type AppRouterInputs,
  type AppRouterOutputs,
  appRouter,
  type CreateCallerOptions,
  createCaller,
} from '#trpc/router'
export * from '#trpc/views.schema'
export { toWireDecision, toWireEvent, toWireThread } from '#trpc/wire'
