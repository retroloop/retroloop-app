import type { Clock } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { DefineAttributeUseCase } from '#application/use-cases/attributes/define-attribute.use-case'
import { ListAttributesUseCase } from '#application/use-cases/attributes/list-attributes.use-case'
import { RenameAttributeUseCase } from '#application/use-cases/attributes/rename-attribute.use-case'
import { RetireAttributeUseCase } from '#application/use-cases/attributes/retire-attribute.use-case'
import { SetAttributeValueUseCase } from '#application/use-cases/attributes/set-attribute-value.use-case'
import { UnretireAttributeUseCase } from '#application/use-cases/attributes/unretire-attribute.use-case'
import { RecordDecisionUseCase } from '#application/use-cases/decisions/record-decision.use-case'
import { ListEventsUseCase } from '#application/use-cases/events/list-events.use-case'
import { ExportRetrospectiveUseCase } from '#application/use-cases/export/export-retrospective.use-case'
import { ApplyLabelUseCase } from '#application/use-cases/labels/apply-label.use-case'
import { DefineLabelUseCase } from '#application/use-cases/labels/define-label.use-case'
import { ListLabelsUseCase } from '#application/use-cases/labels/list-labels.use-case'
import { RenameLabelUseCase } from '#application/use-cases/labels/rename-label.use-case'
import { RetireLabelUseCase } from '#application/use-cases/labels/retire-label.use-case'
import { UnretireLabelUseCase } from '#application/use-cases/labels/unretire-label.use-case'
import { AddAiNoteUseCase } from '#application/use-cases/notes/add-ai-note.use-case'
import { AddHumanNoteUseCase } from '#application/use-cases/notes/add-human-note.use-case'
import { AnnotateNoteUseCase } from '#application/use-cases/notes/annotate-note.use-case'
import { ListNotesUseCase } from '#application/use-cases/notes/list-notes.use-case'
import { ClaimRecordUseCase } from '#application/use-cases/records/claim-record.use-case'
import { GetRecordUseCase } from '#application/use-cases/records/get-record.use-case'
import { GetRecordByIdUseCase } from '#application/use-cases/records/get-record-by-id.use-case'
import { GetRecordHistoryUseCase } from '#application/use-cases/records/get-record-history.use-case'
import { ListAllRecordsUseCase } from '#application/use-cases/records/list-all-records.use-case'
import { ListLaneRecordsUseCase } from '#application/use-cases/records/list-lane-records.use-case'
import { ListRecordsUseCase } from '#application/use-cases/records/list-records.use-case'
import { RelateRecordsUseCase } from '#application/use-cases/records/relate-records.use-case'
import { SetRecordLifecycleUseCase } from '#application/use-cases/records/set-record-lifecycle.use-case'
import { ListRetrosUseCase } from '#application/use-cases/retros/list-retros.use-case'
import { CloseReviewUseCase } from '#application/use-cases/review/close-review.use-case'
import { FinishReviewUseCase } from '#application/use-cases/review/finish-review.use-case'
import { GetReviewStatusUseCase } from '#application/use-cases/review/get-review-status.use-case'
import { ListFinishedReviewsUseCase } from '#application/use-cases/review/list-finished-reviews.use-case'
import { CreateRevisionUseCase } from '#application/use-cases/revisions/create-revision.use-case'
import { GetRevisionUseCase } from '#application/use-cases/revisions/get-revision.use-case'
import { GetRevisionFeedbackUseCase } from '#application/use-cases/revisions/get-revision-feedback.use-case'
import { ListRevisionsUseCase } from '#application/use-cases/revisions/list-revisions.use-case'
import { CreateSessionUseCase } from '#application/use-cases/sessions/create-session.use-case'
import { GetSessionUseCase } from '#application/use-cases/sessions/get-session.use-case'
import { ListSessionsUseCase } from '#application/use-cases/sessions/list-sessions.use-case'
import { GetSettingsUseCase } from '#application/use-cases/settings/get-settings.use-case'
import { SetAiConfigWriteUseCase } from '#application/use-cases/settings/set-ai-config-write.use-case'
import { AddCommentUseCase } from '#application/use-cases/threads/add-comment.use-case'
import { ListThreadsUseCase } from '#application/use-cases/threads/list-threads.use-case'
import { ResolveThreadUseCase } from '#application/use-cases/threads/resolve-thread.use-case'
import { systemClock } from '#infrastructure/system/system-clock.adapter'

