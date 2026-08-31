import type { Actor, App } from '@retro/core'
import type { Tailer } from '#events/tailer'

/**
 * The request context — **type only**.
 *
 * `apps/web` imports this file and nothing else from the server side, so it has
 * to stay free of values: a value import would survive type erasure and turn the
 * `web → api` edge into a runtime dependency, which `check-deps` rejects
 * (repo-layout.md). The value that builds one lives in `context.factory.ts`.
 */
export type Context = {
  readonly app: App
  readonly tailer: Tailer
  /**
   * Always `human` (trpc.md §Principles). The browser is the only client, and it
   * is the human; the CLI runs the App in-process and never comes through here.
   * There is no actor negotiation and nothing to spoof — an AI write cannot
   * arrive over this transport at all, and core's L3 guards still hold if one
   * somehow did.
   */
  readonly actor: Actor
}
