import type { Clock } from '#application/ports/clock.port'

export type FakeClock = Clock & {
  /** What `now()` currently returns, as the ledger stores it. */
  iso(): string
  advance(milliseconds: number): void
  set(iso: string): void
}

/**
 * A frozen clock that only moves when a test moves it (testing.md §Determinism).
 * Frozen by default so a timestamp assertion is `expect(x).toBe(clock.iso())`
 * rather than arithmetic over how many writes happened first.
 */
export function createFakeClock(start = '2026-08-23T09:00:00.000Z'): FakeClock {
  let current = new Date(start)
  return {
    now: () => new Date(current),
    iso: () => current.toISOString(),
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds)
    },
    set: (iso) => {
      current = new Date(iso)
    },
  }
}
