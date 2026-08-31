import type { IdGen } from '#application/ports/id-gen.port'

/**
 * The memory store's sequence: 1, 2, 3… in write order, shared by every table so
 * an id identifies a row uniquely across the whole store. The SQLite adapter has
 * `AUTOINCREMENT` instead and never uses this.
 */
export function createCounterIdGen(start = 1): IdGen {
  let next = start
  return {
    next: () => next++,
  }
}
