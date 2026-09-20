import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '@retro/core'
import { EXIT } from '#errors'
import { aRevisionDraft, type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/**
 * **The lane commands' `--json` shapes, locked** (testing.md suite 3) — the
 * queue an agent picks work off, the record it reads before starting, the
 * history it searches, and the marker it puts up while it works.
 *
 * These assertions are the public contract: the plugin shells out and reads
 * exactly these keys, so breaking one is a major version. `toEqual` on
 * whole objects rather than a few properties is deliberate — an extra key is a
 * change to the contract too, and it should have to be written down here before
 * it ships. Each shape also has a **sorted key lock** beside it, because
 * `toEqual` on one fixture leaves the shape free to move on a row the fixture
 * does not happen to reach.
 */
describe('the record lane', () => {
  let cli: Cli

  /** Session alpha's first retrospective: one approved record and one declined. */
  let past: number
  /** Its second: one resolved, one claimed, one archived. */
  let recent: number
  /** Session beta's, still under review — approved work that is not yet lane work. */
  let open: number

  let ids: Map<string, number>

  const idOf = (rid: string): number => ids.get(rid) ?? 0

  beforeEach(async () => {
    cli = createCli()
    ids = new Map<string, number>()

    const alpha = await aSession('uuid-alpha')
    const beta = await aSession('uuid-beta')

    past = await aRevision(
      alpha,
      aRevisionDraft([
        { rid: 'r-stale-lock', num: 1, title: 'Deploy blocked on a stale lock file' },
        { rid: 'r-noisy-hook', num: 2, title: 'The hook shouts on every commit' },
      ]),
    )
    await app().threads.addComment.execute({
      actor: 'human',
      retro: { retroId: past },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'This cost me the whole afternoon.',
    })
    await app().decisions.record.execute({
      actor: 'human',
      retro: { retroId: past },
      rid: 'r-stale-lock',
      decision: { state: 'approved', selectedSolution: 2, reviewerNote: 'Start with this one.' },
    })
    await app().decisions.record.execute({
      actor: 'human',
      retro: { retroId: past },
      rid: 'r-noisy-hook',
      decision: { state: 'declined' },
    })
    await closeReview(past)

    recent = await aRevision(
      alpha,
      aRevisionDraft([
        { rid: 'r-silent-tailer', num: 1, title: 'The tailer stops without saying so' },
        { rid: 'r-flaky-test', num: 2, title: 'One test fails once a week' },
        { rid: 'r-wide-export', num: 3, title: 'The export carries a column nothing reads' },
      ]),
    )
    await closeReview(recent)

    open = await aRevision(
      beta,
      aRevisionDraft([{ rid: 'r-late-badge', num: 1, title: 'The badge arrives a beat late' }]),
    )
    await app().decisions.record.execute({
      actor: 'human',
      retro: { retroId: open },
      rid: 'r-late-badge',
      decision: { state: 'approved' },
    })

    for (const [retroId, rid] of [
      [past, 'r-stale-lock'],
      [past, 'r-noisy-hook'],
      [recent, 'r-silent-tailer'],
      [recent, 'r-flaky-test'],
      [recent, 'r-wide-export'],
      [open, 'r-late-badge'],
    ] as const) {
      ids.set(rid, (await cli.store.recordIds.findByRecord(retroId, rid))?.id ?? 0)
    }

    await cli.run([
      'record',
      'resolve',
      'r-silent-tailer',
      '--retro',
      String(recent),
      '--ref',
      'a1b2c3d',
      '--json',
    ])
    await cli.run(['record', 'claim', String(idOf('r-flaky-test')), '--json'])
    // Archiving is the human's, and the CLI is refused it on purpose — so the
    // one archived row in this fixture is written the way the browser writes it.
    await app().records.setLifecycle.execute({
      actor: 'human',
      retro: { retroId: recent },
      rid: 'r-wide-export',
      status: 'archived',
    })
  })

  const app = () => createApp(cli.store, { clock: cli.clock })

  async function aSession(uuid: string): Promise<number> {
    const result = await cli.run([
      'session',
      'create',
      '--claude-session',
      uuid,
      '--project',
      'retro',
      '--cwd',
      '/Users/sample/Developer/retro',
      '--json',
    ])
    return result.jsonAs<{ sessionId: number }>().sessionId
  }

  async function aRevision(sessionId: number, draft: string): Promise<number> {
    const file = cli.file(`revision-${sessionId}-${Date.now()}.json`, draft)
    const result = await cli.run([
      'revision',
      'create',
      '--session',
      String(sessionId),
      '--file',
      file,
      '--json',
    ])
    return result.jsonAs<{ retroId: number }>().retroId
  }

  /**
   * The human's half of a round and the AI's close — through the App, because
   * finishing is human-only and has no command, which is the point of it.
   */
  async function closeReview(retroId: number): Promise<void> {
    const { records } = await app().records.list.execute({ actor: 'human', retro: { retroId } })
    for (const view of records) {
      if (view.decision.state !== 'pending') continue
      await app().decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: view.record.rid,
        decision: { state: 'approved' },
      })
    }
    await app().review.finish.execute({ actor: 'human', retro: { retroId } })
    await app().review.close.execute({ actor: 'ai', retro: { retroId } })
  }

  type Row = {
    recordId: number
    retroId: number
    retro: number
    sessionId: number
    title: string
    slug: string
    problem: string
    rootCause: { whatHappened: string; whys: string[]; root: string }
    diagnosticData: string | null
    humanWords: { verbatim: string; cleaned: string; context: string | null }[]
    workaround: string
    ownerWords: string[]
    selectedSolution: {
      index: number
      level: number | string
      title: string
      body: string
      footprint: string[]
    }
    involvement: string
    relations: { recordId: number; kind: string; direction: string }[]
    claim: { claimedAt: string; actor: string } | null
    resolved: boolean
    lifecycle: {
      state: string
      resolvedAt: string | null
      ref: string | null
      refs: string[]
      claimedAt: string | null
    }
  }

  const rowsOf = (result: { stdout: readonly string[] }): Row[] =>
    JSON.parse(result.stdout[0] as string) as Row[]

  describe('record queue', () => {
    /**
     * **The queue's whole definition, in one assertion and one row.** Approved,
     * unresolved, not archived, in a retrospective the human finished — with
     * everything an agent needs to start: his words, the solution he picked, and
     * the files it touches.
     */
    test('returns the approved, unresolved work of finished retrospectives', async () => {
      const result = await cli.run(['record', 'queue', '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(rowsOf(result)).toEqual([
        {
          recordId: idOf('r-stale-lock'),
          retroId: past,
          retro: 1,
          sessionId: 1,
          title: 'Deploy blocked on a stale lock file',
          slug: 'r-stale-lock',
          problem: 'The deploy waited 40 minutes on a lock nothing held.',
          rootCause: {
            whatHappened: 'The lock file outlived the process that took it.',
            whys: ['The process was killed', 'The lock had no owner check'],
            root: 'Locks are advisory with no liveness check.',
          },
          // The evidence the AI gathered while it was diagnosing — the field the
          // schema now demands of every record, travelling with the work.
          diagnosticData:
            '- **The lock file:** `stage.lock`, 0 bytes, written 40 minutes before the deploy.\n' +
            '- **The holder:** `ps 8123` — no such process.',
          // The record's own quotes and what was done at the time. Not
          // `ownerWords`, below: that is what the human wrote at review time.
          humanWords: [
            {
              verbatim: 'this thing has been sitting there for ages',
              cleaned: 'This has been sitting there for a long time.',
              context: 'while watching the deploy log',
            },
          ],
          workaround: 'Delete the lock file by hand.',
          // The note written with the verdict first, then what was said on the
          // record's threads — one field, because they are one thing to whoever
          // is about to act on them.
          ownerWords: ['Start with this one.', 'This cost me the whole afternoon.'],
          selectedSolution: {
            index: 2,
            level: 2,
            title: 'Write the holder PID.',
            body: '- **Write the holder PID.** Check liveness before waiting on the lock.',
            footprint: ['scripts/deploy.sh', 'lib/lock.ts'],
          },
          involvement: 'pull-request',
          relations: [],
          claim: null,
          resolved: false,
          lifecycle: {
            state: 'approved',
            resolvedAt: null,
            ref: null,
            refs: [],
            claimedAt: null,
          },
        },
        {
          recordId: idOf('r-flaky-test'),
          retroId: recent,
          retro: 2,
          sessionId: 1,
          title: 'One test fails once a week',
          slug: 'r-flaky-test',
          problem: 'The deploy waited 40 minutes on a lock nothing held.',
          rootCause: {
            whatHappened: 'The lock file outlived the process that took it.',
            whys: ['The process was killed', 'The lock had no owner check'],
            root: 'Locks are advisory with no liveness check.',
          },
          diagnosticData:
            '- **The lock file:** `stage.lock`, 0 bytes, written 40 minutes before the deploy.\n' +
            '- **The holder:** `ps 8123` — no such process.',
          // He wrote nothing on this one at review time, and his quotes are
          // still here — the two lists answer different questions.
          humanWords: [
            {
              verbatim: 'this thing has been sitting there for ages',
              cleaned: 'This has been sitting there for a long time.',
              context: 'while watching the deploy log',
            },
          ],
          workaround: 'Delete the lock file by hand.',
          ownerWords: [],
          selectedSolution: {
            index: 2,
            level: 2,
            title: 'Write the holder PID.',
            body: '- **Write the holder PID.** Check liveness before waiting on the lock.',
            footprint: ['scripts/deploy.sh', 'lib/lock.ts'],
          },
          involvement: 'pull-request',
          relations: [],
          // **A claimed record stays on the queue**, marker showing: whoever is
          // reading it needs to see what is in progress rather than be told
          // there is nothing there.
          claim: { claimedAt: '2026-08-23T09:00:00.000Z', actor: 'ai' },
          resolved: false,
          lifecycle: {
            state: 'in-progress',
            resolvedAt: null,
            ref: null,
            refs: [],
            claimedAt: '2026-08-23T09:00:00.000Z',
          },
        },
      ])
    })

    /** The shape, key for key, so a row this fixture never reaches cannot drift. */
    test('every row carries exactly these keys', async () => {
      const [row] = rowsOf(await cli.run(['record', 'queue', '--json']))

      expect(Object.keys(row ?? {}).sort()).toEqual([
        'claim',
        'diagnosticData',
        'humanWords',
        'involvement',
        'lifecycle',
        'ownerWords',
        'problem',
        'recordId',
        'relations',
        'resolved',
        'retro',
        'retroId',
        'rootCause',
        'selectedSolution',
        'sessionId',
        'slug',
        'title',
        'workaround',
      ])
      expect(Object.keys(row?.lifecycle ?? {}).sort()).toEqual([
        'claimedAt',
        'ref',
        'refs',
        'resolvedAt',
        'state',
      ])
      expect(Object.keys(row?.selectedSolution ?? {}).sort()).toEqual([
        'body',
        'footprint',
        'index',
        'level',
        'title',
      ])
    })

    test('leaves out the approved records of a review the human has not finished', async () => {
      expect(
        rowsOf(await cli.run(['record', 'queue', '--json'])).map((row) => row.slug),
      ).not.toContain('r-late-badge')

      await app().review.finish.execute({ actor: 'human', retro: { retroId: open } })

      expect(rowsOf(await cli.run(['record', 'queue', '--json'])).map((row) => row.slug)).toContain(
        'r-late-badge',
      )
    })

    test('is an empty array on a stage where nothing has been finished', async () => {
      const empty = createCli()
      const result = await empty.run(['record', 'queue', '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.stdout).toEqual(['[]'])
    })

    /** One line per row, and the two markers a person scans for. */
    test('prints one line per record, marking what is in progress', async () => {
      const result = await cli.run(['record', 'queue'])

      expect(result.code).toBe(EXIT.ok)
      const printed = result.stdout.join('\n')
      expect(printed).toContain(
        `#${idOf('r-stale-lock')} [approved] r-stale-lock — Deploy blocked on a stale lock file · L2 · pull-request · retro ${past} (#1 of session 1)`,
      )
      expect(printed).toContain(`#${idOf('r-flaky-test')} [approved] [in progress] r-flaky-test`)
    })
  })

  describe('record get', () => {
    test('answers with the row plus the retrospective it came from', async () => {
      const result = await cli.run(['record', 'get', String(idOf('r-stale-lock')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toMatchObject({
        recordId: idOf('r-stale-lock'),
        slug: 'r-stale-lock',
        resolved: false,
        retrospective: {
          retroId: past,
          retro: 1,
          sessionId: 1,
          claudeSession: 'uuid-alpha',
          cwd: '/Users/sample/Developer/retro',
          finishedAt: '2026-08-23T09:00:00.000Z',
          closed: true,
        },
      })
      expect(Object.keys(result.json()).sort()).toEqual([
        'claim',
        'diagnosticData',
        'humanWords',
        'involvement',
        'lifecycle',
        'ownerWords',
        'problem',
        'recordId',
        'relations',
        'resolved',
        'retro',
        'retroId',
        'retrospective',
        'rootCause',
        'selectedSolution',
        'sessionId',
        'slug',
        'title',
        'workaround',
      ])
      expect(
        Object.keys((result.json() as { retrospective: object }).retrospective).sort(),
      ).toEqual(['claudeSession', 'closed', 'cwd', 'finishedAt', 'retro', 'retroId', 'sessionId'])
    })

    /** The record after the work landed: what shows it, and no marker left up. */
    test('reads a resolved record as resolved, with its references', async () => {
      const result = await cli.run(['record', 'get', String(idOf('r-silent-tailer')), '--json'])

      expect(result.json()).toMatchObject({
        resolved: true,
        claim: null,
        lifecycle: {
          state: 'resolved',
          resolvedAt: '2026-08-23T09:00:00.000Z',
          ref: 'a1b2c3d',
          refs: ['a1b2c3d'],
          claimedAt: null,
        },
      })
    })

    test('is exit 3 for a number nothing was minted for', async () => {
      const result = await cli.run(['record', 'get', '404', '--json'])

      expect(result.code).toBe(EXIT.notFound)
      expect(result.stdout).toEqual([])
    })

    test('is exit 2 when handed a rid instead of the number', async () => {
      const result = await cli.run(['record', 'get', 'r-stale-lock', '--json'])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('#globalId')
      expect(result.stdout).toEqual([])
    })
  })

  /**
   * **The words the record was filed with reach the row**
   * (`r-lane-row-omits-human-words`).
   *
   * A record holds two different things a reader calls "the human's words":
   * `humanWords`, the quotes the record was drafted from, and `ownerWords`, what
   * the human wrote at review time — the note with the verdict and the comments.
   * The row carried only the second, so a team reading a record with seven
   * quotes and no comment saw `ownerWords: []` and reported the quotes lost.
   *
   * Every expectation here is read off **the draft the record was filed from**
   * rather than off a literal copied in. `r-lifecycle-projection-gap`
   * pinned one projection against another; what nothing pinned was the
   * projection against the record, which is how a field missing from all three
   * commands at once stayed invisible.
   */
  describe('the words the record was filed with', () => {
    type Filed = {
      rid: string
      humanWords: { verbatim: string; cleaned: string; context?: string }[]
      workaround: string
    }

    const draftOf = (draft: string): Filed[] => (JSON.parse(draft) as { records: Filed[] }).records

    /** What every record of this fixture was filed with (`aRevisionDraft`). */
    const filed = (): Filed => draftOf(aRevisionDraft())[0] as Filed

    /** The row's spelling of a filed quote: an absent `context` is `null`, never a missing key. */
    const onTheRow = (words: Filed['humanWords']): Row['humanWords'] =>
      words.map((said) => ({
        verbatim: said.verbatim,
        cleaned: said.cleaned,
        context: said.context ?? null,
      }))

    test('record get reads back the quotes and the workaround', async () => {
      const result = await cli.run(['record', 'get', String(idOf('r-stale-lock')), '--json'])
      const row = result.jsonAs<Row>()

      expect(result.code).toBe(EXIT.ok)
      // The fixture's quote is a real one, so presence implies correctness.
      expect(filed().humanWords).toHaveLength(1)
      expect(row.humanWords).toEqual(onTheRow(filed().humanWords))
      expect(row.workaround).toBe(filed().workaround)
    })

    test('record queue carries them on every row', async () => {
      const rows = rowsOf(await cli.run(['record', 'queue', '--json']))

      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.humanWords).toEqual(onTheRow(filed().humanWords))
        expect(row.workaround).toBe(filed().workaround)
      }
    })

    test('record list --all carries them on every row, whatever its state', async () => {
      const rows = rowsOf(await cli.run(['record', 'list', '--all', '--json']))

      expect(rows.map((row) => row.slug)).toContain('r-noisy-hook')
      for (const row of rows) {
        expect(row.humanWords).toEqual(onTheRow(filed().humanWords))
        expect(row.workaround).toBe(filed().workaround)
      }
    })

    /**
     * **The incident itself.** `r-flaky-test` has that shape: quotes on the
     * record, and not one word from the human at review time. Its `ownerWords`
     * is `[]` and that is true — and it says nothing about what was said in the
     * session.
     */
    test('a record nobody commented on still carries what was said', async () => {
      const row = (
        await cli.run(['record', 'get', String(idOf('r-flaky-test')), '--json'])
      ).jsonAs<Row>()

      expect(row.ownerWords).toEqual([])
      expect(row.humanWords).toEqual(onTheRow(filed().humanWords))
    })

    /** Two fields, two meanings, neither folded into the other. */
    test('keeps the review-time words and the record’s quotes apart', async () => {
      const row = (
        await cli.run(['record', 'get', String(idOf('r-stale-lock')), '--json'])
      ).jsonAs<Row>()

      expect(row.ownerWords).toEqual(['Start with this one.', 'This cost me the whole afternoon.'])
      expect(row.humanWords.map((said) => said.verbatim)).toEqual(
        filed().humanWords.map((said) => said.verbatim),
      )
      for (const said of row.humanWords) expect(row.ownerWords).not.toContain(said.verbatim)
    })

    /**
     * **`humanWords: []` means he said nothing quotable** — which is what an empty
     * array on this row should have meant all along. Filed that way on purpose,
     * with a quote that has no `context` beside it in a second record.
     */
    test('reads an empty list as empty, and a quote without context as null', async () => {
      const [quiet, bare] = draftOf(
        aRevisionDraft([
          { rid: 'r-nothing-said', num: 1, title: 'Nobody said a word about this one' },
          { rid: 'r-bare-quote', num: 2, title: 'A quote with nothing around it' },
        ]),
      ) as [Filed, Filed]
      quiet.humanWords = []
      quiet.workaround = 'none'
      bare.humanWords = [{ verbatim: 'why is it like this', cleaned: 'Why is it like this?' }]

      const gamma = await aSession('uuid-gamma')
      const retroId = await aRevision(gamma, JSON.stringify({ records: [quiet, bare] }))
      const idIn = async (rid: string): Promise<string> =>
        String((await cli.store.recordIds.findByRecord(retroId, rid))?.id ?? 0)

      const nothing = (
        await cli.run(['record', 'get', await idIn('r-nothing-said'), '--json'])
      ).jsonAs<Row>()
      const one = (
        await cli.run(['record', 'get', await idIn('r-bare-quote'), '--json'])
      ).jsonAs<Row>()

      expect(nothing.humanWords).toEqual([])
      expect(nothing.workaround).toBe('none')
      expect(one.humanWords).toEqual([
        { verbatim: 'why is it like this', cleaned: 'Why is it like this?', context: null },
      ])

      // And in the text form: a line that says so, rather than no line — a line
      // that is not there reads as "not printed", which is how `[]` read as "lost".
      const nothingPrinted = (await cli.run(['record', 'get', await idIn('r-nothing-said')])).stdout
        .join('\n')
        .split('\n')
      const onePrinted = (await cli.run(['record', 'get', await idIn('r-bare-quote')])).stdout
        .join('\n')
        .split('\n')

      expect(nothingPrinted).toContain('    humanWords: none')
      expect(nothingPrinted).toContain('    workaround: none')
      expect(onePrinted).toContain('    humanWords: “why is it like this”')
    })

    /**
     * The text form names the two, because a bare `“…”` line is how `ownerWords`
     * already prints — and an unnamed quote is the ambiguity this record is about.
     */
    test('record get prints them under their own names', async () => {
      const result = await cli.run(['record', 'get', String(idOf('r-stale-lock'))])
      const [said] = filed().humanWords

      expect(result.code).toBe(EXIT.ok)
      expect(result.stdout.join('\n').split('\n')).toEqual([
        `#${idOf('r-stale-lock')} [approved] r-stale-lock — Deploy blocked on a stale lock file · L2 · pull-request · retro ${past} (#1 of session 1)`,
        '    Solution 2 — Write the holder PID.',
        `    humanWords: “${said?.verbatim}” — ${said?.context}`,
        `    workaround: ${filed().workaround}`,
        '    “Start with this one.”',
        '    “This cost me the whole afternoon.”',
      ])
    })
  })

  describe('record relations', () => {
    beforeEach(async () => {
      await cli.run([
        'record',
        'relate',
        String(idOf('r-flaky-test')),
        String(idOf('r-silent-tailer')),
        '--how',
        'the same lock',
        '--json',
      ])
    })

    /**
     * The read the whole relation feature exists for, in the shape the lane
     * needs it: the far record's title, where it stands, and what closed it.
     */
    test('names the far record, its state and what shows it was fixed', async () => {
      const result = await cli.run(['record', 'relations', String(idOf('r-flaky-test')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(rowsOf(result)).toEqual([
        {
          recordId: idOf('r-silent-tailer'),
          retroId: recent,
          retro: 2,
          slug: 'r-silent-tailer',
          title: 'The tailer stops without saying so',
          kind: 'the same lock',
          direction: 'outgoing',
          state: 'resolved',
          resolvedAt: '2026-08-23T09:00:00.000Z',
          ref: 'a1b2c3d',
          refs: ['a1b2c3d'],
        },
      ] as unknown as Row[])
    })

    /** One stored row, two answers — the direction is the only thing that differs. */
    test('reads from the other end too', async () => {
      const result = await cli.run([
        'record',
        'relations',
        String(idOf('r-silent-tailer')),
        '--json',
      ])

      expect(rowsOf(result)).toMatchObject([
        {
          recordId: idOf('r-flaky-test'),
          slug: 'r-flaky-test',
          direction: 'incoming',
          state: 'in-progress',
        },
      ])
    })

    test('every relation carries exactly these keys', async () => {
      const [row] = rowsOf(
        await cli.run(['record', 'relations', String(idOf('r-flaky-test')), '--json']),
      )

      expect(Object.keys(row ?? {}).sort()).toEqual([
        'direction',
        'kind',
        'recordId',
        'ref',
        'refs',
        'resolvedAt',
        'retro',
        'retroId',
        'slug',
        'state',
        'title',
      ])
    })

    test('is an empty array for a record nobody related', async () => {
      const result = await cli.run(['record', 'relations', String(idOf('r-noisy-hook')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.stdout).toEqual(['[]'])
    })

    test('is exit 3 for a number nothing was minted for', async () => {
      expect((await cli.run(['record', 'relations', '404', '--json'])).code).toBe(EXIT.notFound)
    })

    test('prints one line per relation, with the far record’s standing', async () => {
      const result = await cli.run(['record', 'relations', String(idOf('r-flaky-test'))])

      expect(result.stdout.join('\n')).toContain(
        `#${idOf('r-silent-tailer')} [resolved a1b2c3d] The tailer stops without saying so — the same lock (outgoing)`,
      )
    })
  })

  describe('record list --all', () => {
    test('lists every record of every retrospective, oldest first', async () => {
      const result = await cli.run(['record', 'list', '--all', '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(rowsOf(result).map((row) => [row.slug, row.lifecycle.state])).toEqual([
        ['r-stale-lock', 'approved'],
        ['r-noisy-hook', 'declined'],
        ['r-silent-tailer', 'resolved'],
        ['r-flaky-test', 'in-progress'],
        ['r-wide-export', 'archived'],
        ['r-late-badge', 'approved'],
      ])
    })

    test('narrows to a lane state the plain listing has no word for', async () => {
      const resolved = await cli.run(['record', 'list', '--all', '--state', 'resolved', '--json'])
      const held = await cli.run(['record', 'list', '--all', '--state', 'in-progress', '--json'])
      const archived = await cli.run(['record', 'list', '--all', '--state', 'archived', '--json'])

      expect(rowsOf(resolved).map((row) => row.slug)).toEqual(['r-silent-tailer'])
      expect(rowsOf(held).map((row) => row.slug)).toEqual(['r-flaky-test'])
      expect(rowsOf(archived).map((row) => row.slug)).toEqual(['r-wide-export'])
    })

    test('matches text however it was capitalised', async () => {
      const result = await cli.run(['record', 'list', '--all', '--text', 'STALE LOCK', '--json'])

      expect(rowsOf(result).map((row) => row.slug)).toEqual(['r-stale-lock'])
    })

    test('is an empty array when the text matches nothing', async () => {
      const result = await cli.run([
        'record',
        'list',
        '--all',
        '--text',
        'a phrase nobody wrote',
        '--json',
      ])

      expect(result.stdout).toEqual(['[]'])
    })

    /**
     * The plain listing is byte-for-byte what it always was — a different shape,
     * a different order, a different answer. `--all` is a different command
     * wearing the same word, and this is what says so.
     */
    test('leaves the plain listing untouched', async () => {
      const result = await cli.run(['record', 'list', '--retro', String(past), '--json'])

      expect(result.json()).toMatchObject({ retroId: past, revision: 1 })
      expect(Object.keys(result.json()).sort()).toEqual(['records', 'retroId', 'revision'])
    })
  })

  describe('record claim / unclaim', () => {
    test('claim answers with the marker it put up', async () => {
      const result = await cli.run(['record', 'claim', String(idOf('r-stale-lock')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        recordId: idOf('r-stale-lock'),
        retroId: past,
        slug: 'r-stale-lock',
        version: 1,
        claim: { claimedAt: '2026-08-23T09:00:00.000Z', actor: 'ai' },
      })
      expect(Object.keys(result.json()).sort()).toEqual([
        'claim',
        'recordId',
        'retroId',
        'slug',
        'version',
      ])
    })

    test('unclaim answers with the marker taken down, as a second version', async () => {
      const result = await cli.run(['record', 'unclaim', String(idOf('r-flaky-test')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        recordId: idOf('r-flaky-test'),
        retroId: recent,
        slug: 'r-flaky-test',
        version: 2,
        claim: null,
      })
    })

    /** The refusal the marker exists for: two agents, one queue, a minute apart. */
    test('is exit 4 when the record is already claimed', async () => {
      const result = await cli.run(['record', 'claim', String(idOf('r-flaky-test')), '--json'])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().message).toContain('already claimed')
      expect(result.stdout).toEqual([])
    })

    test('is exit 4 when releasing a record nobody is holding', async () => {
      const result = await cli.run(['record', 'unclaim', String(idOf('r-stale-lock')), '--json'])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.stdout).toEqual([])
    })

    test('is exit 4 on a record that is already resolved', async () => {
      const result = await cli.run(['record', 'claim', String(idOf('r-silent-tailer')), '--json'])

      expect(result.code).toBe(EXIT.conflict)
    })

    test('is exit 3 for a number nothing was minted for', async () => {
      expect((await cli.run(['record', 'claim', '404', '--json'])).code).toBe(EXIT.notFound)
    })

    /**
     * **The resolve takes the marker down**, in the same unit of work — so a
     * finished record never reads as still being worked on, and it leaves the
     * queue in the same breath.
     */
    test('resolving a claimed record clears the claim and takes it off the queue', async () => {
      const resolved = await cli.run([
        'record',
        'resolve',
        'r-flaky-test',
        '--retro',
        String(recent),
        '--ref',
        'abc1234',
        '--json',
      ])
      expect(resolved.code).toBe(EXIT.ok)

      const after = await cli.run(['record', 'get', String(idOf('r-flaky-test')), '--json'])
      expect(after.json()).toMatchObject({
        claim: null,
        resolved: true,
        lifecycle: { state: 'resolved', ref: 'abc1234', claimedAt: null },
      })
      expect(rowsOf(await cli.run(['record', 'queue', '--json'])).map((row) => row.slug)).toEqual([
        'r-stale-lock',
      ])
    })

    test('prints what it did in the line a person reads', async () => {
      const result = await cli.run(['record', 'claim', String(idOf('r-stale-lock'))])

      expect(result.stdout.join('\n')).toContain(
        `Claimed #${idOf('r-stale-lock')} r-stale-lock in retro ${past} (v1)`,
      )
    })
  })

  /**
   * **The lifecycle acts take the number too**
   * (`r-brief-record-resolve-line`). The queue and `record get` hand out
   * `#globalId`s, and until this a caller holding one had to read the record a
   * second time, for its rid and its retrospective, before it could resolve it —
   * `resolve` was the one act in the brief's block addressed differently from
   * its neighbours. A rid can never be all digits (`ridSchema`), so the two
   * forms cannot be confused, and the number form needs no `--retro`: the number
   * names its retrospective on its own.
   */
  describe('record resolve / reopen by #globalId', () => {
    test('resolve takes the number, needs no --retro, and clears the claim in the same breath', async () => {
      const result = await cli.run([
        'record',
        'resolve',
        String(idOf('r-flaky-test')),
        '--ref',
        'abc1234',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toMatchObject({
        retroId: recent,
        rid: 'r-flaky-test',
        version: 1,
        status: 'resolved',
        refs: ['abc1234'],
        note: null,
        actor: 'ai',
      })

      const after = await cli.run(['record', 'get', String(idOf('r-flaky-test')), '--json'])
      expect(after.json()).toMatchObject({
        claim: null,
        resolved: true,
        lifecycle: { state: 'resolved', ref: 'abc1234', claimedAt: null },
      })
      expect(rowsOf(await cli.run(['record', 'queue', '--json'])).map((row) => row.slug)).toEqual([
        'r-stale-lock',
      ])
    })

    test('reopen takes the number too', async () => {
      const result = await cli.run(['record', 'reopen', String(idOf('r-silent-tailer')), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toMatchObject({
        retroId: recent,
        rid: 'r-silent-tailer',
        version: 2,
        status: 'open',
      })
    })

    /** The number form is no narrower than the rid form: neither waits for the review to finish. */
    test('reaches a record whose review the human has not finished', async () => {
      const result = await cli.run([
        'record',
        'resolve',
        String(idOf('r-late-badge')),
        '--ref',
        'abc1234',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.jsonAs<{ retroId: number }>().retroId).toBe(open)
    })

    /**
     * A rid is minted per retrospective and is not unique across them, so a
     * `--retro` that names a different retrospective than the number does is the
     * caller holding two records in mind — refused, rather than passed through to
     * land on a same-named record elsewhere. One that agrees is merely redundant.
     */
    test('a --retro beside the number is accepted when it agrees and exit 2 when it does not', async () => {
      const disagrees = await cli.run([
        'record',
        'resolve',
        String(idOf('r-stale-lock')),
        '--retro',
        String(recent),
        '--ref',
        'abc1234',
        '--json',
      ])
      expect(disagrees.code).toBe(EXIT.usage)
      expect(disagrees.error().message).toContain(`retrospective ${past}`)
      expect(await cli.store.recordLifecycle.findLatest(past, 'r-stale-lock')).toBeUndefined()

      const agrees = await cli.run([
        'record',
        'resolve',
        String(idOf('r-stale-lock')),
        '--retro',
        String(past),
        '--ref',
        'abc1234',
        '--json',
      ])
      expect(agrees.code).toBe(EXIT.ok)
      expect(agrees.jsonAs<{ retroId: number }>().retroId).toBe(past)
    })

    test('a --session beside the number is exit 2: the number names its retrospective on its own', async () => {
      const result = await cli.run([
        'record',
        'resolve',
        String(idOf('r-stale-lock')),
        '--session',
        '1',
        '--ref',
        'abc1234',
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('--session')
      expect(await cli.store.recordLifecycle.findLatest(past, 'r-stale-lock')).toBeUndefined()
    })

    test('the rid form still needs --retro, and the refusal names the number form', async () => {
      const result = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--ref',
        'abc1234',
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('needs --retro')
      expect(result.error().message).toContain('#globalId')
    })

    test('is exit 3 for a number nothing was minted for, and exit 2 with no record id at all', async () => {
      const unminted = await cli.run(['record', 'resolve', '404', '--ref', 'abc1234', '--json'])
      expect(unminted.code).toBe(EXIT.notFound)

      const none = await cli.run(['record', 'resolve', '--ref', 'abc1234', '--json'])
      expect(none.code).toBe(EXIT.usage)
      expect(none.error().message).toContain('needs a record id')
      expect(none.error().message).toContain('#globalId')
    })
  })

  /**
   * **What the lane refuses, and what each refusal teaches.** Every one of these
   * is somebody reaching for an argument from a neighbouring command, and an
   * ignored argument answers as if it had meant something.
   */
  describe('what it refuses', () => {
    const refusals: readonly (readonly [string, readonly string[], string])[] = [
      ['a retrospective on the queue', ['record', 'queue', '--retro', '1'], 'takes no --retro'],
      ['a session on the queue', ['record', 'queue', '--session', '1'], 'takes no --retro'],
      [
        'a retrospective on a global read',
        ['record', 'get', '1', '--retro', '1'],
        'takes no --retro',
      ],
      ['a revision on a global read', ['record', 'get', '1', '--revision', '1'], 'takes no'],
      ['a state on a global read', ['record', 'relations', '1', '--state', 'approved'], 'takes no'],
      ['a reference on a claim', ['record', 'claim', '1', '--ref', 'abc'], 'takes no'],
      ['words on a claim', ['record', 'claim', '1', '--how', 'because'], 'takes no'],
      ['a note on an unclaim', ['record', 'unclaim', '1', '--note', 'done'], 'takes no'],
      [
        'a retrospective beside --all',
        ['record', 'list', '--all', '--retro', '1'],
        'takes no --retro',
      ],
      ['a session beside --all', ['record', 'list', '--all', '--session', '1'], 'takes no --retro'],
      [
        'a revision beside --all',
        ['record', 'list', '--all', '--revision', '1'],
        'takes no --revision',
      ],
      [
        'a lane-only state without --all',
        ['record', 'list', '--retro', '1', '--state', 'in-progress'],
        '--all',
      ],
      ['a search without --all', ['record', 'list', '--retro', '1', '--text', 'lock'], '--all'],
      ['a second record id on a lane read', ['record', 'get', '1', '2'], 'one record'],
    ]

    for (const [why, argv, says] of refusals) {
      test(`${why} — exit 2, and nothing on stdout`, async () => {
        const result = await cli.run([...argv, '--json'])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain(says)
        expect(result.stdout).toEqual([])
      })
    }

    /**
     * The three lane-only states are refused **without** `--all` and accepted
     * with it, which is the pair that makes the message honest: the word exists,
     * and the plain listing is the wrong command to say it to.
     */
    test('the same state word is accepted with --all', async () => {
      const result = await cli.run(['record', 'list', '--all', '--state', 'in-progress', '--json'])

      expect(result.code).toBe(EXIT.ok)
    })
  })
})
