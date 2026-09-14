import {
  type AttributeDefinition,
  type DomainEvent,
  type EffectiveClaim,
  type EffectiveDecision,
  type EffectiveLifecycle,
  type LabelDefinition,
  proposedLevel,
  type RecordAttributeView,
  type RecordLabelView,
  type RecordListAllRow,
  type RecordRelationDetail,
  type RecordRelationView,
  type RecordTimelineEntry,
  type RecordView,
  type RetroListRow,
  type ThreadView,
} from '@retro/core'
import type { z } from 'zod'
import type {
  attributeDefinitionSchema,
  decisionSchema,
  labelDefinitionSchema,
  recordAttributeSchema,
  recordClaimSchema,
  recordDetailSchema,
  recordLabelSchema,
  recordLifecycleSchema,
  recordListAllRowSchema,
  recordRelationRefSchema,
  recordRelationSchema,
  recordTimelineEntrySchema,
  retroListRowSchema,
  threadSchema,
  wireEventSchema,
} from '#trpc/views.schema'

/**
 * Domain → wire, in one place.
 *
 * Every one of these does the same small job: turn `undefined` into `null`.
 * JSON has no undefined, so a key that is merely absent forces the browser to
 * tell "not decided yet" apart from "the server forgot to send it". Doing the
 * conversion here — rather than at each call site — is what keeps that from being
 * remembered nine times.
 */
export function toWireThread(thread: ThreadView): z.infer<typeof threadSchema> {
  return {
    id: thread.id,
    rid: thread.rid ?? null,
    section: thread.section ?? null,
    openedAt: thread.openedAt,
    messages: thread.messages.map((message) => ({
      id: message.id,
      actor: message.actor,
      text: message.text,
      at: message.at,
      // The view's effective revision, stored or derived — the browser is never
      // handed the raw `revisionN` and its gap.
      revision: message.revision,
    })),
    resolved: thread.resolved,
  }
}

export function toWireDecision(decision: EffectiveDecision): z.infer<typeof decisionSchema> {
  return {
    state: decision.state,
    decidedOnRevision: decision.decidedOnRevision ?? null,
    carriedOver: decision.carriedOver,
    contentChangedSince: decision.contentChangedSince ?? null,
    severity: decision.severity,
    solutionLevel: decision.solutionLevel,
    selectedSolution: decision.selectedSolution ?? null,
    involvement: decision.involvement,
    reviewerNote: decision.reviewerNote ?? null,
  }
}

export function toWireRetroListRow(row: RetroListRow): z.infer<typeof retroListRowSchema> {
  return {
    retroId: row.retroId,
    retroNumber: row.retroNumber,
    title: row.title ?? null,
    state: row.state,
    counts: { pending: row.counts.pending, decided: row.counts.decided },
    session: { id: row.session.id, cwd: row.session.cwd, startedAt: row.session.startedAt },
  }
}

/**
 * A definition, as the settings page manages it — the one systematic conversion
 * this file exists for, on `retiredAt`: a definition nobody has retired has no
 * timestamp, and the wire says so with `null` rather than by dropping the key.
 */
export function toWireLabelDefinition(
  definition: LabelDefinition,
): z.infer<typeof labelDefinitionSchema> {
  return {
    id: definition.id,
    name: definition.name,
    retiredAt: definition.retiredAt ?? null,
    createdAt: definition.createdAt,
  }
}

export function toWireAttributeDefinition(
  definition: AttributeDefinition,
): z.infer<typeof attributeDefinitionSchema> {
  return {
    id: definition.id,
    name: definition.name,
    type: definition.type,
    retiredAt: definition.retiredAt ?? null,
    createdAt: definition.createdAt,
  }
}

/**
 * A label as a record wears it. Nothing is converted here — the read model has
 * already resolved the join and flattened the retirement to the boolean a
 * record's reader actually asks (`definition.view.ts`) — and the projection
 * exists anyway, for the reason `toWireLifecycle` copies its array: the domain
 * hands back readonly shapes and the wire's are plain, and a projection that
 * passed one through would let a caller mutate what the read model holds.
 */
