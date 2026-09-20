import type { AnnotationRepository } from '#domain/repositories/annotation.repository'
import type { AttributeDefinitionRepository } from '#domain/repositories/attribute-definition.repository'
import type { CommentThreadRepository } from '#domain/repositories/comment-thread.repository'
import type { CursorRepository } from '#domain/repositories/cursor.repository'
import type { DecisionRepository } from '#domain/repositories/decision.repository'
import type { EventRepository } from '#domain/repositories/event.repository'
import type { FinishMessageRepository } from '#domain/repositories/finish-message.repository'
import type { HoldRepository } from '#domain/repositories/hold.repository'
import type { LabelDefinitionRepository } from '#domain/repositories/label-definition.repository'
import type { NoteRepository } from '#domain/repositories/note.repository'
import type { RecordAttributeValueRepository } from '#domain/repositories/record-attribute-value.repository'
import type { RecordClaimRepository } from '#domain/repositories/record-claim.repository'
import type { RecordIdRepository } from '#domain/repositories/record-id.repository'
import type { RecordLabelRepository } from '#domain/repositories/record-label.repository'
import type { RecordLifecycleRepository } from '#domain/repositories/record-lifecycle.repository'
import type { RecordRelationRepository } from '#domain/repositories/record-relation.repository'
import type { RequestRepository } from '#domain/repositories/request.repository'
import type { RetrospectiveRepository } from '#domain/repositories/retrospective.repository'
import type { RevisionRepository } from '#domain/repositories/revision.repository'
import type { SessionRepository } from '#domain/repositories/session.repository'
import type { SettingRepository } from '#domain/repositories/setting.repository'
import type { ThreadResolutionRepository } from '#domain/repositories/thread-resolution.repository'

/** Every repository, together. Reads take them from the store; writes take them from `tx`. */
export type Repositories = {
  readonly sessions: SessionRepository
  readonly retrospectives: RetrospectiveRepository
  readonly revisions: RevisionRepository
  /**
   * The one number a record is known by across the whole ledger — minted the
   * first time a rid appears in a retrospective, and kept **outside** the
   * revision blob so a stored draft stays byte for byte the draft that was
   * submitted (`record-id.model.ts`).
   */
  readonly recordIds: RecordIdRepository
  readonly decisions: DecisionRepository
  /**
   * The word the human left on a round on finishing it — one per
   * `(retroId, revisionN)`, versioned, never edited (`r-finish-confirm-message`).
   */
  readonly finishMessages: FinishMessageRepository
  /**
   * The hold rows a store already carries. Hold was a lifecycle flag beside the
   * verdict for a time (`r-hold-semantics`) and `r-remove-hold` took the feature
   * away again; no use case reads or writes one now. The repository
   * stays for the reason `requests` does — human data is append-only, the table
   * is never dropped, and append-only is a property of this layer rather than of
   * whoever happens to call it.
   */
  readonly holds: HoldRepository
  /**
   * What happened to a record after the review closed — resolved, reopened, with
   * the commits or issues it cites. The one append-only table **both** actors
   * write: the AI resolves what it fixed, the human resolves from the browser.
   */
  readonly recordLifecycle: RecordLifecycleRepository
  /**
   * The label vocabulary — global, user-created, and empty until somebody
   * creates one: no labels or attributes are hardcoded. It and the
   * attribute vocabulary beside it are the **only two mutable repositories in
   * this store**: a definition is configuration rather than human data, so a
   * rename really writes over the row (`label-definition.repository.ts`).
   */
  readonly labelDefinitions: LabelDefinitionRepository
  readonly attributeDefinitions: AttributeDefinitionRepository
  /**
   * What records wear from those two vocabularies — human data, and therefore
   * append-only like every other human field: taking a label off and clearing a
   * value are both rows saying so.
   */
  readonly recordLabels: RecordLabelRepository
  readonly recordAttributeValues: RecordAttributeValueRepository
  /**
   * Which records belong together, and how: both actors can relate records,
   * each relation carries how-they-relate words, and the relation reads from
   * both sides. The **second** append-only table both
   * actors write, and the only one in this store addressed by global id rather
   * than by `(retroId, rid)`: a relation names two records, and the pair that
   * identifies one of them is not a foreign key anything can hold twice
   * (`record-relation.model.ts`).
   */
  readonly recordRelations: RecordRelationRepository
  /**
   * Who is holding which record right now — the in-progress marker the solving
   * lane picks work up with. The **third** append-only table both actors write,
   * and the one that is not a fact about the record's outcome: it is true for an
   * afternoon and then it is not, which is exactly why it is a table beside the
   * lifecycle rather than a fourth position on it (`record-claim.model.ts`).
   */
  readonly recordClaims: RecordClaimRepository
  /**
   * The global settings, versioned — one key today, and it is the guarantee
   * that the AI cannot write the config while the user has it switched off
   * (`setting.model.ts`, `config-write.service.ts`).
   */
  readonly settings: SettingRepository
  readonly notes: NoteRepository
  readonly annotations: AnnotationRepository
  readonly threads: CommentThreadRepository
  /** Whether the human has marked a thread dealt with — versioned, never edited. */
  readonly threadResolutions: ThreadResolutionRepository
  readonly requests: RequestRepository
  readonly events: EventRepository
  /** Where each named consumer of the outbox has read up to (realtime.md). */
  readonly cursors: CursorRepository
}

/**
 * The storage port (L1 boundary). One `tx` call is one unit of work — `BEGIN
 * IMMEDIATE` in SQLite, snapshot-and-restore in memory. Every mutating
 * use case does its writes *and* appends its domain event inside a single `tx`,
 * which is what makes the outbox trustworthy: an event exists if and only if the
 * write it describes committed.
 */
export type Store = Repositories & {
  tx<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>
  close(): Promise<void>
}
