import { describe, expect, test } from 'bun:test'
import { createApp } from '#application/app'
import { createMemoryStore } from '#infrastructure/memory/memory-store.adapter'
import { aRevisionInput } from '../support/fixtures'
import { createHarness } from '../support/harness'

describe('createApp', () => {
  /**
   * The use-case set, named rather than counted (retro 3 `r-fixture-tripwires`).
   *
   * A count is a tripwire that goes off without saying what tripped it: "expected
   * 29, got 30" is the same message whichever use case arrived, and the reader has
   * to diff two trees to find out. A sorted list of paths fails on the newcomer's
   * own name, the way the two procedure-set meta-tests do
   * (`apps/api/test/procedures.test.ts`, `apps/web/test/procedure-set.spec.ts`).
   *
   * Adding a use case is meant to mean editing this list on purpose: the App is
   * the core's whole public surface, and every entry on it is something an
   * adapter may reach.
   */
  test('exposes exactly these use cases, each as an execute(input) boundary', () => {
    const app = createApp(createMemoryStore())

    const useCases = Object.entries(app)
      .filter(([group]) => group !== 'store')
      .flatMap(([group, members]) =>
        Object.entries(members as Record<string, unknown>).map(
          ([name, useCase]) => [`${group}.${name}`, useCase] as const,
        ),
      )
      .sort(([left], [right]) => left.localeCompare(right))

    expect(useCases.map(([name]) => name)).toEqual([
      // The attribute vocabulary and the values records carry from it. Five
      // acts and a read, exactly as labels have — the two primitives are pure
      // and independent, so neither list is folded into the other
      // (`labels-attributes-external-lifecycle.md`, OWNER RULING).
      'attributes.define',
      'attributes.list',
      'attributes.rename',
      'attributes.retire',
      'attributes.set',
      // Retire's inverse, and the two of them arrived one session apart:
      // retro-11 `r-retire-burns-a-word` made a mis-press a two-press round
      // trip rather than a permanently burned word.
      'attributes.unretire',
      'decisions.record',
      'events.list',
      'exports.retrospective',
      // The label vocabulary and what records wear from it. `apply` is the
      // human-only write; the four definition acts take either actor, with the
      // AI's half gated by the settings toggle at the store boundary.
      'labels.apply',
      'labels.define',
      'labels.list',
      'labels.rename',
      'labels.retire',
      'labels.unretire',
      'notes.addAi',
      'notes.addHuman',
      'notes.annotate',
      'notes.list',
      'records.byId',
      /**
       * A record picked up, or given back — the in-progress marker
       * (`record-claim.model.ts`). One entry rather than two, on the standing
       * `records.relate` set below: taking and releasing are on and off, so the
       * boolean widened the input rather than the surface.
       */
      'records.claim',
      'records.get',
      'records.history',
      /**
       * The queue, the cross-retrospective listing and the record-with-its-fix
       * read — one read model behind all of them, because two that drifted would
       * mean `record queue` and `record get` disagreeing about the record an
       * agent is holding open in two terminals.
       */
      'records.lane',
      'records.list',
      'records.listAll',
      // Two records said to belong together, in the words of whoever relates
      // them — or the relation taken off (the owner's session-11 ask). One
      // entry rather than two, because relating and un-relating are on and off
      // and the boolean widened the input rather than the surface
      // (`relate-records.use-case.ts`).
      'records.relate',
      'records.setLifecycle',
      'retros.list',
      'review.close',
      'review.finish',
      'review.status',
      'revisions.create',
      'revisions.feedback',
      'revisions.get',
      'revisions.list',
      'sessions.create',
      'sessions.get',
      'sessions.list',
      // OWNER RULING 2's toggle. `get` is open to both actors — reading a
      // permission is not exercising it — and `setAiConfigWrite` refuses the AI
      // forever, whatever the switch currently says.
      'settings.get',
      'settings.setAiConfigWrite',
      'threads.addComment',
      'threads.list',
      'threads.resolve',
    ])
    for (const [name, useCase] of useCases) {
      expect(typeof (useCase as { execute?: unknown }).execute, name).toBe('function')
    }
  })

  test('runs on the system clock when no clock is injected', async () => {
    const app = createApp(createMemoryStore())

    const { session } = await app.sessions.create.execute({
      actor: 'ai',
      claudeSession: 'uuid-1',
      project: 'retro',
      cwd: '/tmp',
    })

    expect(Number.isNaN(Date.parse(session.startedAt))).toBe(false)
  })
})