export function toWireRecordLabel(label: RecordLabelView): z.infer<typeof recordLabelSchema> {
  return { id: label.id, name: label.name, retired: label.retired }
}

export function toWireRecordAttribute(
  attribute: RecordAttributeView,
): z.infer<typeof recordAttributeSchema> {
  return {
    id: attribute.id,
    name: attribute.name,
    type: attribute.type,
    value: attribute.value,
    retired: attribute.retired,
  }
}

/**
 * A relation as one of its two records sees it.
 *
 * The read model has already resolved which record is the *other* one and which
 * way the row points (`relation.view.ts`), so nothing is decided here — what
 * this drops is the `(retroId, rid)` pair, which the CLI's read-back carries and
 * a browser has no use for: a page follows `/records/:globalId`, which is the
 * whole reason the number exists.
 */
export function toWireRecordRelationRef(
  relation: RecordRelationView,
): z.infer<typeof recordRelationRefSchema> {
  return {
    globalId: relation.globalId,
    how: relation.how,
    direction: relation.direction,
    actor: relation.actor,
    at: relation.at,
  }
}

/** The same, with the name the record page puts on the link. */
export function toWireRecordRelation(
  relation: RecordRelationDetail,
): z.infer<typeof recordRelationSchema> {
  return { ...toWireRecordRelationRef(relation), title: relation.title }
}

/**
 * Who is holding a record, or `null` — this file's one job, on the key the
 * review UI draws the in-progress badge from.
 *
 * `undefined` means nobody, and it means it for two different histories: a record
 * nobody ever claimed, and one somebody claimed and gave back
 * (`record-claim.service.ts`). Both become the same `null` here, because that is
 * the question a badge asks — a wire that made the browser tell those two apart
 * would have every reader of this key writing the same `if`.
 *
 * The `version` on the row is dropped rather than renamed: nothing renders it,
 * and every field on this wire is a field the typed mock has to produce.
 */
export function toWireClaim(
  claim: EffectiveClaim | undefined,
): z.infer<typeof recordClaimSchema> | null {
  if (claim === undefined) return null
  return { claimedAt: claim.claimedAt, actor: claim.actor }
}

export function toWireLifecycle(
  lifecycle: EffectiveLifecycle,
): z.infer<typeof recordLifecycleSchema> {
  return {
    status: lifecycle.status,
    // Copied rather than passed through: the domain hands back a readonly array
    // and the wire shape is a plain one, and a projection that shared the array
    // would let a caller mutate what the read model holds.
    refs: [...lifecycle.refs],
    note: lifecycle.note ?? null,
    actor: lifecycle.actor ?? null,
    at: lifecycle.at ?? null,
  }
}

/**
 * A record, whole — the narrative as the AI authored it, the number it is known
 * by, and the verdict in effect against the draft on screen.
 *
 * **Two procedures answer with this shape and one function builds it.**
 * `records.get` is the review page's pane and `records.byId` is the record
 * page's body; a record is the same record on both, and it is rendered by the
 * same component in the browser. Two projections would be two chances for one
 * surface to start showing a field the other does not, which is a class of drift
 * the type system cannot see — both would still satisfy `recordDetailSchema`.
 *
 * `threads` is on the use case's answer and is deliberately not projected: every
 * comment is read from `threads.list` now (`views.schema.ts`
 * §recordDetailSchema), and the CLI is the reader that still wants them hanging
 * off the record.
 *
 * `labels` arrives as an argument rather than off `view`, because `RecordView`
 * is what six use cases build and only two of them read a record's labels — the
 * same reasoning that kept the lifecycle off it and put it on
 * `RecordViewWithLifecycle` instead (`record.view.ts`).
 */