export type AppDependencies = {
  /** Defaults to the system clock; suites pass a frozen one. */
  readonly clock?: Clock
}

/**
 * The use-case layer, assembled — **the only boundary any driving adapter
 * sees**. The tRPC routers and the CLI commands both hold one of these and
 * know nothing below it, which is what keeps the actor rules and the invariants
 * true for every adapter, present and future.
 *
 * There is no DI container: both composition roots (`serve()` and the CLI's
 * `main.ts`) construct explicitly, `createApp(openStore())`.
 */
export type App = ReturnType<typeof createApp>

export function createApp(store: Store, dependencies: AppDependencies = {}) {
  const clock = dependencies.clock ?? systemClock

  return {
    store,
    sessions: {
      create: new CreateSessionUseCase(store, clock),
      get: new GetSessionUseCase(store),
      list: new ListSessionsUseCase(store),
    },
    retros: {
      list: new ListRetrosUseCase(store),
    },
    notes: {
      addAi: new AddAiNoteUseCase(store, clock),
      addHuman: new AddHumanNoteUseCase(store, clock),
      annotate: new AnnotateNoteUseCase(store, clock),
      list: new ListNotesUseCase(store),
    },
    revisions: {
      create: new CreateRevisionUseCase(store, clock),
      get: new GetRevisionUseCase(store),
      feedback: new GetRevisionFeedbackUseCase(store),
      list: new ListRevisionsUseCase(store),
    },
    records: {
      list: new ListRecordsUseCase(store),
      /** Every record of every retrospective, flat — the records page's whole read model. */
      listAll: new ListAllRecordsUseCase(store),
      get: new GetRecordUseCase(store),
      /**
       * One record reached by the number a human reads off the page — the
       * record page's whole read model (`/records/:id`). It is the only record
       * read addressed by the global id rather than by `(retroId, rid)`, and
       * the only one that carries the record's timeline.
       */
      byId: new GetRecordByIdUseCase(store),
      history: new GetRecordHistoryUseCase(store),
      /**
       * Resolve or reopen, after the review that filed the record has closed.
       * **The one mutating use case open to both actors besides
       * `threads.addComment`**: the AI marks what it fixed, the human marks
       * from the browser, and the row records which.
       */
      setLifecycle: new SetRecordLifecycleUseCase(store, clock),
      /**
       * Two records said to belong together, in the words of whoever relates
       * them — or the relation taken off. **The second mutating use case open
       * to both actors on every act**: the AI relates the record it just filed
       * to the one it is a repeat of, the human relates two they can see, and
       * the row records which. It is also the fourth write the finish lock
       * deliberately does not guard, because relating a closed retrospective's
       * record to a new one is the feature rather than an edge of it.
       */
      relate: new RelateRecordsUseCase(store, clock),
      /**
       * A record picked up, or given back — the in-progress marker the solving
       * lane works out of (`record-claim.model.ts`). **The third mutating use
       * case open to both actors on every act**, and the only one of the three
       * with no procedure over it: the claim is written by whoever does the
       * work, and the review UI reads it as a badge off the read models rather
       * than writing one.
       */
      claim: new ClaimRecordUseCase(store, clock),
      /**
       * The queue, the cross-retrospective listing and the record-with-its-fix
       * read — one read model behind all of them (`list-lane-records.use-case.ts`).
       *
       * It is the lane's whole read surface, and it is one use case rather than
       * four because the four are the same row asked for with different filters:
       * two that drifted would mean `record get` and `record queue` disagreeing
       * about the record an agent is holding open in two terminals.
       */
      lane: new ListLaneRecordsUseCase(store),
    },
    decisions: {
      record: new RecordDecisionUseCase(store, clock),
    },
    /**
     * The two vocabularies in scope. No labels or attributes are hardcoded:
     * adding one is a settings-page act, because each label or attribute is a
     * global thing.
     *
     * **Pure and independent**, which is why they are two groups rather than
     * one `definitions`: labels classify, attributes carry data, and
     * composition is the *user's* convention, never a system mechanism. Nothing
     * on either side reads the other.
     *
     * The four definition acts take **either actor**, and the AI's half is
     * gated by the settings toggle at the store boundary
     * (`config-write.service.ts`). **`unretire` is the fourth**
     * (`r-retire-burns-a-word`): retire was one press with no way back, and
     * pairing it with an inverse makes a mis-press a two-press round trip
     * rather than a burned word. `apply` and `set` are **human-only for now**
     * whatever the toggle says — the toggle governs the config, and whether
     * the AI may mark up its own draft records is still open.
     */
    labels: {
      define: new DefineLabelUseCase(store, clock),
      rename: new RenameLabelUseCase(store, clock),
      retire: new RetireLabelUseCase(store, clock),
      /** Retire's inverse, and the reason retire is no longer a one-way press. */
      unretire: new UnretireLabelUseCase(store, clock),
      list: new ListLabelsUseCase(store),
      /** A label on a record, or off it. Human-only, and it outlives the review's close. */
      apply: new ApplyLabelUseCase(store, clock),
    },
    attributes: {
      define: new DefineAttributeUseCase(store, clock),
      rename: new RenameAttributeUseCase(store, clock),
      retire: new RetireAttributeUseCase(store, clock),
      unretire: new UnretireAttributeUseCase(store, clock),
      list: new ListAttributesUseCase(store),
      /** A value on a record, or cleared. Human-only; light validation per type. */
      set: new SetAttributeValueUseCase(store, clock),
    },
    /**
     * The global settings — one key, and it carries a guarantee: while it is
     * disabled, the user can be certain that the AI cannot change the
     * vocabularies.
     *
     * `get` is open to both actors, because reading a permission is not
     * exercising it and an agent that can see the switch is off can say so.
     * `setAiConfigWrite` refuses the AI **forever, whatever the switch currently
     * says** — a permission switch its own subject can flip is not one.
     */
    settings: {
      get: new GetSettingsUseCase(store),
      setAiConfigWrite: new SetAiConfigWriteUseCase(store, clock),
    },
    /**
     * The one channel for an ask (`r-remove-requests`). Requests were a second
     * one and they were removed: comments at the review level carry the same
     * weight, so there are no request use cases here to reach for, and no read
     * path either. The table and its rows stay in the store, the way the
     * `holds` table does.
     */
    threads: {
      addComment: new AddCommentUseCase(store, clock),
      list: new ListThreadsUseCase(store),
      /**
       * Human-only, and the one act on a thread that is not a message
       * (`r-resolvable-comments`). The AI answers a thread; the human is the
       * only one who says it is dealt with.
       */
      resolve: new ResolveThreadUseCase(store, clock),
    },
    review: {
      status: new GetReviewStatusUseCase(store),
      /**
       * Every round the human has already put down, across the whole stage —
       * for the agent that was not watching when the button was pressed.
       * `status` answers about one retrospective and `wait` only about a finish
       * that lands while it blocks; this is the catch-up read, addressed to
       * nothing.
       */
      listFinished: new ListFinishedReviewsUseCase(store),
      finish: new FinishReviewUseCase(store, clock),
      /**
       * The AI's half of the loop, and the only act on this list it may take:
       * the human's Finish closes the human side of the round
       * (`r-one-finish-button`), and this is what turns "nothing left to
       * address" into a finished retrospective, once, explicitly, with an event.
       */
      close: new CloseReviewUseCase(store, clock),
    },
    events: {
      list: new ListEventsUseCase(store),
    },
    exports: {
      retrospective: new ExportRetrospectiveUseCase(store, clock),
    },
  }
}
