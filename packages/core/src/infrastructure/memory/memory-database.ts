import type { IdGen } from '#application/ports/id-gen.port'
import type { DomainEvent } from '#domain/events/domain-event.model'
import type { Annotation } from '#domain/models/annotation.model'
import type { AttributeDefinition } from '#domain/models/attribute.model'
import type { CommentThread } from '#domain/models/comment-thread.model'
import type { Decision } from '#domain/models/decision.model'
import type { FinishMessage } from '#domain/models/finish-message.model'
import type { Hold } from '#domain/models/hold.model'
import type { LabelDefinition } from '#domain/models/label.model'
import type { Note } from '#domain/models/note.model'
import type { RecordAttributeValueEntry } from '#domain/models/record-attribute-value.model'
import type { RecordId } from '#domain/models/record-id.model'
import type { RecordLabelEntry } from '#domain/models/record-label.model'
import type { RecordLifecycleEntry } from '#domain/models/record-lifecycle.model'
import type { RecordRelationEntry } from '#domain/models/record-relation.model'
import type { Request } from '#domain/models/request.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import type { Revision } from '#domain/models/revision.model'
import type { Session } from '#domain/models/session.model'
import type { SettingEntry } from '#domain/models/setting.model'
import type { ThreadResolution } from '#domain/models/thread-resolution.model'
import type { Cursor } from '#domain/repositories/cursor.repository'

/** One table per repository, in insertion order. */
export type MemoryTables = {
  sessions: Session[]
  retrospectives: Retrospective[]
  revisions: Revision[]
  recordIds: RecordId[]
  decisions: Decision[]
  finishMessages: FinishMessage[]
  holds: Hold[]
  recordLifecycle: RecordLifecycleEntry[]
  /**
   * The two vocabularies, and what records wear from them. The definitions are
   * the one mutable pair in this store — `rename` and `retire` really write over
   * a row here, as they do in SQLite — while the two application tables beside
   * them are append-only like every other human field
   * (`label-definition.repository.ts`).
   */
  labelDefinitions: LabelDefinition[]
  attributeDefinitions: AttributeDefinition[]
  recordLabels: RecordLabelEntry[]
  recordAttributeValues: RecordAttributeValueEntry[]
  /**
   * Which records somebody said belong together, and how — the one table here
   * keyed on global ids rather than on `(retroId, rid)`, because a relation
   * names two records and may name them across two retrospectives
   * (`record-relation.model.ts`).
   */
  recordRelations: RecordRelationEntry[]
  /** The global settings, versioned — one key today, and it is a guarantee. */
  settings: SettingEntry[]
  notes: Note[]
  annotations: Annotation[]
  threads: CommentThread[]
  threadResolutions: ThreadResolution[]
  requests: Request[]
  events: DomainEvent[]
  cursors: Cursor[]
}

function emptyTables(): MemoryTables {
  return {
    sessions: [],
    retrospectives: [],
    revisions: [],
    recordIds: [],
    decisions: [],
    finishMessages: [],
    holds: [],
    recordLifecycle: [],
    // Empty, like every table here — and for these two that emptiness is the
    // product's own rule rather than the fixture's: *"we will not hardcode any
    // labels or attributes"* (`label.model.ts`).
    labelDefinitions: [],
    attributeDefinitions: [],
    recordLabels: [],
    recordAttributeValues: [],
    recordRelations: [],
    settings: [],
    notes: [],
    annotations: [],
    threads: [],
    threadResolutions: [],
    requests: [],
    events: [],
    cursors: [],
  }
}

/**
 * Rows cross the repository boundary by value, never by reference — the same way
 * a SQLite row does. A caller that mutates what it read changes nothing, and a
 * rolled-back unit of work cannot leak through a reference someone kept.
 */
export function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * The memory adapter's storage: one array per table, one integer sequence, and a unit of
 * work that really rolls back.
 *
 * `tx` is serialized (one at a time) and snapshot-restoring, so the memory store
 * keeps the promise SQLite keeps with `BEGIN IMMEDIATE`: either every write of a
 * use case lands — its domain event included — or none of it does. A memory suite
 * that passes therefore means the same thing as the SQLite suite that follows it
 * (testing.md suite 1).
 */
export class MemoryDatabase {
  tables: MemoryTables = emptyTables()

  private queue: Promise<unknown> = Promise.resolve()
  private depth = 0

  constructor(private readonly idGen: IdGen) {}

  nextId(): number {
    return this.idGen.next()
  }

  /**
   * Runs `work` as one unit of work. Re-entrant: a nested call joins the unit of
   * work already in progress rather than deadlocking on the queue behind itself.
   */
  async tx<T>(work: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return work()

    const run = this.queue.then(async () => {
      const snapshot = clone(this.tables)
      this.depth += 1
      try {
        return await work()
      } catch (error) {
        this.tables = snapshot
        throw error
      } finally {
        this.depth -= 1
      }
    })
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
