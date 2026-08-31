import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'

/**
 * The write cannot be applied to the state the caller assumed: a stale
 * `--expect-revision`, a second annotation on an already-annotated note, closing
 * an already-closed request, finishing a finished retrospective.
 *
 * The message is all it carries, so it adds no constructor: the one it inherits
 * is the whole of it (`r-lint-never-silent`).
 */
export class ConflictError extends DomainError {
  override readonly code: DomainErrorCode = 'CONFLICT'
}
