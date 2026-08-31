import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewDecision } from '#domain/models/decision.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

export function describeDecisionRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · DecisionRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewDecision = (overrides: Partial<NewDecision> = {}): NewDecision => ({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      state: 'approved',
      severity: 3,
      solutionLevel: 2,
      selectedSolution: undefined,
      involvement: 'pull-request',
      reviewerNote: undefined,
      revisionN: 1,
      contentHash: 'hash-1',
      decidedAt: '2026-08-23T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores a decision and reads it back as the latest version', async () => {
      const decision = await store.decisions.add(aNewDecision())

      expect(await store.decisions.findLatest(retroId, 'r-deploy-blocked')).toEqual(decision)
    })

    test('keeps a solution level of either shape — 1–5 or a named ceiling', async () => {
      const numeric = await store.decisions.add(
        aNewDecision({ rid: 'r-numeric', solutionLevel: 4 }),
      )
      const named = await store.decisions.add(
        aNewDecision({ rid: 'r-named', solutionLevel: 'upstream' }),
      )

      expect((await store.decisions.findLatest(retroId, 'r-numeric'))?.solutionLevel).toBe(4)
      expect((await store.decisions.findLatest(retroId, 'r-named'))?.solutionLevel).toBe('upstream')
      expect(numeric.solutionLevel).toBe(4)
      expect(named.solutionLevel).toBe('upstream')
    })

    /**
     * The selection is nullable in the column and `undefined` in the model, and
     * a store has to round-trip both: a record that proposed solutions carries
     * the human's pick, and every decision written before solutions existed
     * carries nothing at all.
     */
    test('round-trips the selected solution, and an absent selection as absent', async () => {
      await store.decisions.add(aNewDecision({ rid: 'r-picked', selectedSolution: 3 }))
      await store.decisions.add(aNewDecision({ rid: 'r-unasked', selectedSolution: undefined }))

      expect((await store.decisions.findLatest(retroId, 'r-picked'))?.selectedSolution).toBe(3)
      expect(
        (await store.decisions.findLatest(retroId, 'r-unasked'))?.selectedSolution,
      ).toBeUndefined()
    })

    test('keeps a reviewer note verbatim, and an absent one absent', async () => {
      await store.decisions.add(
        aNewDecision({ rid: 'r-noted', reviewerNote: '  Fix it upstream, not here.  ' }),
      )

      expect((await store.decisions.findLatest(retroId, 'r-noted'))?.reviewerNote).toBe(
        '  Fix it upstream, not here.  ',
      )
      expect(
        (await store.decisions.findLatest(retroId, 'r-deploy-blocked'))?.reviewerNote,
      ).toBeUndefined()
    })

    test('returns undefined for a record that was never decided', async () => {
      expect(await store.decisions.findLatest(retroId, 'r-never-touched')).toBeUndefined()
    })

    test('appends versions and keeps every one of them', async () => {
      const first = await store.decisions.add(aNewDecision({ version: 1, state: 'hold' }))
      const second = await store.decisions.add(aNewDecision({ version: 2, state: 'approved' }))

      expect(await store.decisions.listForRecord(retroId, 'r-deploy-blocked')).toEqual([
        first,
        second,
      ])
      expect(await store.decisions.findLatest(retroId, 'r-deploy-blocked')).toEqual(second)
    })

    test('returns the latest version of each decided record in a retrospective', async () => {
      await store.decisions.add(aNewDecision({ rid: 'r-one', version: 1, state: 'hold' }))
      const latestOne = await store.decisions.add(
        aNewDecision({ rid: 'r-one', version: 2, state: 'declined' }),
      )
      const two = await store.decisions.add(aNewDecision({ rid: 'r-two' }))
      await store.decisions.add(aNewDecision({ retroId: otherRetroId, rid: 'r-elsewhere' }))

      const latest = await store.decisions.listLatestByRetro(retroId)
      expect(latest).toHaveLength(2)
      expect(latest).toEqual(expect.arrayContaining([latestOne, two]))
    })

    /**
     * The dashboard counts pending and decided per retrospective (KC-0020), so
     * it wants the same "latest version per record" answer for every
     * retrospective at once. Versions are numbered per record, so two
     * retrospectives both holding a `r-one` v1 and a `r-one` v2 must not be
     * allowed to shadow each other.
     */
    test('returns the latest version of every decided record, across retrospectives', async () => {
      await store.decisions.add(aNewDecision({ rid: 'r-one', version: 1, state: 'hold' }))
      const latestHere = await store.decisions.add(
        aNewDecision({ rid: 'r-one', version: 2, state: 'declined' }),
      )
      await store.decisions.add(
        aNewDecision({ retroId: otherRetroId, rid: 'r-one', version: 1, state: 'approved' }),
      )
      const latestThere = await store.decisions.add(
        aNewDecision({ retroId: otherRetroId, rid: 'r-one', version: 2, state: 'hold' }),
      )

      expect(await store.decisions.listLatestForEachRetro()).toEqual([latestHere, latestThere])
    })

    test('lists nothing for a retrospective with no decisions', async () => {
      expect(await store.decisions.listLatestByRetro(404)).toEqual([])
      expect(await store.decisions.listForRecord(404, 'r-nope')).toEqual([])
      expect(await store.decisions.listLatestForEachRetro()).toEqual([])
    })
  })
}
