import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'
import type { Actor } from '#domain/models/actor.model'

/**
 * The mechanical half of actor separation (architecture.md §Actor model). It lives
 * in the use cases, below every adapter, so no driver can route around it — and
 * SQLite triggers back it up at L1 for human-authored tables (item 3).
 */
export class ForbiddenActorError extends DomainError {
  override readonly code: DomainErrorCode = 'FORBIDDEN_ACTOR'

  constructor(
    readonly required: Actor,
    readonly actual: Actor,
    readonly action: string,
  ) {
    super(`${action} is written by the ${required} actor; ${actual} may not perform it`)
  }

  /** Guard at the top of every mutating use case whose author the model fixes. */
  static assert(required: Actor, actual: Actor, action: string): void {
    if (actual !== required) throw new ForbiddenActorError(required, actual, action)
  }
}
