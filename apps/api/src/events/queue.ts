import type { DomainEvent } from '@retro/core'

export type EventQueue = {
  push(event: DomainEvent): void
  drain(): AsyncGenerator<DomainEvent>
}

/**
 * Bridges the tailer's callback into the subscription's async generator.
 *
 * It buffers rather than dropping, which is what closes the gap between "start
 * listening" and "finish replaying": the subscription registers its listener
 * *before* it queries the table, so anything committed during the replay waits
 * here instead of being lost between the two.
 */
export function createEventQueue(signal?: AbortSignal): EventQueue {
  const buffer: DomainEvent[] = []
  let wake: (() => void) | undefined

  const notify = (): void => {
    const waiting = wake
    wake = undefined
    waiting?.()
  }
  signal?.addEventListener('abort', notify, { once: true })

  // Read through a call, not a property: the flag flips while this generator is
  // suspended, and TypeScript would otherwise narrow it to `false` for the rest
  // of the loop and report the second check as unreachable.
  const aborted = (): boolean => signal?.aborted === true

  return {
    push(event) {
      buffer.push(event)
      notify()
    },
    async *drain() {
      for (;;) {
        while (buffer.length > 0) {
          const next = buffer.shift()
          if (next !== undefined) yield next
        }
        if (aborted()) return

        await new Promise<void>((resolve) => {
          wake = resolve
        })
        if (aborted()) return
      }
    },
  }
}