export function toWireRecordDetail(
  retroId: number,
  view: RecordView,
  labels: readonly RecordLabelView[],
): z.infer<typeof recordDetailSchema> {
  const record = view.record
  return {
    retroId,
    revision: view.revisionN,
    // Off the view rather than out of the record: the number lives beside the
    // narrative, never in it (`record-id.model.ts`).
    globalId: view.globalId,
    record: {
      rid: record.rid,
      num: record.num,
      title: record.title,
      type: record.type,
      problem: record.problem,
      humanWords: record.humanWords.map((words) => ({
        verbatim: words.verbatim,
        cleaned: words.cleaned,
        context: words.context ?? null,
      })),
      rootCause: {
        whatHappened: record.rootCause.whatHappened,
        whys: [...record.rootCause.whys],
        root: record.rootCause.root,
      },
      diagnosticData: record.diagnosticData ?? null,
      workaround: record.workaround,
      agreedDirection: record.agreedDirection ?? null,
      footprint: record.footprint ?? null,
      solutions:
        record.solutions?.map((solution) => ({
          bullets: solution.bullets,
          footprint: solution.footprint,
          level: solution.level,
          recommended: solution.recommended,
        })) ?? null,
      requester: record.requester,
      impacts: record.impacts,
      proposed: {
        severity: record.defaults.severity,
        // The AI's ceiling: the field it authored on the old shape, the
        // recommended solution's level on the new one — one function, so the
        // wire cannot answer this differently from the CLI or the export.
        solutionLevel: proposedLevel(record),
        involvement: record.defaults.involvement,
      },
    },
    decision: toWireDecision(view.decision),
    // Beside the narrative rather than inside it, exactly as `globalId` is: the
    // record is the draft the AI submitted, and a label is something a human put
    // on it afterwards.
    labels: labels.map(toWireRecordLabel),
  }
}

/**
 * One line of the record page's timeline.
 *
 * The one systematic conversion this file exists for happens on two keys here —
 * a lifecycle entry's `note` becomes null when it has none — and one rename:
 * the domain says `revisionN` and every shape on this wire says `revision`
 * (`recordDetailSchema`, `messageSchema`), so the timeline is not the one place
 * a browser has to learn a second name for the same number.
 *
 * The `switch` is exhaustive over `kind` and TypeScript checks it, which is what
 * makes a fourth kind added in core a compile error here rather than a line the
 * page silently drops.
 */
export function toWireTimelineEntry(
  entry: RecordTimelineEntry,
): z.infer<typeof recordTimelineEntrySchema> {
  switch (entry.kind) {
    case 'created':
      return { kind: 'created', at: entry.at, revision: entry.revisionN, actor: entry.actor }
    case 'decision':
      return {
        kind: 'decision',
        at: entry.at,
        revision: entry.revisionN,
        state: entry.state,
        actor: entry.actor,
        version: entry.version,
      }
    case 'lifecycle':
      return {
        kind: 'lifecycle',
        at: entry.at,
        status: entry.status,
        actor: entry.actor,
        // Copied rather than passed through, for the reason `toWireLifecycle`
        // copies its own: the read model hands back a readonly array.
        refs: [...entry.refs],
        note: entry.note ?? null,
        version: entry.version,
      }
  }
}

export function toWireRecordListAllRow(
  row: RecordListAllRow,
): z.infer<typeof recordListAllRowSchema> {
  return {
    retroId: row.retroId,
    retroNumber: row.retroNumber,
    session: { id: row.session.id, cwd: row.session.cwd, startedAt: row.session.startedAt },
    rid: row.rid,
    globalId: row.globalId,
    num: row.num,
    title: row.title,
    type: row.type,
    requester: row.requester,
    state: row.state,
    severity: row.severity,
    proposedLevel: row.proposedLevel,
    lifecycle: toWireLifecycle(row.lifecycle),
    involvement: row.involvement,
    labels: row.labels.map(toWireRecordLabel),
  }
}

export function toWireEvent(event: DomainEvent): z.infer<typeof wireEventSchema> {
  return {
    id: event.id,
    name: event.name,
    at: event.at,
    retroId: event.retroId ?? null,
    revisionN: event.revisionN ?? null,
    rid: event.rid ?? null,
  }
}
