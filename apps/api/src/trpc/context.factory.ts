import type { App } from '@retro/core'
import type { Tailer } from '#events/tailer'
import type { Context } from '#trpc/context'

export type ContextFactoryOptions = {
  readonly app: App
  readonly tailer: Tailer
}

/**
 * Builds the context for every request. It takes no request argument on purpose:
 * nothing about who is calling changes the answer, because the only caller is the
 * human's browser (trpc.md).
 */
export function createContextFactory(options: ContextFactoryOptions): () => Context {
  return () => ({
    app: options.app,
    tailer: options.tailer,
    actor: 'human',
  })
}
