import type { IdGen } from '#application/ports/id-gen.port'
import type { Repositories, Store } from '#application/ports/store.port'
import { MemoryAnnotationRepository } from '#infrastructure/memory/annotation.memory.adapter'
import { MemoryAttributeDefinitionRepository } from '#infrastructure/memory/attribute-definition.memory.adapter'
import { MemoryCommentThreadRepository } from '#infrastructure/memory/comment-thread.memory.adapter'
import { createCounterIdGen } from '#infrastructure/memory/counter-id-gen.adapter'
import { MemoryCursorRepository } from '#infrastructure/memory/cursor.memory.adapter'
import { MemoryDecisionRepository } from '#infrastructure/memory/decision.memory.adapter'
import { MemoryEventRepository } from '#infrastructure/memory/event.memory.adapter'
import { MemoryFinishMessageRepository } from '#infrastructure/memory/finish-message.memory.adapter'
import { MemoryHoldRepository } from '#infrastructure/memory/hold.memory.adapter'
import { MemoryLabelDefinitionRepository } from '#infrastructure/memory/label-definition.memory.adapter'
import { MemoryDatabase } from '#infrastructure/memory/memory-database'
import { MemoryNoteRepository } from '#infrastructure/memory/note.memory.adapter'
import { MemoryRecordAttributeValueRepository } from '#infrastructure/memory/record-attribute-value.memory.adapter'
import { MemoryRecordClaimRepository } from '#infrastructure/memory/record-claim.memory.adapter'
import { MemoryRecordIdRepository } from '#infrastructure/memory/record-id.memory.adapter'
import { MemoryRecordLabelRepository } from '#infrastructure/memory/record-label.memory.adapter'
import { MemoryRecordLifecycleRepository } from '#infrastructure/memory/record-lifecycle.memory.adapter'
import { MemoryRecordRelationRepository } from '#infrastructure/memory/record-relation.memory.adapter'
import { MemoryRequestRepository } from '#infrastructure/memory/request.memory.adapter'
import { MemoryRetrospectiveRepository } from '#infrastructure/memory/retrospective.memory.adapter'
import { MemoryRevisionRepository } from '#infrastructure/memory/revision.memory.adapter'
import { MemorySessionRepository } from '#infrastructure/memory/session.memory.adapter'
import { MemorySettingRepository } from '#infrastructure/memory/setting.memory.adapter'
import { MemoryThreadResolutionRepository } from '#infrastructure/memory/thread-resolution.memory.adapter'

export type MemoryStoreOptions = {
  /** Defaults to a 1, 2, 3… counter; inject one to control the ids a suite asserts on. */
  readonly idGen?: IdGen
}

/**
 * The only mock in the system (architecture.md L1). It exists so suites 2–4 can
 * run the real domain and application layers against honest storage without a
 * file on disk — and so the repository contract suites have a reference
 * implementation to hold the SQLite adapters against (testing.md suite 1).
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): Store {
  const database = new MemoryDatabase(options.idGen ?? createCounterIdGen())

  const repositories: Repositories = {
    sessions: new MemorySessionRepository(database),
    retrospectives: new MemoryRetrospectiveRepository(database),
    revisions: new MemoryRevisionRepository(database),
    recordIds: new MemoryRecordIdRepository(database),
    decisions: new MemoryDecisionRepository(database),
    finishMessages: new MemoryFinishMessageRepository(database),
    holds: new MemoryHoldRepository(database),
    recordLifecycle: new MemoryRecordLifecycleRepository(database),
    labelDefinitions: new MemoryLabelDefinitionRepository(database),
    attributeDefinitions: new MemoryAttributeDefinitionRepository(database),
    recordLabels: new MemoryRecordLabelRepository(database),
    recordAttributeValues: new MemoryRecordAttributeValueRepository(database),
    recordRelations: new MemoryRecordRelationRepository(database),
    recordClaims: new MemoryRecordClaimRepository(database),
    settings: new MemorySettingRepository(database),
    notes: new MemoryNoteRepository(database),
    annotations: new MemoryAnnotationRepository(database),
    threads: new MemoryCommentThreadRepository(database),
    threadResolutions: new MemoryThreadResolutionRepository(database),
    requests: new MemoryRequestRepository(database),
    events: new MemoryEventRepository(database),
    cursors: new MemoryCursorRepository(database),
  }

  return {
    ...repositories,
    tx: (work) => database.tx(() => work(repositories)),
    close: async () => undefined,
  }
}
