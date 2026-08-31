/**
 * Integer identity for stores that have no sequence of their own — today, the
 * memory adapter (KC-0011: integer primary keys everywhere). The SQLite adapter
 * gets its ids from `AUTOINCREMENT` and never asks this port.
 *
 * Injecting it keeps memory-backed suites deterministic: ids are 1, 2, 3… in
 * write order, so a test can assert on them without a fixture lookup.
 */
export type IdGen = {
  next(): number
}
