import {
  type Clock,
  type CursorRepository,
  type DomainEvent,
  type EventRepository,
  systemClock,
  timestamp,
} from '@retro/core'

/** The cursor row this tailer resumes from. */
export const TAILER_CURSOR = 'tailer'

/** realtime.md §The tailer: ~300 ms. */
export const DEFAULT_POLL_INTERVAL_MS = 300

export type EventListener = (event: DomainEvent) => void

/**
 * What the tailer needs from a store.
 *
 * **It must be a different connection from the one the server writes through.**
 * `PRAGMA data_version` changes only when *another* connection commits, so a
 * tailer sharing the writer's connection would never notice the server's own
 * mutations — the page would go quiet for exactly the changes the person just
 * made. The composition root opens a second handle on the same file, which is
 * what WAL is for.
 *
 * `dataVersion` is optional because the memory store has no equivalent. Without
 * it the loop simply queries every tick; with it, an idle tick costs one pragma.
 */
export type EventSource = {
  readonly events: EventRepository
  readonly cursors: CursorRepository
  dataVersion?(): number
}

export type TailerStats = {
  /** Loop ticks. */
  readonly polls: number
  /** Ticks that actually asked for events — the ones a pragma could not rule out. */
  readonly queries: number
  readonly dispatched: number
}

export type Tailer = {
  /** How many subscriptions are attached — observable so a caller need not sleep to find out. */
  readonly listenerCount: number
  start(): void
  stop(): Promise<void>
  /** Registers a listener for every event; returns the unsubscribe. */
  listen(listener: EventListener): () => void
  /** One cycle, for the loop and for tests that would rather not wait. */
  poll(): Promise<readonly DomainEvent[]>
  readonly stats: TailerStats
}

export type TailerOptions = {
  readonly clock?: Clock
  readonly intervalMs?: number
}

/**
 * Tails the outbox and hands every new event to every listener (realtime.md).
 *
 * It does not special-case who wrote the event, and it does not know who is
 * listening: one path covers the CLI's writes, the server's own mutations, and
 * anything added later. Filtering is the subscription's job.
 *
 * The cursor advances **after** dispatch and is persisted, so a restart resumes
 * where it left off rather than replaying history at every open page.
 */
export function createTailer(source: EventSource, options: TailerOptions = {}): Tailer {
  const clock = options.clock ?? systemClock
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS

  const listeners = new Set<EventListener>()
  let cursor = 0
  let cursorLoaded = false
  let lastVersion: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<unknown> = Promise.resolve()
  const stats = { polls: 0, queries: 0, dispatched: 0 }

  async function poll(): Promise<readonly DomainEvent[]> {
    stats.polls += 1

    if (!cursorLoaded) {
      cursor = (await source.cursors.find(TAILER_CURSOR))?.position ?? 0
      cursorLoaded = true
    }

    const version = source.dataVersion?.()
    if (version !== undefined && version === lastVersion) return []
    lastVersion = version

    stats.queries += 1
    const events = await source.events.list({ afterId: cursor })
    if (events.length === 0) return []

    for (const event of events) {
      for (const listener of listeners) listener(event)
    }

    const last = events.at(-1)
    if (last !== undefined) {
      cursor = last.id
      await source.cursors.save({
        name: TAILER_CURSOR,
        position: cursor,
        updatedAt: timestamp(clock),
      })
    }
    stats.dispatched += events.length
    return events
  }

  return {
    stats,
    get listenerCount() {
      return listeners.size
    },
    listen(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    poll,
    start() {
      if (timer !== undefined) return
      timer = setInterval(() => {
        // Never let two cycles overlap: a slow read would otherwise dispatch the
        // same events twice, since the cursor only moves once the first finishes.
        inFlight = inFlight.then(poll).catch(() => undefined)
      }, intervalMs)
    },
    async stop() {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      await inFlight
      listeners.clear()
    },
  }
}
