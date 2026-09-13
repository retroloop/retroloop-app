/**
 * `@retro/core` — the domain, the use cases, and the memory store.
 *
 * Everything a driving adapter may touch is exported here and nowhere else:
 * imports across packages go through this barrel (repo-layout.md §Conventions),
 * while `#*` subpath imports stay inside the package.
 */

/* ── application: the boundary every adapter sees ─────────────────────────── */
export { type App, type AppDependencies, createApp } from '#application/app'
export { type Clock, timestamp } from '#application/ports/clock.port'
export type { IdGen } from '#application/ports/id-gen.port'
export type { Repositories, Store } from '#application/ports/store.port'
export {
  type DecisionInput,
  decisionInputSchema,
  parseDecisionInput,
} from '#application/schemas/decision-input.schema'
export {
  attributeTypeSchema,
  attributeValueSchema,
  definitionNameSchema,
  parseAttributeValue,
  parseDefinitionName,
} from '#application/schemas/definition-input.schema'
/* ── application: input schemas (the mechanical rules) ────────────────────── */
export {
  actorSchema,
  decisionStateSchema,
  decisionVerdictSchema,
  involvementSchema,
  noteKindSchema,
  partySchema,
  recordLifecycleStateSchema,
  recordSectionSchema,
  recordTypeSchema,
  relationDirectionSchema,
  retroDisplayStateSchema,
  ridSchema,
  severitySchema,
  solutionLevelInputSchema,
  solutionLevelSchema,
} from '#application/schemas/enums.schema'
export { parseOrThrow } from '#application/schemas/parse'
export {
  parseRecordLifecycleInput,
  type RecordLifecycleInput,
  recordLifecycleInputSchema,
  recordLifecycleStatusSchema,
} from '#application/schemas/record-lifecycle-input.schema'
export {
  parseRecordRelationInput,
  type RecordRelationInput,
  recordRelationInputSchema,
} from '#application/schemas/record-relation-input.schema'
export {
  type HumanWordsInput,
  humanWordsSchema,
  parseRevisionInput,
  proposedDefaultsSchema,
  type RecordInput,
  type RevisionInput,
  recordInputSchema,
  revisionInputSchema,
  rootCauseSchema,
  type SolutionInput,
  solutionSchema,
  solutionsSchema,
} from '#application/schemas/revision-input.schema'
export { nonEmptyTextSchema, optionalTextSchema } from '#application/schemas/text.schema'
export {
  type DefineAttributeInput,
  type DefineAttributeOutput,
  DefineAttributeUseCase,
} from '#application/use-cases/attributes/define-attribute.use-case'
export {
  type ListAttributesInput,
  type ListAttributesOutput,
  ListAttributesUseCase,
} from '#application/use-cases/attributes/list-attributes.use-case'
export {
  type RenameAttributeInput,
  type RenameAttributeOutput,
  RenameAttributeUseCase,
} from '#application/use-cases/attributes/rename-attribute.use-case'
export {
  type RetireAttributeInput,
  type RetireAttributeOutput,
  RetireAttributeUseCase,
} from '#application/use-cases/attributes/retire-attribute.use-case'
export {
  type SetAttributeValueInput,
  type SetAttributeValueOutput,
  SetAttributeValueUseCase,
} from '#application/use-cases/attributes/set-attribute-value.use-case'
export {
  type UnretireAttributeInput,
  type UnretireAttributeOutput,
  UnretireAttributeUseCase,
} from '#application/use-cases/attributes/unretire-attribute.use-case'
export {
  type RecordDecisionInput,
  type RecordDecisionOutput,
  RecordDecisionUseCase,
} from '#application/use-cases/decisions/record-decision.use-case'
/* ── application: use cases ───────────────────────────────────────────────── */
export {
  type ListEventsInput,
  type ListEventsOutput,
  ListEventsUseCase,
} from '#application/use-cases/events/list-events.use-case'
export {
  type ExportRetrospectiveInput,
  type ExportRetrospectiveOutput,
  ExportRetrospectiveUseCase,
} from '#application/use-cases/export/export-retrospective.use-case'
export {
  type ApplyLabelInput,
  type ApplyLabelOutput,
  ApplyLabelUseCase,
} from '#application/use-cases/labels/apply-label.use-case'
export {
  type DefineLabelInput,
  type DefineLabelOutput,
  DefineLabelUseCase,
} from '#application/use-cases/labels/define-label.use-case'
export {
  type ListLabelsInput,
  type ListLabelsOutput,
  ListLabelsUseCase,
} from '#application/use-cases/labels/list-labels.use-case'
export {
  type RenameLabelInput,
  type RenameLabelOutput,
  RenameLabelUseCase,
} from '#application/use-cases/labels/rename-label.use-case'
export {
  type RetireLabelInput,
  type RetireLabelOutput,
  RetireLabelUseCase,
} from '#application/use-cases/labels/retire-label.use-case'
export {
  type UnretireLabelInput,
  type UnretireLabelOutput,
  UnretireLabelUseCase,
} from '#application/use-cases/labels/unretire-label.use-case'
export {
  type AddAiNoteInput,
  type AddAiNoteOutput,
  AddAiNoteUseCase,
} from '#application/use-cases/notes/add-ai-note.use-case'
export {
  type AddHumanNoteInput,
  type AddHumanNoteOutput,
  AddHumanNoteUseCase,
} from '#application/use-cases/notes/add-human-note.use-case'
export {
  type AnnotateNoteInput,
  type AnnotateNoteOutput,
  AnnotateNoteUseCase,
} from '#application/use-cases/notes/annotate-note.use-case'
export {
  type ListNotesInput,
  type ListNotesOutput,
  ListNotesUseCase,
  type NoteView,
} from '#application/use-cases/notes/list-notes.use-case'
export {
  type ClaimRecordInput,
  type ClaimRecordOutput,
  ClaimRecordUseCase,
} from '#application/use-cases/records/claim-record.use-case'
export {
  type GetRecordInput,
  type GetRecordOutput,
  GetRecordUseCase,
} from '#application/use-cases/records/get-record.use-case'
export {
  type GetRecordByIdInput,
  type GetRecordByIdOutput,
  GetRecordByIdUseCase,
  type RecordTimelineEntry,
} from '#application/use-cases/records/get-record-by-id.use-case'
export {
  type GetRecordHistoryInput,
  type GetRecordHistoryOutput,
  GetRecordHistoryUseCase,
  type RecordAppearance,
} from '#application/use-cases/records/get-record-history.use-case'
export {
  type ListAllRecordsInput,
  type ListAllRecordsOutput,
  ListAllRecordsUseCase,
  type RecordListAllRow,
} from '#application/use-cases/records/list-all-records.use-case'
export {
  type LaneRecordRow,
  type ListLaneRecordsInput,
  type ListLaneRecordsOutput,
  ListLaneRecordsUseCase,
} from '#application/use-cases/records/list-lane-records.use-case'
export {
  type ListRecordsInput,
  type ListRecordsOutput,
  ListRecordsUseCase,
} from '#application/use-cases/records/list-records.use-case'
export { type MintedRecord, requireMinted } from '#application/use-cases/records/minted-record'
export {
  type RelateRecordsInput,
  type RelateRecordsOutput,
  RelateRecordsUseCase,
} from '#application/use-cases/records/relate-records.use-case'
export {
  type SetRecordLifecycleInput,
  type SetRecordLifecycleOutput,
  SetRecordLifecycleUseCase,
} from '#application/use-cases/records/set-record-lifecycle.use-case'
export {
  type ListRetrosInput,
  type ListRetrosOutput,
  ListRetrosUseCase,
  type RetroListCounts,
  type RetroListRow,
  type RetroListSession,
} from '#application/use-cases/retros/list-retros.use-case'
export {
  type CloseReviewInput,
  type CloseReviewOutput,
  CloseReviewUseCase,
} from '#application/use-cases/review/close-review.use-case'
export {
  type FinishReviewInput,
  type FinishReviewOutput,
  FinishReviewUseCase,
} from '#application/use-cases/review/finish-review.use-case'
export {
  type GetReviewStatusInput,
  type GetReviewStatusOutput,
  GetReviewStatusUseCase,
  type ReviewCounts,
} from '#application/use-cases/review/get-review-status.use-case'
export {
  type FinishedReviewRow,
  type ListFinishedReviewsInput,
  type ListFinishedReviewsOutput,
  ListFinishedReviewsUseCase,
} from '#application/use-cases/review/list-finished-reviews.use-case'
export {
  type CreateRevisionInput,
  type CreateRevisionOutput,
  CreateRevisionUseCase,
} from '#application/use-cases/revisions/create-revision.use-case'
export {
  type GetRevisionInput,
  type GetRevisionOutput,
  GetRevisionUseCase,
} from '#application/use-cases/revisions/get-revision.use-case'
export {
  type GetRevisionFeedbackInput,
  type GetRevisionFeedbackOutput,
  GetRevisionFeedbackUseCase,
  type RecordVerdict,
} from '#application/use-cases/revisions/get-revision-feedback.use-case'
export {
  type ListRevisionsInput,
  type ListRevisionsOutput,
  ListRevisionsUseCase,
} from '#application/use-cases/revisions/list-revisions.use-case'
export {
  type CreateSessionInput,
  type CreateSessionOutput,
  CreateSessionUseCase,
} from '#application/use-cases/sessions/create-session.use-case'
export {
  type GetSessionInput,
  type GetSessionOutput,
  GetSessionUseCase,
} from '#application/use-cases/sessions/get-session.use-case'
export {
  type ListSessionsInput,
  type ListSessionsOutput,
  ListSessionsUseCase,
} from '#application/use-cases/sessions/list-sessions.use-case'
export {
  type GetSettingsInput,
  type GetSettingsOutput,
  GetSettingsUseCase,
} from '#application/use-cases/settings/get-settings.use-case'
export {
  type SetAiConfigWriteInput,
  type SetAiConfigWriteOutput,
  SetAiConfigWriteUseCase,
} from '#application/use-cases/settings/set-ai-config-write.use-case'
export {
  type AddCommentInput,
  type AddCommentOutput,
  AddCommentUseCase,
  type CommentTarget,
} from '#application/use-cases/threads/add-comment.use-case'
export {
  type ListThreadsInput,
  type ListThreadsOutput,
  ListThreadsUseCase,
} from '#application/use-cases/threads/list-threads.use-case'
export {
  type ResolveThreadInput,
  type ResolveThreadOutput,
  ResolveThreadUseCase,
} from '#application/use-cases/threads/resolve-thread.use-case'
export {
  definitionsById,
  type RecordAttributeView,
  type RecordLabelView,
  resolveRecordAttributes,
  resolveRecordLabels,
} from '#application/views/definition.view'
/* ── application: read models ─────────────────────────────────────────────── */
export {
  type BuildExportInput,
  buildRetroExport,
  EXPORT_FORMAT,
  type ExportFinishMessage,
  type ExportHumanWords,
  type ExportMessage,
  type ExportRecord,
  type ExportRetrospective,
  type ExportSession,
  type ExportThread,
  type ExportThreadComponent,
  type RetroExport,
} from '#application/views/export.view'
export { type LaneSolutionView, laneFootprint, laneSolution } from '#application/views/lane.view'
export {
  buildRecordView,
  decisionsByRid,
  globalIdsByRid,
  type RecordView,
  type RecordViewWithLifecycle,
  type RecordViewWithRelations,
  requireGlobalId,
  withLifecycle,
  withRelations,
} from '#application/views/record.view'
export {
  type RecordRelationDetail,
  type RecordRelationView,
  recordIdsById,
  resolveRecordRelations,
} from '#application/views/relation.view'
export {
  finishedRoundsByRetro,
  type RetroDisplayState,
  retroDisplayState,
} from '#application/views/retro.view'
export { type RevisionMeta, toRevisionMeta } from '#application/views/revision.view'
export type { SessionView } from '#application/views/session.view'
export {
  buildThreadView,
  buildThreadViews,
  effectiveRevision,
  loadThreadViews,
  type RevisionStamp,
  type ThreadMessageView,
  type ThreadView,
} from '#application/views/thread.view'
/* ── domain: errors ───────────────────────────────────────────────────────── */
export { ConflictError } from '#domain/errors/conflict.error'
export { DomainError, type DomainErrorCode, isDomainError } from '#domain/errors/domain.error'
export { FinishGateError } from '#domain/errors/finish-gate.error'
export { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
export { NotFoundError } from '#domain/errors/not-found.error'
export { ValidationError, type ValidationIssue } from '#domain/errors/validation.error'
/* ── domain: events ───────────────────────────────────────────────────────── */
export {
  type DomainEvent,
  EVENT_NAMES,
  type EventData,
  type EventName,
  type EventScope,
  type NewDomainEvent,
  newDomainEvent,
  REVIEW_WAIT_EVENT_NAMES,
} from '#domain/events/domain-event.model'
/* ── domain: models ───────────────────────────────────────────────────────── */
export type { Actor } from '#domain/models/actor.model'
export type { Annotation, NewAnnotation } from '#domain/models/annotation.model'
export {
  ATTRIBUTE_TYPES,
  type AttributeDefinition,
  type AttributeType,
  type NewAttributeDefinition,
} from '#domain/models/attribute.model'
export type {
  Comment,
  CommentThread,
  NewComment,
  NewCommentThread,
} from '#domain/models/comment-thread.model'
export type { Decision, DecisionState, NewDecision } from '#domain/models/decision.model'
export type { FinishMessage, NewFinishMessage } from '#domain/models/finish-message.model'
/**
 * The hold rows a store already holds. Hold was removed as a feature in retro 4
 * `r-remove-hold`; no use case writes or reads one any more, and the model, the
 * repository and both adapters stay because human data is append-only and the
 * table is never dropped.
 */
export type { Hold, NewHold } from '#domain/models/hold.model'
export type { LabelDefinition, NewLabelDefinition } from '#domain/models/label.model'
export type { NewNote, Note, NoteKind } from '#domain/models/note.model'
export {
  type HumanWords,
  type Involvement,
  type LegacyNarrative,
  type LegacyProposedDefaults,
  type LegacyRecord,
  type Party,
  type ProposedDefaults,
  proposedLevel,
  proposedSolutionLevel,
  RECORD_SECTIONS,
  type RecordIdentity,
  type RecordNarrative,
  type RecordSection,
  type RecordType,
  type RetroRecord,
  type RootCause,
  recommendedSolution,
  type Severity,
  type Solution,
  type SolutionLevel,
  type SolutionLevelInput,
  type SolutionsNarrative,
  type SolutionsRecord,
} from '#domain/models/record.model'
export type {
  NewRecordAttributeValueEntry,
  RecordAttributeValueEntry,
} from '#domain/models/record-attribute-value.model'
export type { NewRecordClaimEntry, RecordClaimEntry } from '#domain/models/record-claim.model'
export type { NewRecordId, RecordId } from '#domain/models/record-id.model'
export type { NewRecordLabelEntry, RecordLabelEntry } from '#domain/models/record-label.model'
export {
  type NewRecordLifecycleEntry,
  RECORD_LIFECYCLE_STATES,
  RECORD_LIFECYCLE_STATUSES,
  type RecordLifecycleEntry,
  type RecordLifecycleState,
  type RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
export type {
  NewRecordRelationEntry,
  RecordRelationEntry,
} from '#domain/models/record-relation.model'
export type {
  NewRequest,
  NewRequestResponse,
  Request,
  RequestResponse,
  RequestState,
} from '#domain/models/request.model'
export {
  type NewRetrospective,
  RETROSPECTIVE_STATES,
  type Retrospective,
  type RetrospectiveState,
} from '#domain/models/retrospective.model'
export type { NewRevision, Revision } from '#domain/models/revision.model'
export type { NewSession, Session, SessionStatus } from '#domain/models/session.model'
export {
  AI_CONFIG_WRITE,
  type NewSettingEntry,
  SETTING_KEYS,
  SETTING_OFF,
  SETTING_ON,
  type SettingEntry,
  type SettingKey,
} from '#domain/models/setting.model'
export type {
  NewThreadResolution,
  ThreadResolution,
} from '#domain/models/thread-resolution.model'
/* ── domain: repository interfaces (implemented by every store adapter) ───── */
export type { AnnotationRepository } from '#domain/repositories/annotation.repository'
export type { AttributeDefinitionRepository } from '#domain/repositories/attribute-definition.repository'
export type {
  CommentThreadRepository,
  ThreadListFilter,
} from '#domain/repositories/comment-thread.repository'
export type { Cursor, CursorRepository } from '#domain/repositories/cursor.repository'
export type { DecisionRepository } from '#domain/repositories/decision.repository'
export type { EventListFilter, EventRepository } from '#domain/repositories/event.repository'
export type { FinishMessageRepository } from '#domain/repositories/finish-message.repository'
export type { HoldRepository } from '#domain/repositories/hold.repository'
export type { LabelDefinitionRepository } from '#domain/repositories/label-definition.repository'
export type { NoteListFilter, NoteRepository } from '#domain/repositories/note.repository'
export type { RecordAttributeValueRepository } from '#domain/repositories/record-attribute-value.repository'
export type { RecordClaimRepository } from '#domain/repositories/record-claim.repository'
export type { RecordIdRepository } from '#domain/repositories/record-id.repository'
export type { RecordLabelRepository } from '#domain/repositories/record-label.repository'
export type { RecordLifecycleRepository } from '#domain/repositories/record-lifecycle.repository'
export type { RecordRelationRepository } from '#domain/repositories/record-relation.repository'
export type { RequestListFilter, RequestRepository } from '#domain/repositories/request.repository'
export type { RetrospectiveRepository } from '#domain/repositories/retrospective.repository'
export type { RevisionRepository } from '#domain/repositories/revision.repository'
export type { SessionListFilter, SessionRepository } from '#domain/repositories/session.repository'
export type { SettingRepository } from '#domain/repositories/setting.repository'
export type { ThreadResolutionRepository } from '#domain/repositories/thread-resolution.repository'
/* ── domain: services ─────────────────────────────────────────────────────── */
export {
  AiConfigWriteDisabledError,
  aiConfigWriteEnabled,
  assertAiMayWriteDefinitions,
} from '#domain/services/config-write.service'
export {
  canonicalJson,
  changedSections,
  hashRecordContent,
  type JsonLike,
  recordContent,
  recordSectionContent,
} from '#domain/services/content-hash.service'
export {
  type AttributeRef,
  type Definition,
  definitionNamed,
  describeAttributeRef,
  describeLabelRef,
  isOfferable,
  type LabelRef,
  resolveAttribute,
  resolveLabel,
  sameName,
} from '#domain/services/definition.service'
export { refuseWhenFinished } from '#domain/services/finish-lock.service'
export {
  attributeEntriesByRecord,
  latestAttributeEntry,
  type SetAttributeValue,
  setAttributeValues,
} from '#domain/services/record-attribute.service'
export {
  claimsByRecord,
  type EffectiveClaim,
  effectiveClaim,
} from '#domain/services/record-claim.service'
export { recordKey } from '#domain/services/record-key.service'
export {
  appliedLabelIds,
  labelEntriesByRecord,
  latestLabelEntry,
} from '#domain/services/record-label.service'
export { LANE_STATES, type LaneState, laneState } from '#domain/services/record-lane.service'
export {
  bornLifecycleState,
  type EffectiveLifecycle,
  effectiveLifecycle,
  LIFECYCLE_ACT_FROM,
  LIFECYCLE_HUMAN_ONLY_ACTS,
  lifecycleActIsHumanOnly,
  lifecycleActPermitted,
  lifecycleByRecord,
  lifecycleKey,
} from '#domain/services/record-lifecycle.service'
export {
  latestRelationEntry,
  RELATION_DIRECTIONS,
  type RelationDirection,
  relationFrom,
  relationKey,
  relationsInForce,
} from '#domain/services/record-relation.service'
export {
  type EffectiveDecision,
  effectiveDecision,
  pendingRids,
  reviseRids,
} from '#domain/services/record-state.service'
export {
  deriveSessionStatus,
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
  resolveSession,
  type SessionRef,
} from '#domain/services/reference.service'
/* ── infrastructure: the memory store (the only mock in the system) ───────── */
export { createCounterIdGen } from '#infrastructure/memory/counter-id-gen.adapter'
export {
  createMemoryStore,
  type MemoryStoreOptions,
} from '#infrastructure/memory/memory-store.adapter'
/* ── infrastructure: the SQLite store and its migrations ──────────────────── */
export {
  checkedDb,
  execChecked,
  type MigrationDb,
} from '#infrastructure/sqlite/checked-exec'
export { LEDGER_TABLE, type LedgerRow, type Migration } from '#infrastructure/sqlite/migration'
export { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
export {
  ensureLedger,
  ledgerRows,
  type MigrateOptions,
  type MigrationRun,
  migrate,
  pendingMigrations,
  rollbackLastBatch,
} from '#infrastructure/sqlite/migrator'
export {
  BACKUPS_DIRNAME,
  DATABASE_FILENAME,
  DEFAULT_BUSY_TIMEOUT_MS,
  openSqliteStore,
  type SqliteStore,
  type SqliteStoreOptions,
} from '#infrastructure/sqlite/sqlite-store.adapter'
export { systemClock } from '#infrastructure/system/system-clock.adapter'
export { CORE_VERSION } from './version'
