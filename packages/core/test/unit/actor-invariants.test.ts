import { beforeEach, describe, expect, test } from 'bun:test'
import type { Repositories } from '#application/ports/store.port'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import type { Actor } from '#domain/models/actor.model'
import { aRevisionInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'

/**
 * The actor invariants, swept (CLAUDE.md §Non-negotiables; architecture.md
 * §Actor model).
 *
 * Every mutating use case appears here exactly once, and every one of them is
 * called with the wrong actor. The rule is not "the CLI does not offer approve"
 * — it is that the core refuses, below every adapter, so a future driver cannot
 * route around it.
 */
type Context = {
  readonly sessionId: number
  readonly retroId: number
  readonly rid: string
  readonly noteId: number
  readonly threadId: number
}

type Invariant = {
  readonly name: string
  /** The actor the model says writes this. */
  readonly owner: Actor
  readonly call: (harness: Harness, context: Context, actor: Actor) => Promise<unknown>
}

const INVARIANTS: readonly Invariant[] = [
  {
    name: 'session create',
    owner: 'ai',
    call: (harness, _context, actor) =>
      harness.app.sessions.create.execute({
        actor,
        claudeSession: 'uuid-new',
        project: 'retro',
        cwd: '/tmp',
      }),
  },
  {
    name: 'note add (AI)',
    owner: 'ai',
    call: (harness, context, actor) =>
      harness.app.notes.addAi.execute({ actor, session: context.sessionId, text: 'a friction' }),
  },
  {
    name: 'revision create',
    owner: 'ai',
    call: (harness, context, actor) =>
      harness.app.revisions.create.execute({
        actor,
        session: context.sessionId,
        revision: aRevisionInput(),
      }),
  },
  {
    name: 'note add (human)',
    owner: 'human',
    call: (harness, context, actor) =>
      harness.app.notes.addHuman.execute({ actor, session: context.sessionId, text: 'my note' }),
  },
  {
    name: 'note annotate',
    owner: 'human',
    call: (harness, context, actor) =>
      harness.app.notes.annotate.execute({ actor, noteId: context.noteId, text: 'my remark' }),
  },
  {
    name: 'decision record',
    owner: 'human',
    call: (harness, context, actor) =>
      harness.app.decisions.record.execute({
        actor,
        retro: { retroId: context.retroId },
        rid: context.rid,
        decision: { state: 'approved' },
      }),
  },
  /**
   * The human's verdict on a *conversation* (`r-resolvable-comments`). The AI
   * may answer a thread — comments are the one write both actors make — and
   * it may never declare one dealt with: only the human may mark a comment
   * resolved, never the AI.
   */
  {
    name: 'thread resolve',
    owner: 'human',
    call: (harness, context, actor) =>
      harness.app.threads.resolve.execute({ actor, threadId: context.threadId, resolved: true }),
  },
  {
    name: 'review finish',
    owner: 'human',
    call: (harness, context, actor) =>
      harness.app.review.finish.execute({ actor, retro: { retroId: context.retroId } }),
  },
  /**
   * The one write on this list the *AI* owns and the human may not make (retro
   * 4 `r-one-finish-button`): closing the review to export. It refuses the
   * human's actor before it looks at anything else, which is what makes the
   * browser — whose context is unconditionally `human` — unable to reach it
   * even if a procedure were added by mistake.
   */
  {
    name: 'review close',
    owner: 'ai',
    call: (harness, context, actor) =>
      harness.app.review.close.execute({ actor, retro: { retroId: context.retroId } }),
  },
]

const other = (actor: Actor): Actor => (actor === 'ai' ? 'human' : 'ai')

describe('actor invariants', () => {
  let harness: Harness
  let context: Context

  beforeEach(async () => {
    harness = createHarness()
    const session = await harness.session()
    const created = await harness.revision(session.id)
    const rid = created.revision.records[0]?.rid ?? ''
    const { note } = await harness.app.notes.addAi.execute({
      actor: 'ai',
      session: session.id,
      text: 'a friction',
    })
    const { thread } = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: created.retroId },
      target: { kind: 'review' },
      text: 'a review-level remark',
    })

    context = {
      sessionId: session.id,
      retroId: created.retroId,
      rid,
      noteId: note.id,
      threadId: thread.id,
    }
  })

  for (const invariant of INVARIANTS) {
    test(`${invariant.name} refuses the ${other(invariant.owner)} actor`, async () => {
      const failure = invariant.call(harness, context, other(invariant.owner))

      await expect(failure).rejects.toBeInstanceOf(ForbiddenActorError)
      await failure.catch((error: unknown) => {
        expect((error as ForbiddenActorError).required).toBe(invariant.owner)
        expect((error as ForbiddenActorError).actual).toBe(other(invariant.owner))
      })
    })
  }

  test('the sweep covers every mutating use case in the App', () => {
    // If a new mutating use case is added without an invariant here, this fails.
    const mutating = [
      'sessions.create',
      'notes.addAi',
      'notes.addHuman',
      'notes.annotate',
      'revisions.create',
      'decisions.record',
      'records.setLifecycle',
      'records.claim',
      'threads.addComment',
      'threads.resolve',
      'review.finish',
      'review.close',
    ]
    const covered = INVARIANTS.length
    /**
     * **Three** mutating use cases are open to both actors, and the list below is
     * the whole of it — anything else added here without an invariant fails this
     * count:
     *
     * - `threads.addComment` — the CLI writes the AI's replies, the UI writes
     *   the human's (D4).
     * - `records.setLifecycle` — the AI marks what it fixed, the human marks
     *   from the browser. This is the one
     *   append-only table with an `actor` column, precisely because it is the
     *   one whose author cannot be inferred from the table.
     * - `records.claim` — whoever does the work holds the record, and that is
     *   the AI most of the time and the human sometimes (`record-claim.model.ts`).
     */
    const bothActors = ['threads.addComment', 'records.setLifecycle', 'records.claim']
    expect(covered).toBe(mutating.length - bothActors.length)
  })

  test('comments and record lifecycle are the writes both actors may make', async () => {
    for (const actor of ['ai', 'human'] as const) {
      const { thread } = await harness.app.threads.addComment.execute({
        actor,
        retro: { retroId: context.retroId },
        target: { kind: 'thread', threadId: context.threadId },
        text: `written by ${actor}`,
      })
      expect(thread.messages.at(-1)?.actor).toBe(actor)
    }

    /**
     * Taken as the round trip it actually is: an act is only legal from the
     * state it names, so the two actors write the two halves of one rather than
     * resolving the same record twice.
     */
    const byAi = await harness.app.records.setLifecycle.execute({
      actor: 'ai',
      retro: { retroId: context.retroId },
      rid: context.rid,
      status: 'resolved',
      refs: ['fixed-by-ai'],
    })
    expect(byAi.lifecycle.actor).toBe('ai')

    const byHuman = await harness.app.records.setLifecycle.execute({
      actor: 'human',
      retro: { retroId: context.retroId },
      rid: context.rid,
      status: 'reopened',
    })
    expect(byHuman.lifecycle.actor).toBe('human')
  })

  /**
   * **The exception inside the exception.**
   *
   * `record_lifecycle` is the one table both actors write, which is why it has
   * an `actor` column at all — but that was decided for *resolving*, a report of
   * work the AI did. Archiving is a judgment about what is worth looking at, and
   * it stays human-only: the user can archive or unarchive a record at will, but
   * the AI cannot. So the guard is per act, and it lives in the use case
   * rather than at a transport, which is what this asserts: the AI is refused
   * through the same call the browser makes.
   */
  test('archiving and unarchiving are the human’s, on the table both actors write', async () => {
    for (const status of ['archived', 'unarchived'] as const) {
      await expect(
        harness.app.records.setLifecycle.execute({
          actor: 'ai',
          retro: { retroId: context.retroId },
          rid: context.rid,
          status,
        }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
    }

    const { lifecycle } = await harness.app.records.setLifecycle.execute({
      actor: 'human',
      retro: { retroId: context.retroId },
      rid: context.rid,
      status: 'archived',
    })
    expect(lifecycle.status).toBe('archived')
    expect(lifecycle.actor).toBe('human')
  })

  test('reads are open to both actors', async () => {
    for (const actor of ['ai', 'human'] as const) {
      await harness.app.records.list.execute({ actor, retro: { retroId: context.retroId } })
      await harness.app.review.status.execute({ actor, retro: { retroId: context.retroId } })
      await harness.app.notes.list.execute({ actor, session: context.sessionId, withHuman: true })
    }
  })

  describe('nothing is ever deleted, and nothing is ever inferred from silence', () => {
    test('no repository offers a way to update or delete a stored row', () => {
      // Human data is append-only and revisions are immutable. At this layer the
      // enforcement *is* the absence of the method (item 3 adds SQLite triggers
      // underneath). The mutators that do exist are not edits: two are state
      // machines, and `cursors.save` moves a reader's position — the one row in
      // the database that records progress rather than history, and therefore the
      // one that is meant to be overwritten.
      const writers: Record<keyof Repositories, readonly string[]> = {
        sessions: ['add'],
        retrospectives: ['add', 'setState'],
        revisions: ['add'],
        // Insert-only, which is stricter than append-only: there is no version
        // here and nothing to supersede, so a second row for one record would be
        // two answers to "which record is this" rather than a later one.
        recordIds: ['add'],
        decisions: ['add'],
        finishMessages: ['add'],
        // Same standing as `requests` below: no use case reaches it since retro
        // 4 `r-remove-hold`, and the rows it wrote are human data.
        holds: ['add'],
        // Written by both actors and append-only for both: reopening a record is
        // another version, never an edit of the resolve it supersedes.
        recordLifecycle: ['add'],
        /**
         * **The two exceptions to "no repository updates a stored row", and
         * they are the reason this list is a list rather than a rule.**
         *
         * A definition is *configuration* — the vocabulary human data is
         * written in — rather than human data itself. Renaming a label is a
         * spelling correction to a shared list, not a second opinion about
         * something somebody said, and versioning it would make every reader of
         * an applied label resolve a name as of a moment. So `rename`,
         * `retire` and `unretire` really do write over the row, in both stores,
         * and the append-only rule is kept exactly where it belongs: on
         * `recordLabels` and `recordAttributeValues` below, which are what a
         * human actually wrote (`label-definition.repository.ts`).
         *
         * `retire` is also what stands in for a delete here. Nothing is ever
         * removed from either table, so a name a record was labelled with stays
         * readable forever — the same doctrine as `decline is a state, not a
         * deletion`.
         *
         * **`unretire` does not weaken that**, which is worth saying where the
         * exception is listed: it clears the offered-again flag and removes
         * nothing, the name was never freed by the retire it undoes, and the
         * two acts leave two rows in the outbox. It is `RecordUnarchived`'s
         * shape one table over (`r-retire-burns-a-word`).
         */
        labelDefinitions: ['add', 'rename', 'retire', 'unretire'],
        attributeDefinitions: ['add', 'rename', 'retire', 'unretire'],
        // Human-authored and append-only, like decisions: taking a label off a
        // record and clearing a value are rows saying so, never deletions.
        recordLabels: ['add'],
        recordAttributeValues: ['add'],
        // Written by both actors and append-only for both, like the lifecycle
        // entries: un-relating two records is another version carrying the words
        // of the relation it takes off, never a delete of the row that made it.
        recordRelations: ['add'],
        /**
         * Written by both actors and append-only for both, like the two above:
         * giving a record back is a row saying so, never a delete of the row
         * that took it — which is what keeps "who had this, and when" readable
         * (`record-claim.model.ts`).
         */
        recordClaims: ['add'],
        // The human's permission switch, versioned — and this is the one table
        // where the history *is* the feature: being certain the AI cannot
        // touch the configs is a claim about the past as much as the
        // present (`setting.model.ts`).
        settings: ['add'],
        notes: ['add'],
        annotations: ['add'],
        threads: ['addThread', 'addComment'],
        threadResolutions: ['add'],
        // Same standing as `holds` above: no use case reaches these any more
        // (`r-remove-requests`), and they are still listed, because
        // append-only is a property of this layer rather than of whoever
        // happens to call it this year.
        requests: ['add', 'addResponse', 'close'],
        events: ['append'],
        cursors: ['save'],
      }

      for (const [name, allowed] of Object.entries(writers)) {
        const repository = harness.store[name as keyof Repositories] as object
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repository)).filter(
          (method) => method !== 'constructor',
        )
        const mutators = methods.filter((method) => !/^(find|list|count|get|latest)/.test(method))

        expect(mutators.sort()).toEqual([...allowed].sort())
        expect(
          methods.filter((method) => /^(update|delete|remove|edit|destroy|patch)/.test(method)),
        ).toEqual([])
      }
    })

    test('a record nobody decided stays pending, and the review will not finish', async () => {
      const status = await harness.app.review.status.execute({
        actor: 'ai',
        retro: { retroId: context.retroId },
      })

      expect(status.counts.pending).toBe(1)
      expect(status.counts.approved).toBe(0)
      await expect(
        harness.app.review.finish.execute({ actor: 'human', retro: { retroId: context.retroId } }),
      ).rejects.toThrow()
    })

    test('a comment is not a verdict — commenting decides nothing', async () => {
      await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId: context.retroId },
        target: { kind: 'record', rid: context.rid, section: 'problem' },
        text: 'looks right to me',
      })

      expect(
        (
          await harness.app.review.status.execute({
            actor: 'ai',
            retro: { retroId: context.retroId },
          })
        ).counts.pending,
      ).toBe(1)
    })

    test('a declined record is still there, with its reviewer note', async () => {
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId: context.retroId },
        rid: context.rid,
        decision: { state: 'declined', reviewerNote: 'Not a real problem.' },
      })

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId: context.retroId },
      })

      expect(records).toHaveLength(1)
      expect(records[0]?.decision.state).toBe('declined')
      expect(records[0]?.decision.reviewerNote).toBe('Not a real problem.')
    })
  })
})
