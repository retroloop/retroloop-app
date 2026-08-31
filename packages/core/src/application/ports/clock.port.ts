/**
 * Time as a dependency. Nothing below the composition roots may call `Date.now()`
 * — every timestamp in the ledger comes from here, so tests are deterministic and
 * a spawned process can be pinned with `RETRO_TEST_CLOCK` (testing.md §Determinism).
 */
export type Clock = {
  now(): Date
}

/** ISO-8601 with milliseconds — the one timestamp format the ledger stores. */
export function timestamp(clock: Clock): string {
  return clock.now().toISOString()
}
