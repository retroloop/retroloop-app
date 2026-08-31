import type { Clock } from '#application/ports/clock.port'

/** The real clock. Composition roots pass this; tests pass a fake. */
export const systemClock: Clock = {
  now: () => new Date(),
}
