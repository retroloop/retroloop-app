import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import type { RecordListAllRow } from '#application/use-cases/records/list-all-records.use-case'
import { aRecordInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'
import type { StoreFactory } from './store.contract'

/**
 * `records.listAll`, against every adapter (testing.md suite 1).
 *
 * Here for the reason `list-retros.contract.ts` is: it is a use case rather
 * than a repository, and it is a **fold over five reads** — an ordinal counted
 * within a session, a verdict that may or may not still bind, a proposed level
 * that depends on which of two shapes the record was filed in, and a lifecycle
 * derived from the entry in force. Proving that against the memory store alone
 * would leave the one thing worth proving unproven: that the store used in
 * production answers identically.
 *
 * The fixture is deliberately awkward — **two sessions, three retrospectives,
 * both record shapes, and every lifecycle state** — because almost every bug
 * this listing can have is a bug that a one-session, one-retro, one-shape
 * fixture would answer correctly by accident.
 */
export function describeListAllRecordsContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · ListAllRecordsUseCase`, () => {
    let store: Store
    let harness: Harness

    beforeEach(async () => {
      store = await makeStore()
      harness = createHarness(store)
    })

    const list = async (): Promise<readonly RecordListAllRow[]> =>
      (await harness.app.records.listAll.execute({ actor: 'ai' })).records

    const startSession = async (claudeSession: string, cwd: string): Promise<number> =>
      (
        await harness.app.sessions.create.execute({
          actor: 'ai',
          claudeSession,
          cwd,
          branch: 'main',
          supervised: true,
        })
      ).session.id

    const fileRevision = async (
      sessionId: number,
      records: readonly Partial<RecordInput>[],
    ): Promise<number> =>
      (
        await harness.app.revisions.create.execute({
          actor: 'ai',
          session: sessionId,
          revision: {
            records: records.map((overrides, index) =>
              aRecordInput({ num: index + 1, rid: `r-record-${index + 1}`, ...overrides }),
            ),
          },
        })
      ).retroId

    /**
     * Decides every record and runs both halves of the close, so the session's
     * next revision starts a **new** retrospective rather than joining this one
     * — a session has exactly one non-finished retrospective.
     */
    const finishRetro = async (retroId: number, rids: readonly string[]): Promise<void> => {
      for (const rid of rids) await harness.decide(retroId, rid, 'approved')
      await harness.closeReview(retroId)
    }

    /**
     * Defines the label if it is not there yet and puts it on the record — the
     * two acts the settings page and the record page take, through the same use
     * cases those pages call. Defining through the App rather than seeding the
     * repository is what keeps this fixture honest: nothing ships a label, so a
     * store with one in it is a store something created it in.
     */
    const label = async (retroId: number, rid: string, name: string): Promise<number> => {
      const known = (await harness.app.labels.list.execute({ actor: 'human' })).labels.find(
        (one) => one.name === name,
      )
      /**
       * The definition's id is **returned rather than assumed**, because the two
       * stores number rows differently and neither is wrong: SQLite gives each
       * table its own AUTOINCREMENT sequence, and the memory adapter hands out
       * one counter across every table. A literal `id: 1` here would pass
       * against SQLite and fail against memory — which is exactly what it did
       * when this was first written.
       */
      const definition =
        known ?? (await harness.app.labels.define.execute({ actor: 'human', name })).label
      await harness.app.labels.apply.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        label: { labelName: name },
        applied: true,
      })
      return definition.id
    }

    const resolve = async (retroId: number, rid: string, refs: readonly string[], actor = 'ai') =>
      harness.app.records.setLifecycle.execute({
        actor: actor as 'ai' | 'human',
        retro: { retroId },
        rid,
        status: 'resolved',
        refs,
      })

    test('lists nothing when nothing has been retrospected', async () => {
      expect(await list()).toEqual([])
    })

    /**
     * Newest first is retro id descending; the ordinal is the retrospective's
     * position **within its session**, so the newest row here is "#1" of the
     * second session while an older one is "#2" of the first — exactly the
     * distinction the identity line exists to draw.
     *
     * Within a retrospective the order is `num` ascending: the order the
     * reviewer read them in. Both directions in one assertion, because getting
     * one right and the other backwards is the likeliest way to be wrong.
     */
    test('lists every record of every retrospective, newest retro first, records in reading order', async () => {
      const alpha = await startSession('uuid-alpha', '/Users/sample/Developer/retro')
      const first = await fileRevision(alpha, [{}, {}])
      await finishRetro(first, ['r-record-1', 'r-record-2'])
      const second = await fileRevision(alpha, [{}, {}, {}])

      const beta = await startSession('uuid-beta', '/Users/sample/Developer/hangar')
      const elsewhere = await fileRevision(beta, [{}])

      const rows = await list()

      expect(rows.map((row) => [row.retroId, row.num])).toEqual([
        [elsewhere, 1],
        [second, 1],
        [second, 2],
        [second, 3],
        [first, 1],
        [first, 2],
      ])
      expect(rows.map((row) => row.retroNumber)).toEqual([1, 2, 2, 2, 1, 1])
      expect(rows.map((row) => row.session.id)).toEqual([beta, alpha, alpha, alpha, alpha, alpha])
      expect(rows.map((row) => row.session.cwd)).toEqual([
        '/Users/sample/Developer/hangar',
        ...Array<string>(5).fill('/Users/sample/Developer/retro'),
      ])
    })

    /**
     * Numbering records per retrospective would have every retrospective's
     * first record start over at #1, which reads as duplicate ids across the
     * listing; a single global sequence avoids that.
     *
     * Three retrospectives across two sessions, every one of them holding a
     * record whose `num` is 1 — and one sequence over all of them. The assertion
     * pairs each `globalId` with the `num` beside it on the same row, because
     * "the numbers are 1..6" is true of both the right answer and the wrong one
     * once the rows happen to be in this order; what separates them is that
     * `[6, 1]` and `[7, 2]` are rows whose two numbers **disagree**.
     */
    test('numbers every record of every retrospective in one sequence', async () => {
      const alpha = await startSession('uuid-seq-a', '/Users/sample/Developer/retro')
      const first = await fileRevision(alpha, [{}, {}, {}])
      await finishRetro(first, ['r-record-1', 'r-record-2', 'r-record-3'])
      const second = await fileRevision(alpha, [{}, {}])
      await finishRetro(second, ['r-record-1', 'r-record-2'])

      const beta = await startSession('uuid-seq-b', '/Users/sample/Developer/hangar')
      const elsewhere = await fileRevision(beta, [{}, {}])

      // Newest retro first, so the sequence reads downwards rather than upwards.
      expect((await list()).map((row) => [row.globalId, row.num])).toEqual([
        [6, 1],
        [7, 2],
        [4, 1],
        [5, 2],
        [1, 1],
        [2, 2],
        [3, 3],
      ])
      expect((await list()).map((row) => row.retroId)).toEqual([
        elsewhere,
        elsewhere,
        second,
        second,
        first,
        first,
        first,
      ])
    })

    /**
     * A record filed in a later revision is minted **when it first appears**, so
     * it comes after every record of every retrospective that already existed —
     * even ones started later. That is what makes the sequence a record of when
     * things were filed rather than a second per-retro counter, and it is the one
     * shape where a page that printed `num` cannot pass by accident.
     */
    test('mints a record filed later at the end of the sequence, not beside its neighbours', async () => {
      const alpha = await startSession('uuid-later-a', '/Users/sample/Developer/retro')
      const here = await fileRevision(alpha, [{}, {}])
      const beta = await startSession('uuid-later-b', '/Users/sample/Developer/hangar')
      await fileRevision(beta, [{}])

      // The AI redrafts the first retrospective with one more record, once the
      // human has put the round down.
      await harness.finishRound(here)
      await fileRevision(alpha, [{}, {}, {}])

      const rows = await list()
      expect(
        rows.filter((row) => row.retroId === here).map((row) => [row.num, row.globalId]),
      ).toEqual([
        [1, 1],
        [2, 2],
        [3, 4],
      ])
    })

    /**
     * The rid is minted per retrospective, so the same one names two records —
     * and the number this page shows is what tells them apart out loud. A
     * sequence keyed on the rid alone would hand both the same one.
     */
    test('gives two retrospectives’ records of the same rid different numbers', async () => {
      const alpha = await startSession('uuid-dup-a', '/Users/sample/Developer/retro')
      const here = await fileRevision(alpha, [{ rid: 'r-flaky-test' }])
      const beta = await startSession('uuid-dup-b', '/Users/sample/Developer/hangar')
      const there = await fileRevision(beta, [{ rid: 'r-flaky-test' }])

      expect((await list()).map((row) => [row.retroId, row.rid, row.num, row.globalId])).toEqual([
        [there, 'r-flaky-test', 1, 2],
        [here, 'r-flaky-test', 1, 1],
      ])
    })

    /** The whole row, once, so an added field has to be written down here before it ships. */
    test('carries the identity line, the record and both axes of state', async () => {
      const sessionId = await startSession('uuid-whole', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}])
      await resolve(retroId, 'r-record-1', ['a1b2c3d'])
      // Labelled as well as resolved, so the **populated** half of `labels` is
      // what this row asserts. A whole-row test taken against a record nobody
      // labelled would check `labels: []` and leave the join — the part that can
      // resolve the wrong name, or throw — checked by nothing.
      const migrated = await label(retroId, 'r-record-1', 'migrated')

      expect(await list()).toEqual([
        {
          retroId,
          retroNumber: 1,
          session: {
            id: sessionId,
            cwd: '/Users/sample/Developer/retro',
            startedAt: harness.clock.iso(),
          },
          rid: 'r-record-1',
          // The first record of the first retrospective this store has ever
          // held, so the sequence opens at 1 — and the two tests below are what
          // say it is a sequence rather than a per-retro number that happens to
          // agree here.
          globalId: 1,
          num: 1,
          title: 'Deploy blocked on a stale lock file',
          type: 'issue',
          requester: 'human',
          state: 'pending',
          severity: 3,
          proposedLevel: 2,
          lifecycle: {
            status: 'resolved',
            refs: ['a1b2c3d'],
            note: undefined,
            actor: 'ai',
            at: harness.clock.iso(),
          },
          // The involvement **in effect** — the AI's proposal here, because
          // nobody has decided this record. `aRecordInput` proposes
          // `pull-request`, so a row echoing the enum's `undecided` default
          // instead would mean the projection had stopped reading the decision.
          involvement: 'pull-request',
          // Nobody is holding this record, which is the same `undefined` a record
          // somebody claimed and gave back reads as (`record-claim.service.ts`).
          // The populated half is asserted in `record-claims.test.ts`, which
          // reads one claim through all three projections at once.
          claim: undefined,
          // Resolved against the vocabulary rather than sent as an id, because
          // the filter is the only reader that would hold the vocabulary and
          // every other reader of this row just renders the word.
          labels: [{ id: migrated, name: 'migrated', retired: false }],
        },
      ])
    })

    /**
     * **A rid is minted per retrospective, so a label on one is not a label on
     * the other**. Both retrospectives here hold an `r-flaky-test`, and only one
     * of them is labelled — a listing keyed on the rid alone puts the tag on both
     * rows, which is the shape of bug this whole fixture exists for.
     */
    test('gives a label to the record that wears it and not to its namesake', async () => {
      const alpha = await startSession('uuid-label-a', '/Users/sample/Developer/retro')
      const here = await fileRevision(alpha, [{ rid: 'r-flaky-test' }])
      const beta = await startSession('uuid-label-b', '/Users/sample/Developer/hangar')
      const there = await fileRevision(beta, [{ rid: 'r-flaky-test' }])

      await label(there, 'r-flaky-test', 'migrated')

      expect((await list()).map((row) => [row.retroId, row.labels.map((one) => one.name)])).toEqual(
        [
          [there, ['migrated']],
          [here, []],
        ],
      )
    })

    /**
     * A retired label goes on rendering where it was applied — that is what
     * retiring means, and the row says which so the page can draw it as
     * something nobody can add any more (`definition.view.ts`).
     */
    test('keeps a retired label on the records that wear it, and says it is retired', async () => {
      const sessionId = await startSession('uuid-retired', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}])
      const migrated = await label(retroId, 'r-record-1', 'migrated')

      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      expect((await list())[0]?.labels).toEqual([{ id: migrated, name: 'migrated', retired: true }])
    })

    /** A label taken off is a row, and the row is what stops the tag rendering. */
    test('drops a label the human removed', async () => {
      const sessionId = await startSession('uuid-removed', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}])
      await label(retroId, 'r-record-1', 'migrated')

      await harness.app.labels.apply.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-record-1',
        label: { labelName: 'migrated' },
        applied: false,
      })

      expect((await list())[0]?.labels).toEqual([])
    })

    /**
     * The verdict and the severity are **effective**, not stored: a verdict
     * given against an earlier revision carries while the narrative is unchanged
     * and stops binding the moment the AI rewrites the record, and the severity
     * that shows is the human's once they have moved it.
     */
    test('reports the verdict and severity in effect, carry-over included', async () => {
      const sessionId = await startSession('uuid-verdict', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}, {}])

      expect((await list()).map((row) => [row.state, row.severity])).toEqual([
        ['pending', 3],
        ['pending', 3],
      ])

      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-record-1',
        decision: { state: 'approved', severity: 5 },
      })
      expect((await list()).map((row) => [row.state, row.severity])).toEqual([
        ['approved', 5],
        ['pending', 3],
      ])

      // The finish gate wants a verdict on the second record too, and the round
      // has to be put down before the next draft may answer it.
      await harness.finishRound(retroId)
      expect((await list()).map((row) => [row.state, row.severity])).toEqual([
        ['approved', 5],
        ['approved', 3],
      ])

      // The next draft rewrites the first record: its verdict no longer binds,
      // and the severity falls back to what the AI proposes. The record it left
      // alone keeps the verdict it was given.
      await fileRevision(sessionId, [
        { problem: 'The lock outlives its process, and every later start pays for it.' },
        {},
      ])
      expect((await list()).map((row) => [row.state, row.severity])).toEqual([
        ['pending', 3],
        ['approved', 3],
      ])
    })

    /**
     * **Both record shapes, in one listing.** A legacy record's proposed level
     * is the field its draft authored; a solutions record has no such field and
     * the level is the recommended solution's. `proposedLevel()` answers both,
     * and a page that reached for `defaults.solutionLevel` directly would read
     * `undefined` on every record filed since solutions carried their own
     * levels.
     */
    test('reads the proposed level of both record shapes', async () => {
      const sessionId = await startSession('uuid-shapes', '/Users/sample/Developer/retro')
      await fileRevision(sessionId, [{}])
      const legacy = await harness.legacyRevision(sessionId)

      const rows = await list()

      expect(rows.map((row) => [row.rid, row.proposedLevel])).toEqual([
        // The legacy record: `defaults.solutionLevel`, authored as 1.
        [legacy.record.rid, 1],
        // The solutions record: the recommended solution is the second, level 2.
        ['r-record-1', 2],
      ])
      expect(rows.map((row) => row.requester)).toEqual(['ai', 'human'])
      expect(rows.map((row) => row.type)).toEqual(['feature', 'issue'])
    })

    /**
     * Every lifecycle state in one listing, and each one arrived at by an act
     * rather than arranged: untouched records are open because nothing resolved
     * them, and the reopened one is open again because somebody said so.
     */
    test('derives the lifecycle from the entry in force, and defaults to open', async () => {
      const sessionId = await startSession('uuid-lifecycle', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}, {}, {}])

      await resolve(retroId, 'r-record-1', ['a1b2c3d', 'https://github.com/o/r/pull/42'], 'human')
      await resolve(retroId, 'r-record-2', ['deadbee'])
      await harness.app.records.setLifecycle.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-record-2',
        status: 'reopened',
        note: 'The lock came back on Tuesday.',
      })

      const rows = await list()

      expect(rows.map((row) => [row.rid, row.lifecycle.status])).toEqual([
        ['r-record-1', 'resolved'],
        ['r-record-2', 'open'],
        ['r-record-3', 'open'],
      ])
      expect(rows[0]?.lifecycle).toEqual({
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
        note: undefined,
        actor: 'human',
        at: harness.clock.iso(),
      })
      // Reopened: the refs of the resolve it superseded are history, not the
      // state of an open record.
      expect(rows[1]?.lifecycle).toEqual({
        status: 'open',
        refs: [],
        note: 'The lock came back on Tuesday.',
        actor: 'human',
        at: harness.clock.iso(),
      })
      // Never touched: open, and nothing else to say about it.
      expect(rows[2]?.lifecycle).toEqual({
        status: 'open',
        refs: [],
        note: undefined,
        actor: undefined,
        at: undefined,
      })
    })

    /**
     * **The rid is not globally unique** (`record.model.ts`), and this listing is
     * the first place in the product where two retrospectives' records sit in one
     * array. A lifecycle keyed on the rid alone would show one retro's
     * resolution on the other's row.
     */
    test('never shows one retrospective’s resolution on another’s record of the same rid', async () => {
      const alpha = await startSession('uuid-same-a', '/Users/sample/Developer/retro')
      const here = await fileRevision(alpha, [{ rid: 'r-flaky-test' }])
      const beta = await startSession('uuid-same-b', '/Users/sample/Developer/hangar')
      const there = await fileRevision(beta, [{ rid: 'r-flaky-test' }])

      await resolve(here, 'r-flaky-test', ['a1b2c3d'])

      const rows = await list()

      expect(rows.map((row) => [row.retroId, row.lifecycle.status])).toEqual([
        [there, 'open'],
        [here, 'resolved'],
      ])
      expect(rows[0]?.lifecycle.refs).toEqual([])
      expect(rows[1]?.lifecycle.refs).toEqual(['a1b2c3d'])
    })

    /** The latest draft is the retrospective: a record it withdrew is not an item here. */
    test('lists the latest revision’s records, and not those a later draft withdrew', async () => {
      const sessionId = await startSession('uuid-withdrawn', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}, {}, {}])
      expect((await list()).map((row) => row.rid)).toEqual([
        'r-record-1',
        'r-record-2',
        'r-record-3',
      ])

      // The AI redrafts with the third record dropped. Density is per rid, and a
      // record may stop appearing (`create-revision.use-case.ts`).
      await harness.finishRound(retroId)
      await fileRevision(sessionId, [{}, {}])
      expect((await list()).map((row) => row.rid)).toEqual(['r-record-1', 'r-record-2'])
    })

    /**
     * A retrospective with no revision cannot be produced through the use cases
     * — `revision create` writes both in one unit of work — but it is
     * representable in the store, and a listing that threw on one would take the
     * whole page down with it.
     *
     * **It still consumes its session's ordinal**, which is the second half of
     * this test and the reason the counter is incremented before the row is
     * skipped: the dashboard shows every retrospective and numbers them all, so
     * a records page that numbered only the ones with records would call the
     * same retrospective "#1" while the dashboard calls it "#2".
     *
     * Seeded `finished` rather than `open` so the revision below starts a second
     * retrospective instead of joining this one. Both states are equally
     * impossible on a retro with no revision, and this is the one that lets the
     * ordinal be observed.
     */
    test('skips a retrospective that has no revision, and still counts it in the numbering', async () => {
      const sessionId = await startSession('uuid-bare', '/Users/sample/Developer/retro')
      await store.retrospectives.add({
        sessionId,
        state: 'finished',
        startedAt: harness.clock.iso(),
        finishedAt: harness.clock.iso(),
      })
      const real = await fileRevision(sessionId, [{}])

      const rows = await list()

      expect(rows.map((row) => [row.retroId, row.retroNumber])).toEqual([[real, 2]])
    })

    /** Reads are open to both actors; only writes are actor-bound. */
    test('answers the human and the AI identically', async () => {
      const sessionId = await startSession('uuid-actors', '/Users/sample/Developer/retro')
      await fileRevision(sessionId, [{}])

      expect(await harness.app.records.listAll.execute({ actor: 'human' })).toEqual(
        await harness.app.records.listAll.execute({ actor: 'ai' }),
      )
    })
  })
}
