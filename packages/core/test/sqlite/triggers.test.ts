import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import type { SqliteStore } from '#infrastructure/sqlite/sqlite-store.adapter'
import { openTempStore, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

/**
 * The L1 backstop of the actor model (architecture.md §Actor model).
 *
 * The use cases already refuse the wrong actor, but that only binds a caller who
 * came through them. These tests use a **second connection opened straight onto
 * the file** — the rogue writer the triggers exist for — and prove the database
 * itself refuses to rewrite or drop the rows the model says are final.
 *
 * Two groups, one guarantee. The four tables architecture.md names are
 * human-authored (`decisions`, `notes`, `annotations`, `comments`), and
 * `holds` joined them with `r-hold-semantics`, `thread_resolutions` with
 * `r-resolvable-comments`, and `finish_messages` with
 * `r-finish-confirm-message`. The other two are immutable by the model rather
 * than by authorship: a revision is a draft that feedback answers with revision
 * n+1, and a request response is a message that was sent. `notes` is protected
 * for both authors, not only the human's rows — the mutability matrix makes AI
 * notes append-only too.
 *
 * `record_lifecycle` is the table that shows the two groups were never really
 * about authorship: **both** actors write it, and it is as append-only as the
 * rest. `record_relations` is the second, and it makes the same point from
 * further away — it is keyed on global ids rather than on a retrospective's
 * record, and it is protected identically.
 */
describe('append-only triggers', () => {
  let store: SqliteStore
  let rogue: Database
  let retroId: number
  let noteId: number
  let threadId: number

  beforeEach(async () => {
    store = openTempStore()

    const session = await store.sessions.add({
      claudeSession: 'uuid-1',
      project: 'retro',
      cwd: '/tmp',
      branch: 'main',
      supervised: true,
      startedAt: '2026-08-23T09:00:00.000Z',
    })
    const retro = await store.retrospectives.add({
      sessionId: session.id,
      state: 'reviewing',
      startedAt: '2026-08-23T09:00:00.000Z',
      finishedAt: undefined,
    })
    retroId = retro.id

    const note = await store.notes.add({
      sessionId: session.id,
      author: 'human',
      kind: undefined,
      text: 'This cost me the whole afternoon.',
      at: '2026-08-23T09:10:00.000Z',
    })
    noteId = note.id

    await store.annotations.add({
      noteId: note.id,
      sessionId: session.id,
      text: 'Third time this week.',
      at: '2026-08-23T09:20:00.000Z',
    })
    await store.decisions.add({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      state: 'approved',
      severity: 3,
      solutionLevel: 2,
      selectedSolution: 2,
      involvement: 'pull-request',
      reviewerNote: 'Do this one first.',
      revisionN: 1,
      contentHash: 'hash-1',
      decidedAt: '2026-08-23T10:00:00.000Z',
    })
    await store.holds.add({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      held: true,
      note: 'Not until the release ships.',
      at: '2026-08-25T10:00:00.000Z',
    })
    const thread = await store.threads.addThread({
      retroId,
      rid: 'r-deploy-blocked',
      section: 'problem',
      openedAt: '2026-08-23T10:00:00.000Z',
    })
    threadId = thread.id
    await store.threads.addComment(thread.id, {
      threadId: thread.id,
      actor: 'human',
      text: 'The impact is understated.',
      at: '2026-08-23T10:01:00.000Z',
      revisionN: 1,
    })
    await store.threadResolutions.add({
      threadId: thread.id,
      version: 1,
      resolved: true,
      at: '2026-08-27T10:00:00.000Z',
    })
    await store.finishMessages.add({
      retroId,
      revisionN: 1,
      version: 1,
      message: 'Ship the first two; the third can wait.',
      at: '2026-08-28T10:00:00.000Z',
    })
    await store.recordLifecycle.add({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      status: 'resolved',
      refs: ['a1b2c3d'],
      note: 'Fixed on the release branch.',
      actor: 'ai',
      at: '2026-08-29T10:00:00.000Z',
    })

    /**
     * The vocabulary first, because the two application rows below are foreign
     * keys into it — and because nothing ships a label, so a store with one in
     * it is a store something created it in
     * (`20260901090000_create_label_definitions.ts`).
     *
     * The definitions themselves are **not** on the protected list: they are
     * configuration rather than human data, and a rename really does write over
     * the row. The test below this loop is what says so out loud.
     */
    const label = await store.labelDefinitions.add({
      name: 'migrated',
      retiredAt: undefined,
      createdAt: '2026-09-01T09:00:00.000Z',
    })
    const attribute = await store.attributeDefinitions.add({
      name: 'external issue id',
      type: 'url',
      retiredAt: undefined,
      createdAt: '2026-09-01T09:00:00.000Z',
    })
    await store.recordLabels.add({
      retroId,
      rid: 'r-deploy-blocked',
      labelId: label.id,
      version: 1,
      applied: true,
      at: '2026-09-01T10:00:00.000Z',
    })
    await store.recordAttributeValues.add({
      retroId,
      rid: 'r-deploy-blocked',
      attributeId: attribute.id,
      version: 1,
      value: 'https://github.com/o/r/issues/91',
      at: '2026-09-01T10:00:00.000Z',
    })
    await store.settings.add({
      key: 'ai_config_write',
      version: 1,
      value: 'on',
      at: '2026-09-01T09:30:00.000Z',
    })

    /**
     * The two global numbers a relation is a foreign key on — minted here rather
     * than assumed, because `record_relations` is the one table in this schema
     * whose rows cannot exist without them (`record-relation.model.ts`).
     */
    const relatedFrom = await store.recordIds.add({ retroId, rid: 'r-deploy-blocked' })
    const relatedTo = await store.recordIds.add({ retroId, rid: 'r-stale-lock' })
    await store.recordRelations.add({
      fromId: relatedFrom.id,
      toId: relatedTo.id,
      version: 1,
      applied: true,
      how: 'the same lock, found again',
      actor: 'ai',
      at: '2026-09-01T11:00:00.000Z',
    })

    /**
     * The in-progress marker, which is the **third** table here both actors
     * write and the first one whose subject is not settled: a claim is true for
     * an afternoon and then it is not. It is protected all the same, because the
     * guarantee is about immutability rather than about how long a row stays
     * interesting — "who had this, and when" is the question the history answers.
     */
    await store.recordClaims.add({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      claimed: true,
      actor: 'ai',
      at: '2026-09-13T10:00:00.000Z',
    })

    await store.revisions.add({
      retroId,
      n: 1,
      createdAt: '2026-08-23T09:30:00.000Z',
      title: undefined,
      records: [],
    })
    const request = await store.requests.add({
      retroId,
      text: 'Add a record about the lock file',
      state: 'open',
      openedAt: '2026-08-23T10:00:00.000Z',
      closedAt: undefined,
    })
    await store.requests.addResponse(request.id, {
      requestId: request.id,
      text: 'Added as r-stale-lock in revision 2.',
      revisionN: 2,
      at: '2026-08-23T10:30:00.000Z',
    })

    rogue = new Database(store.file)
  })

  const finalTables: readonly {
    readonly table: string
    readonly column: string
    readonly value: string | number
  }[] = [
    { table: 'decisions', column: 'state', value: 'declined' },
    // A hold is human-authored too: a release is a new version, and the reason
    // somebody gave for parking a record is never edited (`r-hold-semantics`).
    { table: 'holds', column: 'note', value: 'rewritten' },
    { table: 'notes', column: 'text', value: 'rewritten' },
    { table: 'annotations', column: 'text', value: 'rewritten' },
    { table: 'comments', column: 'text', value: 'rewritten' },
    // The human saying they are done with a thread is human-authored too: reopening
    // it is a new version, and the moment they marked it is never edited
    // (`r-resolvable-comments`).
    { table: 'thread_resolutions', column: 'resolved', value: 0 },
    // The word they left on a round is human-authored too, and it is the one
    // thing in the round that is their own prose (`r-finish-confirm-message`).
    { table: 'finish_messages', column: 'message', value: 'rewritten' },
    /**
     * **The one on this list the AI also writes**, and it is protected exactly
     * like the rest. The append-only guarantee is about immutability, not about
     * authorship: a record marked resolved with a commit sha is a claim
     * somebody made at a moment, and reopening it is a new version rather than
     * a rewrite of the claim.
     */
    { table: 'record_lifecycle', column: 'status', value: 'reopened' },
    /**
     * A label on a record and a value on a record are human fields, so taking a
     * label off and clearing a value are rows saying so. The **definitions**
     * they point at are not on this list, and that split is the whole design:
     * the vocabulary is configuration and is renamed in place, while what a
     * human wrote with it is never rewritten (`label-definition.repository.ts`).
     */
    { table: 'record_labels', column: 'applied', value: 0 },
    { table: 'record_attribute_values', column: 'value', value: 'rewritten' },
    /**
     * **The second table on this list both actors write**, and it is protected
     * on the same terms the lifecycle above is: what somebody said two records
     * have to do with each other is a claim made at a moment, and taking the
     * relation off is a new version carrying the words of the one it supersedes
     * — never a rewrite of the claim, and never a delete of the row that made
     * it.
     */
    { table: 'record_relations', column: 'applied', value: 0 },
    /**
     * **The third, and the one that shows the rule is about immutability and
     * nothing else.** A claim is the shortest-lived row in this store — somebody
     * picks a record up and gives it back the same afternoon — and rewriting it
     * would make "who was working on this on Tuesday" unanswerable, which is the
     * only question it is ever asked. Releasing a record is a new version
     * (`record-claim.model.ts`).
     */
    { table: 'record_claims', column: 'claimed', value: 0 },
    /**
     * The permission switch, and this is the row the guarantee is made of. The
     * user needs to be certain the AI cannot touch the configs — an AI that
     * could rewrite this row could grant itself the ability to write configs
     * and leave no trace, so the one connection this test uses is exactly the
     * one that guarantee is aimed at.
     */
    { table: 'settings', column: 'value', value: 'off' },
    { table: 'revisions', column: 'records', value: '[]' },
    { table: 'request_responses', column: 'text', value: 'rewritten' },
  ]

  for (const { table, column, value } of finalTables) {
    test(`${table}: a direct UPDATE is refused`, () => {
      expect(() => rogue.run(`UPDATE ${table} SET ${column} = ?`, [value])).toThrow(/append-only/)
    })

    test(`${table}: a direct DELETE is refused`, () => {
      expect(() => rogue.run(`DELETE FROM ${table}`)).toThrow(/never deleted/)
    })

    test(`${table}: the row is still exactly as written`, () => {
      expect(() => rogue.run(`DELETE FROM ${table}`)).toThrow()
      expect(
        rogue.query<{ total: number }, []>(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total,
      ).toBe(1)
    })
  }

  test('the trigger binds the application’s own connection too', async () => {
    // Nothing about the guarantee depends on who opened the file.
    await expect(
      store.decisions.add({
        retroId,
        rid: 'r-deploy-blocked',
        version: 1,
        state: 'hold',
        severity: 1,
        solutionLevel: 'none',
        selectedSolution: undefined,
        involvement: 'other',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: 'hash-2',
        decidedAt: '2026-08-23T11:00:00.000Z',
      }),
    ).rejects.toThrow(/UNIQUE/)
  })

  /**
   * **The two tables this schema deliberately lets anyone rewrite**, asserted
   * here so the list above reads as a decision rather than as an oversight.
   *
   * A definition is the vocabulary human data is written in, not the human data:
   * renaming a label is a spelling correction to a shared list, and every record
   * wearing it reads the new name at once, which is the whole reason a rename is
   * a write over the row rather than a new definition. The append-only rule is
   * kept where it belongs — on `record_labels` and `record_attribute_values`
   * above (`label-definition.repository.ts`).
   */
  test('a definition may still be renamed and retired — it is config, not human data', async () => {
    const label = await store.labelDefinitions.add({
      name: 'needs-triage',
      retiredAt: undefined,
      createdAt: '2026-09-01T09:00:00.000Z',
    })

    expect((await store.labelDefinitions.rename(label.id, 'triage')).name).toBe('triage')
    expect(
      (await store.labelDefinitions.retire(label.id, '2026-09-02T09:00:00.000Z')).retiredAt,
    ).toBe('2026-09-02T09:00:00.000Z')
    // And from a connection that never came through the repository, because
    // there is no trigger stopping one: the point is that this table has none.
    expect(() =>
      rogue.run('UPDATE label_definitions SET name = ? WHERE id = ?', ['renamed', label.id]),
    ).not.toThrow()
  })

  test('a request may still be closed — closing is a state change, not an edit', async () => {
    const request = await store.requests.add({
      retroId,
      text: 'Add a record about the lock file',
      state: 'open',
      openedAt: '2026-08-23T10:00:00.000Z',
      closedAt: undefined,
    })

    const closed = await store.requests.close(request.id, '2026-08-23T11:00:00.000Z')

    expect(closed?.state).toBe('closed')
  })

  test('a retrospective may still move through its states', async () => {
    const finished = await store.retrospectives.setState(
      retroId,
      'finished',
      '2026-08-23T11:00:00.000Z',
    )

    expect(finished?.state).toBe('finished')
  })

  describe('referential integrity', () => {
    test('a revision cannot belong to a retrospective that does not exist', async () => {
      await expect(
        store.revisions.add({
          retroId: 404,
          n: 1,
          createdAt: '2026-08-23T09:00:00.000Z',
          title: undefined,
          records: [],
        }),
      ).rejects.toThrow(/FOREIGN KEY/)
    })

    test('an annotation cannot belong to a note that does not exist', async () => {
      await expect(
        store.annotations.add({
          noteId: 404,
          sessionId: 1,
          text: 'orphan',
          at: '2026-08-23T09:20:00.000Z',
        }),
      ).rejects.toThrow(/FOREIGN KEY/)
    })

    test('a note can be annotated only once', async () => {
      await expect(
        store.annotations.add({
          noteId,
          sessionId: 1,
          text: 'a second remark',
          at: '2026-08-23T09:30:00.000Z',
        }),
      ).rejects.toThrow(/UNIQUE/)
    })

    test('a record section can hold only one thread', async () => {
      await expect(
        store.threads.addThread({
          retroId,
          rid: 'r-deploy-blocked',
          section: 'problem',
          openedAt: '2026-08-23T10:05:00.000Z',
        }),
      ).rejects.toThrow(/UNIQUE/)
      expect(threadId).toBeGreaterThan(0)
    })
  })
})
