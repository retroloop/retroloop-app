import { afterAll, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { aRevisionInput } from '../support/fixtures'
import { createHarness } from '../support/harness'
import { openTempStore, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

/**
 * The use cases, unchanged, on the real store.
 *
 * The contract suites prove the two adapters behave alike at the repository
 * boundary; this proves the layer above notices no difference — that the
 * application layer carries no SQLite-shaped code, and that nothing it does
 * collides with what L1 now enforces for itself. A decision writes a new version
 * rather than updating one, so the append-only triggers stay quiet; a finish
 * moves the retrospective's state, which they permit; every write lands in the
 * order foreign keys require.
 *
 * It is deliberately one scenario. The behaviour is already covered against the
 * memory store; what is being tested here is the wiring.
 */
test('the whole loop runs against a real database file', async () => {
  const store = openTempStore()
  const harness = createHarness(store)

  const session = await harness.session('uuid-on-sqlite')
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

  const first = await harness.app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: aRevisionInput([
      { rid: 'r-stale-lock', num: 1 },
      { rid: 'r-slow-tests', num: 2 },
    ]),
    expectRevision: 1,
  })

  await harness.decide(first.retroId, 'r-stale-lock', 'approved')
  await harness.app.threads.addComment.execute({
    actor: 'human',
    retro: { retroId: first.retroId },
    target: { kind: 'record', rid: 'r-slow-tests', section: 'problem' },
    text: 'This understates the cost. Say how long the suite actually takes.',
  })
  await harness.decide(first.retroId, 'r-slow-tests', 'revise')
  await harness.app.review.finish.execute({ actor: 'human', retro: { retroId: first.retroId } })

  await harness.app.threads.addComment.execute({
    actor: 'ai',
    retro: { retroId: first.retroId },
    target: { kind: 'record', rid: 'r-slow-tests', section: 'problem' },
    text: 'Added the 14-minute figure in revision 2.',
  })
  await harness.app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: aRevisionInput([
      { rid: 'r-stale-lock', num: 1 },
      { rid: 'r-slow-tests', num: 2, problem: 'The suite takes 14 minutes; nobody runs it.' },
    ]),
    expectRevision: 2,
  })

  // The approval carried across the revision; the rewritten record went pending.
  const records = await harness.app.records.list.execute({
    actor: 'ai',
    retro: { retroId: first.retroId },
  })
  expect(records.records[0]?.decision.state).toBe('approved')
  expect(records.records[0]?.decision.carriedOver).toBe(true)
  expect(records.records[1]?.decision.state).toBe('pending')

  await expect(
    harness.app.review.finish.execute({ actor: 'human', retro: { retroId: first.retroId } }),
  ).rejects.toThrow()

  await harness.decide(first.retroId, 'r-slow-tests', 'declined')
  await harness.app.review.finish.execute({ actor: 'human', retro: { retroId: first.retroId } })
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

  // And it is on disk: a second process opening the stage sees the finished review.
  await store.close()
  const reopened = openTempStore({ dataDir: dirname(store.file) })
  expect(
    (
      await createHarness(reopened).app.review.status.execute({
        actor: 'ai',
        retro: { retroId: first.retroId },
      })
    ).finished,
  ).toBe(true)
  await reopened.close()
})