describe('the core loop', () => {
  test('session → notes → revision → feedback → revision 2 → decisions → finish', async () => {
    const harness = createHarness()

    // The AI registers the session and files frictions as they happen.
    const session = await harness.session('uuid-loop')
    const { note } = await harness.app.notes.addAi.execute({
      actor: 'ai',
      session: session.id,
      text: 'The deploy waited on a stale lock again.',
    })
    await harness.app.notes.annotate.execute({
      actor: 'human',
      noteId: note.id,
      text: 'Third time this week.',
    })

    // At drafting time it reads the human's side too, then submits revision 1.
    const drafting = await harness.app.notes.list.execute({
      actor: 'ai',
      session: session.id,
      withHuman: true,
    })
    expect(drafting.notes[0]?.annotation?.text).toBe('Third time this week.')

    const first = await harness.app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: aRevisionInput([
        { rid: 'r-stale-lock', num: 1 },
        { rid: 'r-slow-tests', num: 2 },
      ]),
      expectRevision: 1,
    })
    expect(first.revision.n).toBe(1)

    // The human reviews: approves one, and comments on the other. A comment is
    // the whole of their side of this — the ask and the remark travel together
    // in one thread since retro 4 `r-remove-requests`.
    await harness.decide(first.retroId, 'r-stale-lock', 'approved')
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: first.retroId },
      target: { kind: 'record', rid: 'r-slow-tests', section: 'problem' },
      text: 'This understates the cost. Say how long the suite actually takes.',
    })
    // The one button needs every record decided, so the record he wants
    // rewritten gets the verdict that says so (retro 4 `r-verdict-revise`) —
    // and then he presses Finish, which is the only terminal action on the page
    // (retro 4 `r-one-finish-button`).
    await harness.decide(first.retroId, 'r-slow-tests', 'revise')
    await harness.app.review.finish.execute({ actor: 'human', retro: { retroId: first.retroId } })

    // `review wait` would return here — on one event now, whatever the round
    // turns out to have been about.
    const woken = await harness.app.events.list.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
      names: ['ReviewFinished'],
    })
    expect(woken.events.at(-1)?.name).toBe('ReviewFinished')

    // The AI reads the round and decides its own next step from what is in it:
    // a record asking to be rewritten, and a thread waiting on an answer. Both
    // say the same thing — this is a revision, not an export.
    const asked = await harness.app.records.list.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
      state: 'revise',
    })
    expect(asked.records.map((view) => view.record.rid)).toEqual(['r-slow-tests'])
    await expect(
      harness.app.review.close.execute({ actor: 'ai', retro: { retroId: first.retroId } }),
    ).rejects.toThrow()

    // The AI reads the feedback, answers, and submits revision 2.
    const feedback = await harness.app.revisions.feedback.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
    })
    expect(feedback.records.map((record) => record.state)).toEqual(['approved', 'revise'])

    const unanswered = await harness.app.threads.list.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
      unansweredOnly: true,
    })
    expect(unanswered.threads).toHaveLength(1)

    await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
      target: { kind: 'thread', threadId: unanswered.threads[0]?.id ?? 0 },
      text: 'Rewritten with the measured numbers — the 14-minute figure is in revision 2.',
    })

    const second = await harness.app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: aRevisionInput([
        { rid: 'r-stale-lock', num: 1 },
        { rid: 'r-slow-tests', num: 2, problem: 'The suite takes 14 minutes; nobody runs it.' },
      ]),
      expectRevision: 2,
    })
    expect(second.retroId).toBe(first.retroId)

    // The approval carried; the rewritten record is pending again.
    const records = await harness.app.records.list.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
    })
    expect(records.records[0]?.decision.state).toBe('approved')
    expect(records.records[0]?.decision.carriedOver).toBe(true)
    expect(records.records[1]?.decision.state).toBe('pending')

    // The gate refuses until the last record is decided.
    await expect(
      harness.app.review.finish.execute({ actor: 'human', retro: { retroId: first.retroId } }),
    ).rejects.toThrow()

    await harness.decide(first.retroId, 'r-slow-tests', 'declined')
    const finished = await harness.app.review.finish.execute({
      actor: 'human',
      retro: { retroId: first.retroId },
    })
    expect(finished.retrospective.state).toBe('reviewing')

    // Nothing is left asking for anything, so this round ends in the export
    // rather than in another draft — the AI's own act, and the only thing that
    // ever makes a retrospective `finished`.
    const closed = await harness.app.review.close.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
    })

    expect(closed.retrospective.state).toBe('finished')
    expect(await harness.eventNames()).toEqual([
      'SessionCreated',
      'NoteAdded',
      'AnnotationAdded',
      'RetrospectiveStarted',
      'RevisionCreated',
      'DecisionRecorded',
      'CommentAdded',
      'DecisionRecorded',
      'ReviewFinished',
      'CommentAdded',
      'RevisionCreated',
      'DecisionRecorded',
      'ReviewFinished',
      'ReviewClosed',
    ])

    // The verdict outlived the review that recorded it.
    const decided = await harness.app.records.list.execute({
      actor: 'ai',
      retro: { retroId: first.retroId },
    })
    expect(decided.records[0]?.decision.state).toBe('approved')

    // The next revision on this session opens a new retrospective.
    const next = await harness.revision(session.id)
    expect(next.retroStarted).toBe(true)
    expect(next.revision.n).toBe(1)
  })
})
