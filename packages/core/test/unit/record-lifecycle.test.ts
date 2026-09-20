import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import type {
  RecordLifecycleState,
  RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
import { lifecycleActPermitted } from '#domain/services/record-lifecycle.service'
import { createHarness, type Harness } from '../support/harness'

/**
 * `SetRecordLifecycleUseCase` — the record's second axis: once the AI fixes an
 * issue, there needs to be a way to show it was resolved, citing a commit id or
 * a GitHub issue or something else as a reference so it is easy to see.
 */
describe('record lifecycle', () => {
  let harness: Harness
  let retroId: number
  let rid: string

  beforeEach(async () => {
    harness = createHarness()
    const session = await harness.session()
    const created = await harness.revision(session.id, [{}, {}])
    retroId = created.retroId
    rid = created.revision.records[0]?.rid ?? ''
  })

  const set = (
    input: {
      readonly actor?: Actor
      readonly rid?: string
      readonly status: RecordLifecycleStatus
      readonly refs?: readonly string[]
      readonly note?: string
    },
    retro = retroId,
  ) =>
    harness.app.records.setLifecycle.execute({
      actor: input.actor ?? 'ai',
      retro: { retroId: retro },
      rid: input.rid ?? rid,
      status: input.status,
      refs: input.refs,
      note: input.note,
    })

  const entries = async () =>
    (await harness.store.recordLifecycle.listLatestForEachRecord()).filter(
      (entry) => entry.retroId === retroId,
    )

  describe('resolving', () => {
    test('writes the first version, with its references and its author', async () => {
      const result = await set({ status: 'resolved', refs: ['a1b2c3d'], note: 'Landed on main.' })

      expect(result).toEqual({
        retroId,
        rid,
        version: 1,
        lifecycle: {
          status: 'resolved',
          refs: ['a1b2c3d'],
          note: 'Landed on main.',
          actor: 'ai',
          at: harness.clock.iso(),
        },
      })
    })

    test('takes several references, in the order they were given', async () => {
      const result = await set({
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42', 'RETRO-17'],
      })

      expect(result.lifecycle.refs).toEqual([
        'a1b2c3d',
        'https://github.com/o/r/pull/42',
        'RETRO-17',
      ])
    })

    /**
     * A reference is a token that gets pasted out of a terminal, so it arrives
     * with whitespace more often than not — and `" abc123"` and `"abc123"` are
     * the same commit. It is the one field in the system that is trimmed; prose
     * everywhere else travels verbatim.
     */
    test('trims each reference, and refuses one that is only whitespace', async () => {
      expect((await set({ status: 'resolved', refs: ['  a1b2c3d  '] })).lifecycle.refs).toEqual([
        'a1b2c3d',
      ])

      await expect(set({ status: 'resolved', refs: ['   '] })).rejects.toBeInstanceOf(
        ValidationError,
      )
    })

    /**
     * The evidence is the point of the feature, so a resolve that cites nothing
     * is refused rather than stored as a bare claim.
     */
    test('refuses a resolve that cites no reference at all', async () => {
      await expect(set({ status: 'resolved', refs: [] })).rejects.toBeInstanceOf(ValidationError)
      await expect(set({ status: 'resolved' })).rejects.toBeInstanceOf(ValidationError)
      expect(await entries()).toEqual([])
    })

    /**
     * A resolve is only reachable from `open` (`LIFECYCLE_ACT_FROM`). Resolving
     * an already-resolved record used to append a second resolve, which was the
     * only way to amend the references a fix cited; it is a `ConflictError` now,
     * on the standing the never-resolved reopen set — a caller taking an act
     * from a state that does not permit it believes the store says something it
     * does not. Reopen first, and the history reads as the two acts it was.
     */
    test('refuses a resolve on a record that is already resolved', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      await expect(set({ status: 'resolved', refs: ['deadbee'] })).rejects.toBeInstanceOf(
        ConflictError,
      )
      expect((await harness.store.recordLifecycle.findLatest(retroId, rid))?.version).toBe(1)
    })
  })

  describe('reopening', () => {
    test('appends a version and leaves the record open again', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      const reopened = await set({ status: 'reopened', note: 'The lock came back on Tuesday.' })

      expect(reopened.version).toBe(2)
      expect(reopened.lifecycle).toEqual({
        status: 'open',
        refs: [],
        note: 'The lock came back on Tuesday.',
        actor: 'ai',
        at: harness.clock.iso(),
      })
    })

    /**
     * Not a silent no-op. There is nothing to take back, and answering "done"
     * to an act that did nothing is the quiet inference this product refuses
     * everywhere else — the caller believed the record was resolved, and it was
     * not.
     */
    test('refuses to reopen a record that was never resolved', async () => {
      await expect(set({ status: 'reopened' })).rejects.toBeInstanceOf(ConflictError)
      expect(await entries()).toEqual([])
    })

    /**
     * Refused rather than dropped: refs are present exactly when a record is
     * resolved, so refs riding on an open record would be references to the fix
     * that did **not** hold, shown as if they were the fix that did.
     */
    test('refuses references on a reopen — they belong to the resolve', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      await expect(set({ status: 'reopened', refs: ['deadbee'] })).rejects.toBeInstanceOf(
        ValidationError,
      )
      expect((await entries())[0]?.version).toBe(1)
    })

    test('a record can be resolved, reopened and resolved again', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })
      await set({ status: 'reopened' })
      const third = await set({ status: 'resolved', refs: ['deadbee'] })

      expect(third.version).toBe(3)
      expect(third.lifecycle.status).toBe('resolved')
      expect(third.lifecycle.refs).toEqual(['deadbee'])
      // Three acts, not one act performed three times: the outbox is where "the
      // first one still happened" is observable, because no read path shows a
      // record's lifecycle history and none is needed yet.
      expect((await harness.eventNames()).filter((name) => name === 'RecordResolved')).toHaveLength(
        2,
      )
    })
  })

  /**
   * A type called `archived`: the user can unarchive it, and by default every
   * other approved record is a normal record that the user can archive at will.
   */
  describe('archiving', () => {
    const archive = (extra: { readonly note?: string } = {}) =>
      set({ status: 'archived', actor: 'human', ...extra })

    test('puts an open record out of the way, citing nothing', async () => {
      const archived = await archive({ note: 'Superseded by the rewrite.' })

      expect(archived).toEqual({
        retroId,
        rid,
        version: 1,
        lifecycle: {
          status: 'archived',
          refs: [],
          note: 'Superseded by the rewrite.',
          actor: 'human',
          at: harness.clock.iso(),
        },
      })
    })

    /**
     * Refused rather than dropped, exactly as a reopen's are: references are
     * evidence that something was fixed, and archiving makes no such claim.
     */
    test('refuses references — they belong to the resolve', async () => {
      await expect(
        set({ status: 'archived', actor: 'human', refs: ['a1b2c3d'] }),
      ).rejects.toBeInstanceOf(ValidationError)
      expect(await entries()).toEqual([])
    })

    /** A user can archive a record at will — including one already fixed. */
    test('takes a resolved record out of the way too', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      const archived = await archive()
      expect(archived.version).toBe(2)
      expect(archived.lifecycle.status).toBe('archived')
      // The resolve's references are history, not the state of an archived
      // record — the same rule a reopen obeys.
      expect(archived.lifecycle.refs).toEqual([])
    })

    test('unarchiving puts it back where it was owed', async () => {
      await archive()

      const back = await set({ status: 'unarchived', actor: 'human' })
      expect(back.version).toBe(2)
      expect(back.lifecycle.status).toBe('open')
    })

    /**
     * **Born archived, and unarchived at version 1.** A declined record is
     * archived by derivation with no row anywhere, so the first act ever taken
     * on it is still the first version — which is what proves nothing was
     * written at close on its behalf.
     */
    test('unarchives a record born archived, writing its first version', async () => {
      await harness.decide(retroId, rid, 'declined')
      expect(await entries()).toEqual([])

      const back = await set({ status: 'unarchived', actor: 'human' })
      expect(back.version).toBe(1)
      expect(back.lifecycle.status).toBe('open')
    })

    test('refuses to archive a record that is already archived', async () => {
      await archive()

      await expect(archive()).rejects.toBeInstanceOf(ConflictError)
      expect((await entries())[0]?.version).toBe(1)
    })

    /** A declined record is archived before anybody touches it, so this is the same refusal. */
    test('refuses to archive a record born archived', async () => {
      await harness.decide(retroId, rid, 'declined')

      await expect(archive()).rejects.toBeInstanceOf(ConflictError)
      expect(await entries()).toEqual([])
    })

    test('refuses to unarchive a record that is not archived', async () => {
      await expect(set({ status: 'unarchived', actor: 'human' })).rejects.toBeInstanceOf(
        ConflictError,
      )

      await set({ status: 'resolved', refs: ['a1b2c3d'] })
      await expect(set({ status: 'unarchived', actor: 'human' })).rejects.toBeInstanceOf(
        ConflictError,
      )
    })

    /** An archived record is out of the way, not open: neither of the other acts reaches it. */
    test('refuses to resolve or reopen an archived record', async () => {
      await archive()

      await expect(set({ status: 'resolved', refs: ['a1b2c3d'] })).rejects.toBeInstanceOf(
        ConflictError,
      )
      await expect(set({ status: 'reopened' })).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * **The actor rule, per act** — the human can archive and unarchive at
     * will. It is asserted here as well as in `actor-invariants.test.ts`
     * because this is the file that says what each act means, and the refusal
     * is part of what `archived` means.
     */
    test('is the human’s, on the one table the AI may otherwise write', async () => {
      await expect(set({ status: 'archived', actor: 'ai' })).rejects.toBeInstanceOf(
        ForbiddenActorError,
      )
      await expect(set({ status: 'unarchived', actor: 'ai' })).rejects.toBeInstanceOf(
        ForbiddenActorError,
      )
      expect(await entries()).toEqual([])
      expect(await harness.eventNames()).not.toContain('RecordArchived')
    })

    /** Refused before the store is asked anything — a rid that does not exist still refuses. */
    test('refuses the AI before it looks at the record at all', async () => {
      await expect(set({ status: 'archived', actor: 'ai', rid: 'r-ghost' })).rejects.toBeInstanceOf(
        ForbiddenActorError,
      )
    })
  })

  /**
   * **The derivation, swept**: every verdict a record can carry, crossed with
   * every history of acts it can have, read as the state the page shows.
   *
   * The verdict only speaks while there is no entry — that is the born-archived
   * rule and the whole of it. One act, and the entry in force is the only thing
   * that answers, which is what keeps an unarchived declined record `open`
   * instead of springing back to `archived` behind its reader.
   */
  describe('where a record stands', () => {
    /** A history of acts, and the state the last one leaves the record in. */
    const HISTORIES: readonly {
      readonly label: string
      readonly acts: readonly RecordLifecycleStatus[]
      readonly stands: RecordLifecycleState
    }[] = [
      { label: 'nothing at all', acts: [], stands: 'open' },
      { label: 'a resolve', acts: ['resolved'], stands: 'resolved' },
      { label: 'a resolve and a reopen', acts: ['resolved', 'reopened'], stands: 'open' },
      { label: 'an archive', acts: ['archived'], stands: 'archived' },
      { label: 'an archive and an unarchive', acts: ['archived', 'unarchived'], stands: 'open' },
      { label: 'a resolve and an archive', acts: ['resolved', 'archived'], stands: 'archived' },
      { label: 'an unarchive', acts: ['unarchived'], stands: 'open' },
    ]

    /**
     * `hold` is here because human data is append-only: it stopped being a
     * verdict anyone can give (`r-hold-semantics`), and a store written before
     * that still holds one. It is not `declined`, so it is born open — which is
     * the reading a row nobody can write any more has to keep having.
     */
    const VERDICTS: readonly {
      readonly verdict: DecisionState
      readonly born: RecordLifecycleState
    }[] = [
      { verdict: 'pending', born: 'open' },
      { verdict: 'approved', born: 'open' },
      { verdict: 'revise', born: 'open' },
      { verdict: 'hold', born: 'open' },
      { verdict: 'declined', born: 'archived' },
    ]

    for (const { verdict, born } of VERDICTS) {
      for (const { label, acts, stands } of HISTORIES) {
        const first = acts[0]
        /**
         * Where the record is born decides which histories it can even have: a
         * declined record starts archived, so a resolve is refused on it and an
         * unarchive is not, and the reverse holds everywhere else. That
         * unreachability is part of the machine rather than a gap in the sweep,
         * so the cell asserts the refusal instead of being skipped.
         */
        const reachable = first === undefined || lifecycleActPermitted(first, born)
        const expected = acts.length === 0 ? born : stands

        test(`${verdict} + ${label} is ${reachable ? expected : 'refused'}`, async () => {
          if (verdict !== 'pending') await decideAs(verdict)

          if (first !== undefined && !reachable) {
            await expect(
              set({ status: first, actor: 'human', refs: refsFor(first) }),
            ).rejects.toBeInstanceOf(ConflictError)
            return
          }

          for (const act of acts) await set({ status: act, actor: 'human', refs: refsFor(act) })

          // Read back through `records.listAll`, which is the shape the page
          // renders: a derivation that were right in the service and wrong in
          // the read model would still be wrong on screen.
          const { records } = await harness.app.records.listAll.execute({ actor: 'human' })
          expect(records.find((record) => record.rid === rid)?.lifecycle.status).toBe(expected)

          // And through the per-retro projection, which is the other reader of
          // the same rows (`r-lifecycle-projection-gap`). Asserting the same
          // value twice is the point: this projection answered `null` on a
          // populated store for a long stretch because nothing held the two to
          // each other.
          const perRetro = await harness.app.records.list.execute({
            actor: 'human',
            retro: { retroId },
          })
          expect(perRetro.records.find((view) => view.record.rid === rid)?.lifecycle.status).toBe(
            expected,
          )
        })
      }
    }

    /** Only a resolve carries references; the schema refuses them on the rest. */
    function refsFor(act: RecordLifecycleStatus): readonly string[] | undefined {
      return act === 'resolved' ? ['a1b2c3d'] : undefined
    }

    /**
     * `hold` cannot be submitted through `decisions.record` any more
     * (`decisionVerdictSchema`), so the one legacy verdict is written the way a
     * store that predates the narrowing holds it: straight into the table.
     */
    async function decideAs(verdict: DecisionState): Promise<void> {
      if (verdict !== 'hold') {
        await harness.decide(retroId, rid, verdict)
        return
      }
      await harness.holdVerdict(retroId, rid)
    }
  })

  /**
   * **The two projections answer the same thing**
   * (`r-lifecycle-projection-gap`).
   *
   * Found in use: after a whole retrospective's records were resolved, `record
   * list --retro <n>` reported no lifecycle at all while a direct table read
   * showed every one of them resolved with its refs — so the natural check
   * after a batch resolve read as if nothing had been written, which is the
   * AI's own read-back channel lying to it.
   *
   * The sweep above pins `status` across all 35 verdict × history cells. This
   * pins the **whole** entry — refs, note, actor, at — because a projection
   * that derived the status and dropped the references would satisfy the sweep
   * and still lose the thing the feature exists for: citing a commit id or a
   * GitHub issue or something else as a reference so it is easy to see.
   */
  describe('the two record projections agree', () => {
    /** The same record, read both ways: flat cross-retro, and per-retro. */
    async function bothWays(): Promise<{
      listAll: unknown
      perRetro: unknown
    }> {
      const flat = await harness.app.records.listAll.execute({ actor: 'human' })
      const perRetro = await harness.app.records.list.execute({
        actor: 'human',
        retro: { retroId },
      })
      return {
        listAll: flat.records.find((record) => record.rid === rid)?.lifecycle,
        perRetro: perRetro.records.find((view) => view.record.rid === rid)?.lifecycle,
      }
    }

    test('a resolved record carries the same refs, note, actor and moment on both', async () => {
      await set({
        status: 'resolved',
        refs: ['a1b2c3d', 'https://example.test/pull/7'],
        note: 'Landed on main.',
        actor: 'ai',
      })

      const { listAll, perRetro } = await bothWays()

      // Asserted against the value rather than only against each other: two
      // projections that were both wrong in the same way would agree.
      expect(listAll).toEqual({
        status: 'resolved',
        refs: ['a1b2c3d', 'https://example.test/pull/7'],
        note: 'Landed on main.',
        actor: 'ai',
        at: harness.clock.now().toISOString(),
      })
      expect(perRetro).toEqual(listAll)
    })

    /**
     * The archived derivation the record names explicitly. A declined record is
     * born archived and **no row says so** (`lifecycle.md`), so a projection that
     * joined the table and stopped there would answer `open` here — agreeing with
     * nothing and with the page least of all.
     */
    test('a declined record reads archived on both, with no entry behind it', async () => {
      await harness.decide(retroId, rid, 'declined')

      const { listAll, perRetro } = await bothWays()

      expect(listAll).toEqual({
        status: 'archived',
        refs: [],
        note: undefined,
        actor: undefined,
        at: undefined,
      })
      expect(perRetro).toEqual(listAll)
    })

    test('a record nobody has touched reads open on both', async () => {
      const { listAll, perRetro } = await bothWays()

      expect(listAll).toEqual({
        status: 'open',
        refs: [],
        note: undefined,
        actor: undefined,
        at: undefined,
      })
      expect(perRetro).toEqual(listAll)
    })

    /**
     * A rid is minted per retrospective and is not globally unique
     * (`record-lifecycle.service.ts`), so the per-retro join has to be keyed on
     * the pair like the flat one is. Keyed on the rid alone this passes every
     * test above and shows one retrospective's resolution on another's record.
     */
    test('the same rid in two retrospectives does not borrow the other’s lifecycle', async () => {
      const second = await harness.session('uuid-second')
      const created = await harness.revision(second.id, [{ rid, num: 1 }])
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      const other = await harness.app.records.list.execute({
        actor: 'human',
        retro: { retroId: created.retroId },
      })

      expect(other.records.find((view) => view.record.rid === rid)?.lifecycle).toEqual({
        status: 'open',
        refs: [],
        note: undefined,
        actor: undefined,
        at: undefined,
      })
    })
  })

  /**
   * **The deliberate relaxation of the actor rule.** Every other append-only
   * table is single-writer and asserts so on its first line; this one is
   * written by the AI marking what it fixed and by the human marking from the
   * browser, by design. The `actor` column is what keeps the two readable apart
   * — on the two acts that take both, which is `archiving` above for the two
   * that do not.
   */
  test('both actors may write, and the row records which one did', async () => {
    const written = await set({ status: 'resolved', refs: ['a1b2c3d'], actor: 'ai' })
    expect(written.lifecycle.actor).toBe('ai')

    const byHuman = await set({ status: 'reopened', actor: 'human' })
    expect(byHuman.lifecycle.actor).toBe('human')
  })

  describe('the records it will accept', () => {
    test('is a NotFound for a retrospective that does not exist', async () => {
      await expect(set({ status: 'resolved', refs: ['a1b2c3d'] }, 404)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })

    test('is a NotFound for a rid the retrospective does not have', async () => {
      await expect(
        set({ status: 'resolved', refs: ['a1b2c3d'], rid: 'r-ghost' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    /**
     * The latest draft is the retrospective: it is what `records.listAll` lists
     * and what the export exports. A record a later draft withdrew is not part
     * of the outcome, and resolving one would write a row nothing displays.
     */
    test('is a NotFound for a record the latest draft withdrew', async () => {
      const session = await harness.session('uuid-withdrawn')
      const created = await harness.revision(session.id, [{}, {}])
      await harness.finishRound(created.retroId)
      await harness.app.revisions.create.execute({
        actor: 'ai',
        session: session.id,
        revision: { records: [] },
      })

      await expect(
        harness.app.records.setLifecycle.execute({
          actor: 'ai',
          retro: { retroId: created.retroId },
          rid: 'r-record-1',
          status: 'resolved',
          refs: ['a1b2c3d'],
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  /**
   * **The exception `finish-lock.service.ts` anticipated.** Every human write
   * on a finished retrospective refuses; this one does not, and it has to not —
   * even after a retro has been closed, its issues still need metadata attached
   * so their life cycle can be managed.
   *
   * It endangers nothing the finish lock protects. That rule exists so an export
   * cannot grow new feedback behind its reader, and lifecycle is not exported
   * (A8) — the document taken from this retrospective is the same document
   * before and after.
   */
  test('is reachable after the review has closed — for both actors', async () => {
    const rids = ['r-record-1', 'r-record-2']
    for (const each of rids) await harness.decide(retroId, each, 'approved')
    await harness.closeReview(retroId)

    const byAi = await set({ status: 'resolved', refs: ['a1b2c3d'], rid: rids[0] })
    expect(byAi.lifecycle.status).toBe('resolved')

    const byHuman = await set({
      status: 'resolved',
      refs: ['deadbee'],
      rid: rids[1],
      actor: 'human',
    })
    expect(byHuman.lifecycle.status).toBe('resolved')
  })

  describe('the outbox', () => {
    /**
     * Two names rather than one carrying a flag, the way `ThreadResolved` /
     * `ThreadReopened` and `HoldSet` / `HoldCleared` are — and with a third
     * reason here: either actor may append one, so a consumer watching for "the
     * AI finished something" reads the name and the scope rather than unpacking
     * a payload.
     */
    test('appends a name per act, in the same unit of work as the row', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })
      await set({ status: 'reopened' })

      expect(await harness.eventNames()).toEqual([
        'SessionCreated',
        'RetrospectiveStarted',
        'RevisionCreated',
        'RecordResolved',
        'RecordReopened',
      ])
    })

    /**
     * Scoped to the retrospective, the session and the record — which is what
     * lets `events.onRetro` fan it out to a page watching that retro, and what a
     * cross-retro reader filters on.
     *
     * **No `revisionN`**, deliberately, for the reason a thread resolution has
     * none: a record's lifecycle outlives every redraft of it, and the fix
     * landed against the retrospective rather than against a draft of it.
     */
    test('carries the retro, the session and the rid — and no revision', async () => {
      await set({ status: 'resolved', refs: ['a1b2c3d'] })

      const { events } = await harness.app.events.list.execute({
        actor: 'ai',
        retro: { retroId },
        names: ['RecordResolved'],
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        name: 'RecordResolved',
        retroId,
        rid,
        revisionN: undefined,
        at: harness.clock.iso(),
        data: { version: 1, actor: 'ai' },
      })
      expect(events[0]?.sessionId).toBeDefined()
    })

    /** A refused write leaves nothing behind — not the row, and not the event. */
    test('appends nothing when the write is refused', async () => {
      const before = await harness.eventNames()

      await expect(set({ status: 'resolved', refs: [] })).rejects.toBeInstanceOf(ValidationError)
      await expect(set({ status: 'reopened' })).rejects.toBeInstanceOf(ConflictError)

      expect(await harness.eventNames()).toEqual(before)
      expect(await entries()).toEqual([])
    })
  })
})
