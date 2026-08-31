/**
 * A definition that vanished between being resolved and being written to.
 *
 * **Not a `DomainError`, deliberately.** Every use case that renames or retires
 * resolves the definition first, inside the same unit of work, and answers a
 * genuine miss with `NotFoundError` there — so reaching this is not a caller
 * asking about something that might not exist, it is the store having changed
 * under an open transaction. That is a bug in this package rather than a
 * condition an adapter should teach its callers to handle, which is the same
 * standing `requireGlobalId` has in `record.view.ts`.
 *
 * Both stores raise it on the same condition — the memory adapter when the row
 * is not in the array, SQLite when `UPDATE … WHERE id = ?` matches nothing — so
 * the contract suite can assert the two behave alike rather than one throwing
 * and the other silently doing nothing.
 */
export class NoSuchDefinitionError extends Error {
  constructor(kind: 'label' | 'attribute', id: number) {
    super(`${kind} definition ${id} disappeared while it was being written to`)
    this.name = 'NoSuchDefinitionError'
  }
}
