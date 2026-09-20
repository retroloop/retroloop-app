import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type App, createApp, hashRecordContent, type RetroRecord } from '@retro/core'
import { EXIT } from '#errors'
import { aRevisionDraft, type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/**
 * Every command's `--json` shape, locked (testing.md suite 3).
 *
 * These assertions are the CLI's public contract: the plugin shells out and reads
 * exactly these keys, so breaking one is a major version. `toEqual` on the whole
 * object rather than a few properties is deliberate — an extra key is a change to
 * the contract too, and it should have to be written down here before it ships.
 */
describe('the CLI', () => {
  let cli: Cli

  beforeEach(() => {
    cli = createCli()
  })

  async function aSession(uuid = 'uuid-1'): Promise<number> {
    const result = await cli.run([
      'session',
      'create',
      '--claude-session',
      uuid,
      '--project',
      'retro',
      '--cwd',
      '/Users/sample/Developer/retro',
      '--branch',
      'main',
      '--supervised',
      '--json',
    ])
    return result.jsonAs<{ sessionId: number }>().sessionId
  }

  async function aRevision(sessionId: number, draft = aRevisionDraft()): Promise<number> {
    const file = cli.file('revision.json', draft)
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
   * The human's half of one round: decide whatever is still pending, then press
   * Finish.
   *
   * Since `r-revision-sneaks-past-review` a revision may only answer a finished
   * round, so a test that wants a second one runs the rhythm. It goes through
   * the App rather than the CLI because finishing is human-only and has no
   * command — that is the point of it.
   */
  async function finishRound(retroId: number): Promise<void> {
    const app = createApp(cli.store, { clock: cli.clock })
    const { records } = await app.records.list.execute({ actor: 'human', retro: { retroId } })
    for (const view of records) {
      if (view.decision.state !== 'pending') continue
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: view.record.rid,
        decision: { state: 'approved' },
      })
    }
    await app.review.finish.execute({ actor: 'human', retro: { retroId } })
  }

  describe('session create', () => {
    test('returns { sessionId, url } and exits 0', async () => {
      const result = await cli.run([
        'session',
        'create',
        '--claude-session',
        'uuid-1',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({ sessionId: 1, url: 'http://localhost:24100/sessions/1' })
    })

    /**
     * `--project` is optional and dormant. Registering without it is the
     * ordinary path now, and it returns the same shape as any other — a
     * session that had to name a project to exist would still be a project
     * construct on the critical path.
     */
    test('registers without --project, and says the same thing about it', async () => {
      const result = await cli.run([
        'session',
        'create',
        '--claude-session',
        'uuid-1',
        '--cwd',
        '/tmp',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({ sessionId: 1, url: 'http://localhost:24100/sessions/1' })
    })

    test('is idempotent by the Claude session uuid', async () => {
      const first = await aSession('uuid-same')
      const second = await aSession('uuid-same')

      expect(second).toBe(first)
    })

    test('is exit 2 without its required options', async () => {
      const result = await cli.run(['session', 'create', '--json'])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().code).toBe('USAGE')
      expect(result.stdout).toEqual([])
    })

    test('writes a human line, not JSON, without --json', async () => {
      const result = await cli.run([
        'session',
        'create',
        '--claude-session',
        'uuid-1',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.stdout[0]).toContain('Registered session 1')
      expect(() => result.json()).toThrow()
    })

    test('says nothing at all with --quiet', async () => {
      const result = await cli.run([
        'session',
        'create',
        '--claude-session',
        'uuid-1',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--quiet',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.stdout).toEqual([])
    })
  })

  describe('note add', () => {
    test('returns { noteId, sessionId, kind, at }', async () => {
      const sessionId = await aSession()

      const result = await cli.run([
        'note',
        'add',
        '--session',
        String(sessionId),
        '--text',
        'The deploy waited on a stale lock again.',
        '--kind',
        'ai-cost',
        '--json',
      ])

      // The id comes from the stored row rather than from counting inserts: the
      // shape is the contract, and it has to hold over SQLite too, where the ids
      // are allocated per table.
      const stored = (await cli.store.notes.listBySession(sessionId))[0]
      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        noteId: stored?.id,
        sessionId,
        kind: 'ai-cost',
        at: '2026-08-23T09:00:00.000Z',
      })
    })

    test('defaults the kind to human-cost', async () => {
      const sessionId = await aSession()

      const result = await cli.run([
        'note',
        'add',
        '--session',
        String(sessionId),
        '--text',
        'a friction',
        '--json',
      ])

      expect(result.jsonAs<{ kind: string }>().kind).toBe('human-cost')
    })

    test('reads the note from a file', async () => {
      const sessionId = await aSession()
      const file = cli.file('note.txt', 'from a file')

      const result = await cli.run([
        'note',
        'add',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect((await cli.store.notes.listBySession(sessionId))[0]?.text).toBe('from a file')
    })

    test('reads the note from stdin when --file is -', async () => {
      const piped = createCli({ stdin: async () => 'piped in\n' })
      const session = await piped.run([
        'session',
        'create',
        '--claude-session',
        'uuid-piped',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--json',
      ])
      const sessionId = session.jsonAs<{ sessionId: number }>().sessionId

      const result = await piped.run([
        'note',
        'add',
        '--session',
        String(sessionId),
        '--file',
        '-',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect((await piped.store.notes.listBySession(sessionId))[0]?.text).toBe('piped in\n')
    })

    test('addresses a session by its uuid as well as its id', async () => {
      await aSession('uuid-by-name')

      const result = await cli.run([
        'note',
        'add',
        '--session',
        'uuid-by-name',
        '--text',
        'a friction',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
    })

    test('is exit 3 for a session that does not exist', async () => {
      const result = await cli.run([
        'note',
        'add',
        '--session',
        '404',
        '--text',
        'a friction',
        '--json',
      ])

      expect(result.code).toBe(EXIT.notFound)
      expect(result.error().code).toBe('NOT_FOUND')
    })

    test('is exit 2 with neither --text nor --file', async () => {
      const sessionId = await aSession()

      const result = await cli.run(['note', 'add', '--session', String(sessionId), '--json'])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('--text or --file')
    })

    test('is exit 2 for an empty note', async () => {
      const sessionId = await aSession()

      const result = await cli.run([
        'note',
        'add',
        '--session',
        String(sessionId),
        '--text',
        '   ',
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().code).toBe('VALIDATION')
    })
  })

  describe('revision create', () => {
    test('returns { retroId, retro, revision, url }', async () => {
      const sessionId = await aSession()
      const file = cli.file('revision.json', aRevisionDraft())

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      const retro = await cli.store.retrospectives.findOpenBySession(sessionId)
      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId: retro?.id,
        retro: 1,
        revision: 1,
        url: `http://localhost:24100/retros/${retro?.id}?rev=1`,
      })
    })

    /**
     * The retro's name is authored in the payload, not passed as a flag: it is
     * part of the draft, so it travels with it and changes the only way
     * anything in a draft changes — by redrafting. The CLI's job is to hand the
     * file to the core without touching what is in it.
     */
    test('carries the payload’s title through to the stored revision, untouched', async () => {
      const sessionId = await aSession()
      const draft = JSON.parse(aRevisionDraft()) as Record<string, unknown>
      const file = cli.file(
        'titled.json',
        JSON.stringify({ title: 'The lock that outlived its process', ...draft }),
      )

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      const retroId = result.jsonAs<{ retroId: number }>().retroId
      expect((await cli.store.revisions.findLatestByRetro(retroId))?.title).toBe(
        'The lock that outlived its process',
      )
    })

    test('is exit 2 for a title the schema will not take', async () => {
      const sessionId = await aSession()
      const draft = JSON.parse(aRevisionDraft()) as Record<string, unknown>
      const file = cli.file('long-title.json', JSON.stringify({ title: 'x'.repeat(81), ...draft }))

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().code).toBe('VALIDATION')
    })

    test('counts the retrospective within its session, not by id', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      // Finish the first retrospective so the next revision opens a second one.
      await cli.store.retrospectives.setState(retroId, 'finished', '2026-08-23T10:00:00.000Z')

      const file = cli.file('second.json', aRevisionDraft())
      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      expect(result.jsonAs<{ retro: number; revision: number }>()).toMatchObject({
        retro: 2,
        revision: 1,
      })
    })

    test('is exit 4 when --expect-revision does not match', async () => {
      const sessionId = await aSession()
      const file = cli.file('revision.json', aRevisionDraft())

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--expect-revision',
        '2',
        '--json',
      ])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().code).toBe('CONFLICT')
    })

    /**
     * **`r-revision-sneaks-past-review`, at the transport the AI actually
     * uses.** Sending a revision while the human has not finished the review is
     * not allowed: the human must not spend time on a review while the AI
     * sneaks in and sends a new revision.
     *
     * The exit code is the half a script reads and the message is the half an
     * agent reads, so both are asserted: exit 4 is `CONFLICT` (cli.md §Exit
     * codes), and the refusal has to name the way out or the AI retries the
     * thing that was just refused.
     */
    test('is exit 4 while the human is still reviewing the latest revision', async () => {
      const sessionId = await aSession()
      await aRevision(sessionId)

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        cli.file('second.json', aRevisionDraft()),
        '--json',
      ])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error()).toEqual({
        code: 'CONFLICT',
        message: expect.stringContaining('is still being reviewed'),
      })
      // The way out, named in the refusal itself: mark the record `revise`, let
      // them Finish, and the rewrite lands as the next round.
      expect(result.error().message).toContain('revise')
      expect(result.error().message).toContain('Finish')
    })

    test('accepts the next revision once the round has been finished', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await finishRound(retroId)

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        cli.file('second.json', aRevisionDraft()),
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.jsonAs<{ revision: number }>().revision).toBe(2)
    })

    test('is exit 2 for a draft that fails the schema', async () => {
      const sessionId = await aSession()
      const file = cli.file('bad.json', JSON.stringify({ records: [{ rid: 'r-one' }] }))

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().code).toBe('VALIDATION')
    })

    test('is exit 2 for a file that is not JSON, and for a file that is not there', async () => {
      const sessionId = await aSession()
      const file = cli.file('bad.json', 'not json at all')

      const broken = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        file,
        '--json',
      ])
      expect(broken.code).toBe(EXIT.usage)
      expect(broken.error().message).toContain('not valid JSON')

      const missing = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        join(cli.dataDir, 'nope.json'),
        '--json',
      ])
      expect(missing.code).toBe(EXIT.usage)
      expect(missing.error().message).toContain('cannot read')
    })
  })

  describe('record list', () => {
    test('returns the records of the latest revision with their state', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(
        sessionId,
        aRevisionDraft([
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ]),
      )

      const result = await cli.run(['record', 'list', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId,
        revision: 1,
        records: [
          {
            rid: 'r-one',
            // Both numbers, because they answer different questions: `globalId`
            // is what the human is looking at when they name a record, `num` is
            // what the draft authored and what a resubmitted draft must keep
            // saying. The first retrospective of a fresh stage, so they agree
            // here; `record list` on a second one is where they part.
            globalId: 1,
            num: 1,
            title: 'Deploy blocked on a stale lock file',
            type: 'issue',
            state: 'pending',
            severity: 3,
            solutionLevel: 2,
            selectedSolution: 2,
            involvement: 'pull-request',
            carriedOver: false,
            decidedOnRevision: null,
            // Where it stands on the axis that outlives the review. `open` on a
            // record nobody has touched — and present, which is the whole point:
            // this list used to answer nothing at all here while the flat page
            // answered correctly.
            lifecycle: {
              status: 'open',
              refs: [],
              note: null,
              actor: null,
              at: null,
            },
            // And what it was said to have to do with other records — empty on a
            // record nobody has related, and present for the same reason: the
            // populated half is asserted in the `record relate` block below,
            // read back through this same command.
            relations: [],
          },
          {
            rid: 'r-two',
            globalId: 2,
            num: 2,
            title: 'Deploy blocked on a stale lock file',
            type: 'issue',
            state: 'pending',
            severity: 3,
            solutionLevel: 2,
            selectedSolution: 2,
            involvement: 'pull-request',
            carriedOver: false,
            decidedOnRevision: null,
            lifecycle: {
              status: 'open',
              refs: [],
              note: null,
              actor: null,
              at: null,
            },
            relations: [],
          },
        ],
      })
    })

    /**
     * **The scenario that filed the projection gap, end to end** — resolve through
     * the CLI, then read the list back through the CLI. That is the AI's own
     * verification loop after a batch resolve, and it reported nothing about the
     * writes it had just made.
     */
    test('shows a resolved record’s lifecycle, refs and all, right after resolving it', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const resolved = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--ref',
        'a1b2c3d',
        '--ref',
        'https://example.test/pull/7',
        '--note',
        'Landed on main.',
        '--json',
      ])
      expect(resolved.code).toBe(EXIT.ok)

      const listed = await cli.run(['record', 'list', '--retro', String(retroId), '--json'])

      expect(listed.code).toBe(EXIT.ok)
      expect(
        listed.jsonAs<{ records: { rid: string; lifecycle: unknown }[] }>().records[0]?.lifecycle,
      ).toEqual({
        status: 'resolved',
        refs: ['a1b2c3d', 'https://example.test/pull/7'],
        note: 'Landed on main.',
        actor: 'ai',
        at: '2026-08-23T09:00:00.000Z',
      })
    })

    /**
     * A declined record is born archived and no row says so (`lifecycle.md`), so
     * this is the derivation rather than a table read — the half a join-and-stop
     * fix would get wrong.
     */
    test('reads a declined record as archived, with no entry behind it', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await cli.store.decisions.add({
        retroId,
        rid: 'r-stale-lock',
        version: 1,
        state: 'declined',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: hashRecordContent(
          (await cli.store.revisions.findLatestByRetro(retroId))?.records[0] as RetroRecord,
        ),
        decidedAt: '2026-08-23T09:00:00.000Z',
      })

      const listed = await cli.run(['record', 'list', '--retro', String(retroId), '--json'])

      expect(
        listed.jsonAs<{ records: { state: string; lifecycle: unknown }[] }>().records[0],
      ).toMatchObject({
        state: 'declined',
        lifecycle: { status: 'archived', refs: [], note: null, actor: null, at: null },
      })
    })

    test('filters by state and addresses the retro through its session', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await cli.store.decisions.add({
        retroId,
        rid: 'r-stale-lock',
        version: 1,
        state: 'approved',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: 'not-the-current-content',
        decidedAt: '2026-08-23T10:00:00.000Z',
      })

      const pending = await cli.run([
        'record',
        'list',
        '--session',
        String(sessionId),
        '--state',
        'pending',
        '--json',
      ])
      const approved = await cli.run([
        'record',
        'list',
        '--session',
        String(sessionId),
        '--state',
        'approved',
        '--json',
      ])

      // The stored decision was made against different content, so it does not bind.
      expect(pending.jsonAs<{ records: unknown[] }>().records).toHaveLength(1)
      expect(approved.jsonAs<{ records: unknown[] }>().records).toHaveLength(0)
    })

    test('is exit 2 with neither --retro nor --session', async () => {
      const result = await cli.run(['record', 'list', '--json'])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('--retro or --session')
    })

    /**
     * The line a person reads carries the verdict and nothing beside it.
     *
     * It carried a `[held]` marker for a time, which is what this test was
     * written for; `r-remove-hold` took the feature out, so the marker is
     * asserted absent instead — with the verdict asserted present in the same
     * line, because a check that only looked for a missing word would pass on a
     * command that printed nothing at all.
     */
    test('marks the verdict in the line a person reads, and nothing beside it', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(
        sessionId,
        aRevisionDraft([
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ]),
      )

      const result = await cli.run(['record', 'list', '--retro', String(retroId)])

      expect(result.code).toBe(EXIT.ok)
      const printed = result.stdout.join('\n')
      expect(printed).toContain('#1 [pending] r-one')
      expect(printed).toContain('#2 [pending] r-two')
      expect(printed).not.toContain('[held]')
    })

    /**
     * The number does not restart with each retrospective: record ids that
     * started from #1 inside every retro read oddly.
     *
     * The second retrospective's only record is `num` 1 and `#3`, which is the
     * one shape where the two numbers disagree, and therefore the only one in
     * which a command still printing `num` can be caught. It is asserted in both
     * projections, because they are two different readers: the AI parses the
     * JSON and the human reads the line.
     */
    test('numbers records across retrospectives rather than within one', async () => {
      const here = await aSession('uuid-here')
      await aRevision(
        here,
        aRevisionDraft([
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ]),
      )
      const there = await aSession('uuid-there')
      const second = await aRevision(there, aRevisionDraft([{ rid: 'r-one', num: 1 }]))

      const json = await cli.run(['record', 'list', '--retro', String(second), '--json'])
      const printed = await cli.run(['record', 'list', '--retro', String(second)])

      expect(
        json
          .jsonAs<{ records: readonly { globalId: number; num: number }[] }>()
          .records.map((record) => [record.globalId, record.num]),
      ).toEqual([[3, 1]])
      expect(printed.stdout.join('\n')).toContain('#3 [pending] r-one')
    })

    test('is exit 3 for a retrospective that does not exist', async () => {
      const result = await cli.run(['record', 'list', '--retro', '404', '--json'])

      expect(result.code).toBe(EXIT.notFound)
    })

    /**
     * Refused rather than ignored: `record list r-stale-lock` is somebody
     * expecting a filter, and answering with the whole revision would look like
     * a filter that matched everything.
     */
    test('is exit 2 when given a record id it has no use for', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await cli.run([
        'record',
        'list',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
      expect(result.error().message).toContain('takes no record id')
    })
  })

  /**
   * `record resolve` / `record reopen` — the AI's half of the lifecycle axis:
   * once the AI has fixed an issue there has to be a way to show that the issue
   * was resolved, and to name a commit id or a GitHub issue as the reference.
   *
   * The human's half is `records.setLifecycle` over tRPC. Both reach the same
   * use case, and the row records which actor wrote it — every command here
   * writes as `ai`, because that is the only thing the CLI ever writes as.
   */
  describe('record resolve / reopen', () => {
    const resolve = async (retroId: number, rid: string, ...refs: readonly string[]) =>
      cli.run([
        'record',
        'resolve',
        rid,
        '--retro',
        String(retroId),
        ...refs.flatMap((ref) => ['--ref', ref]),
        '--json',
      ])

    test('resolve returns the whole lifecycle shape and exits 0', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--ref',
        'a1b2c3d',
        '--ref',
        'https://github.com/o/r/pull/42',
        '--note',
        'Landed on main.',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId,
        rid: 'r-stale-lock',
        version: 1,
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
        note: 'Landed on main.',
        actor: 'ai',
        at: '2026-08-23T09:00:00.000Z',
      })
    })

    /**
     * `status` is where the record now stands, not the word that was written —
     * so a reopen answers `open`, and the refs of the resolve it superseded are
     * history rather than the state of a record that is open again.
     *
     * `note` and the two beside it stay keys rather than vanishing, because a
     * key that comes and goes is a shape a script has to guess at (`views.ts`).
     */
    test('reopen answers with the state it left the record in, keys and all', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await resolve(retroId, 'r-stale-lock', 'a1b2c3d')

      const result = await cli.run([
        'record',
        'reopen',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId,
        rid: 'r-stale-lock',
        version: 2,
        status: 'open',
        refs: [],
        note: null,
        actor: 'ai',
        at: '2026-08-23T09:00:00.000Z',
      })
    })

    test('the line a person reads names the record, the version and the references', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const resolved = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--ref',
        'a1b2c3d',
      ])
      const reopened = await cli.run([
        'record',
        'reopen',
        'r-stale-lock',
        '--retro',
        String(retroId),
      ])

      expect(resolved.stdout.join('\n')).toBe(
        `Resolved r-stale-lock in retro ${retroId} (v1) — a1b2c3d`,
      )
      expect(reopened.stdout.join('\n')).toBe(`Reopened r-stale-lock in retro ${retroId} (v2)`)
    })

    test('addresses the retrospective through its session too', async () => {
      const sessionId = await aSession()
      await aRevision(sessionId)

      const result = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--session',
        String(sessionId),
        '--ref',
        'a1b2c3d',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.jsonAs<{ status: string }>().status).toBe('resolved')
    })

    /** The evidence is the point of the feature, so a resolve citing nothing is refused. */
    test('is exit 2 for a resolve with no --ref, or one that is only whitespace', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const bare = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--json',
      ])
      const blank = await resolve(retroId, 'r-stale-lock', '   ')

      expect(bare.code).toBe(EXIT.usage)
      expect(blank.code).toBe(EXIT.usage)
    })

    test('trims a reference on the way in', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await resolve(retroId, 'r-stale-lock', '  a1b2c3d  ')

      expect(result.jsonAs<{ refs: string[] }>().refs).toEqual(['a1b2c3d'])
    })

    /**
     * **The archive pair is the human's** — archiving and unarchiving a record
     * are the user's to perform — and the CLI writes as `ai` and nothing else,
     * so both acts are offered here and both are refused, by the use case
     * rather than by the argument parser.
     *
     * Offered rather than hidden on purpose: they sit on the same command and
     * the same rid as `resolve`, which the AI uses constantly, so the refusal is
     * the sentence that teaches the rule. Exit 5 is `FORBIDDEN_ACTOR`, the code
     * every other human-only write already answers with.
     */
    test('is exit 5 for archive and unarchive — the AI may not take either', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      for (const action of ['archive', 'unarchive']) {
        const result = await cli.run([
          'record',
          action,
          'r-stale-lock',
          '--retro',
          String(retroId),
          '--json',
        ])

        expect(result.code).toBe(EXIT.forbidden)
        expect(result.error().code).toBe('FORBIDDEN_ACTOR')
        expect(result.error().message).toContain('written by the human actor')
      }

      // And nothing was written on the way to being refused.
      expect(await cli.store.recordLifecycle.findLatest(retroId, 'r-stale-lock')).toBeUndefined()
    })

    /** Nothing to take back is a refusal, not a quiet success. */
    test('is exit 4 reopening a record that was never resolved', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await cli.run([
        'record',
        'reopen',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--json',
      ])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().code).toBe('CONFLICT')
    })

    test('is exit 2 without a record id, and exit 3 for one the retro does not have', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const missing = await cli.run([
        'record',
        'resolve',
        '--retro',
        String(retroId),
        '--ref',
        'a1b2c3d',
        '--json',
      ])
      const ghost = await resolve(retroId, 'r-ghost', 'a1b2c3d')

      expect(missing.code).toBe(EXIT.usage)
      expect(missing.error().message).toContain('needs a record id')
      expect(ghost.code).toBe(EXIT.notFound)
    })

    /**
     * A record's lifecycle belongs to the record, not to a draft of it — the
     * same reason a thread resolution carries no revision. Accepting the flag
     * would suggest a record can be resolved "as of revision 2".
     */
    test('is exit 2 when handed a --revision or a --state', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const pinned = await cli.run([
        'record',
        'resolve',
        'r-stale-lock',
        '--retro',
        String(retroId),
        '--ref',
        'a1b2c3d',
        '--revision',
        '1',
        '--json',
      ])

      expect(pinned.code).toBe(EXIT.usage)
      expect(pinned.error().message).toContain('belongs to the record')
    })

    /**
     * **The point of the whole feature.** Every other write the CLI makes against
     * a retrospective refuses once the review has closed; this one exists
     * *because* it has closed.
     */
    test('still works after the review is closed', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await cli.store.decisions.add({
        retroId,
        rid: 'r-stale-lock',
        version: 1,
        state: 'approved',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: hashRecordContent(
          (await cli.store.revisions.findLatestByRetro(retroId))?.records[0] as RetroRecord,
        ),
        decidedAt: '2026-08-23T10:00:00.000Z',
      })
      const app = createApp(cli.store, { clock: cli.clock })
      await app.review.finish.execute({ actor: 'human', retro: { retroId } })
      await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      const result = await resolve(retroId, 'r-stale-lock', 'a1b2c3d')

      expect(result.code).toBe(EXIT.ok)
      expect(result.jsonAs<{ status: string }>().status).toBe('resolved')
    })

    test('announces the act on the outbox, one name per direction', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      await resolve(retroId, 'r-stale-lock', 'a1b2c3d')
      await cli.run(['record', 'reopen', 'r-stale-lock', '--retro', String(retroId), '--json'])

      const events = await cli.store.events.list()

      expect(
        events
          .filter((event) => event.name.startsWith('Record'))
          .map((event) => [event.name, event.rid]),
      ).toEqual([
        ['RecordResolved', 'r-stale-lock'],
        ['RecordReopened', 'r-stale-lock'],
      ])
    })
  })

  /**
   * **`record relate` / `record unrelate` — the AI's transport for the feature's
   * own purpose**: both actors can relate records, each relation carries
   * how-they-relate words, and the relation reads from both sides, so that the
   * AI can easily find past records and build holistic solutions.
   *
   * The scenario asserted here is the one that sentence describes: the AI files
   * a record, finds the one it is a repeat of in a retrospective that closed,
   * relates them by the numbers `record list` gave it, and reads the relation
   * back through the same command. The read-back is the half
   * `r-lifecycle-projection-gap` records one table over — the AI checks its own
   * writes by listing, and a listing silent about them reads exactly like a
   * store that refused every one.
   */
  describe('record relate / unrelate', () => {
    /** A closed retrospective and an open one, and the two numbers that name a record in each. */
    async function twoRetrospectives(): Promise<{
      readonly past: number
      readonly current: number
      readonly pastId: number
      readonly currentId: number
    }> {
      const sessionId = await aSession()
      const past = await aRevision(sessionId, aRevisionDraft([{ rid: 'r-stale-lock', num: 1 }]))
      await finishRound(past)
      await createApp(cli.store, { clock: cli.clock }).review.close.execute({
        actor: 'ai',
        retro: { retroId: past },
      })

      const current = await aRevision(
        sessionId,
        aRevisionDraft([{ rid: 'r-silent-tailer', num: 1 }]),
      )

      return {
        past,
        current,
        pastId: (await cli.store.recordIds.findByRecord(past, 'r-stale-lock'))?.id ?? 0,
        currentId: (await cli.store.recordIds.findByRecord(current, 'r-silent-tailer'))?.id ?? 0,
      }
    }

    test('relates a new record to one in a retrospective that already closed', async () => {
      const { past, pastId, currentId } = await twoRetrospectives()

      const related = await cli.run([
        'record',
        'relate',
        String(currentId),
        String(pastId),
        '--how',
        'the same swallowed error, one loop further out',
        '--json',
      ])

      expect(related.code).toBe(EXIT.ok)
      expect(related.json()).toEqual({
        fromId: currentId,
        toId: pastId,
        version: 1,
        relations: [
          {
            globalId: pastId,
            // The **address**, which is what makes this answer useful to a
            // machine: the far record is in another retrospective, and this is
            // what every other read of this CLI is addressed by.
            retroId: past,
            rid: 'r-stale-lock',
            how: 'the same swallowed error, one loop further out',
            direction: 'outgoing',
            actor: 'ai',
            at: '2026-08-23T09:00:00.000Z',
          },
        ],
      })
    })

    test('reads back through record list, from both records’ retrospectives', async () => {
      const { past, current, pastId, currentId } = await twoRetrospectives()
      await cli.run([
        'record',
        'relate',
        String(currentId),
        String(pastId),
        '--how',
        'supersedes',
        '--json',
      ])

      const here = await cli.run(['record', 'list', '--retro', String(current), '--json'])
      const there = await cli.run(['record', 'list', '--retro', String(past), '--json'])

      type Listed = { records: { relations: unknown[] }[] }
      expect(here.jsonAs<Listed>().records[0]?.relations).toEqual([
        {
          globalId: pastId,
          retroId: past,
          rid: 'r-stale-lock',
          how: 'supersedes',
          direction: 'outgoing',
          actor: 'ai',
          at: '2026-08-23T09:00:00.000Z',
        },
      ])
      // The same row, read from the other end — one stored relation, two
      // answers, and the direction is the only thing that differs.
      expect(there.jsonAs<Listed>().records[0]?.relations).toEqual([
        {
          globalId: currentId,
          retroId: current,
          rid: 'r-silent-tailer',
          how: 'supersedes',
          direction: 'incoming',
          actor: 'ai',
          at: '2026-08-23T09:00:00.000Z',
        },
      ])
    })

    test('un-relates, and both listings drop the line', async () => {
      const { past, current, pastId, currentId } = await twoRetrospectives()
      await cli.run([
        'record',
        'relate',
        String(currentId),
        String(pastId),
        '--how',
        'supersedes',
        '--json',
      ])

      const removed = await cli.run([
        'record',
        'unrelate',
        String(currentId),
        String(pastId),
        '--json',
      ])

      expect(removed.code).toBe(EXIT.ok)
      expect(removed.json()).toEqual({
        fromId: currentId,
        toId: pastId,
        version: 2,
        relations: [],
      })

      type Listed = { records: { relations: unknown[] }[] }
      const here = await cli.run(['record', 'list', '--retro', String(current), '--json'])
      const there = await cli.run(['record', 'list', '--retro', String(past), '--json'])
      expect(here.jsonAs<Listed>().records[0]?.relations).toEqual([])
      expect(there.jsonAs<Listed>().records[0]?.relations).toEqual([])
    })

    /** The line a person reads names the numbers to go and read next, and nothing else. */
    test('the human-readable listing names the relation under the record', async () => {
      const { current, pastId, currentId } = await twoRetrospectives()
      await cli.run([
        'record',
        'relate',
        String(currentId),
        String(pastId),
        '--how',
        'supersedes',
        '--json',
      ])

      const listed = await cli.run(['record', 'list', '--retro', String(current)])

      expect(listed.code).toBe(EXIT.ok)
      expect(listed.stdout.join('\n')).toContain(`#${pastId} supersedes`)
    })

    test('appends a name per act, scoped to the record the act was taken from', async () => {
      const { current, pastId, currentId } = await twoRetrospectives()
      await cli.run([
        'record',
        'relate',
        String(currentId),
        String(pastId),
        '--how',
        'supersedes',
        '--json',
      ])
      await cli.run(['record', 'unrelate', String(currentId), String(pastId), '--json'])

      const { events } = await createApp(cli.store, { clock: cli.clock }).events.list.execute({
        actor: 'ai',
        retro: { retroId: current },
      })

      expect(
        events
          .filter((event) => event.name === 'RecordRelated' || event.name === 'RecordUnrelated')
          .map((event) => [event.name, event.rid]),
      ).toEqual([
        ['RecordRelated', 'r-silent-tailer'],
        ['RecordUnrelated', 'r-silent-tailer'],
      ])
    })

    describe('what it refuses, and what the refusal teaches', () => {
      test('a second record id on an act that names one record', async () => {
        const { current } = await twoRetrospectives()

        const result = await cli.run([
          'record',
          'resolve',
          'r-silent-tailer',
          '99',
          '--retro',
          String(current),
          '--ref',
          'a1b2c3d',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('relate/unrelate')
      })

      test('a rid where a #globalId belongs — the commonest reach on this command', async () => {
        const { pastId } = await twoRetrospectives()

        const result = await cli.run([
          'record',
          'relate',
          'r-silent-tailer',
          String(pastId),
          '--how',
          'supersedes',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('#globalId')
      })

      test('a relate with no --how: the words are half the act', async () => {
        const { pastId, currentId } = await twoRetrospectives()

        const result = await cli.run([
          'record',
          'relate',
          String(currentId),
          String(pastId),
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('--how')
      })

      test('words on an un-relate: the row keeps the ones it takes off', async () => {
        const { pastId, currentId } = await twoRetrospectives()
        await cli.run([
          'record',
          'relate',
          String(currentId),
          String(pastId),
          '--how',
          'supersedes',
          '--json',
        ])

        const result = await cli.run([
          'record',
          'unrelate',
          String(currentId),
          String(pastId),
          '--how',
          'actually duplicates',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('carries forward')
      })

      /**
       * A `--retro` here would suggest a relation lives inside a retrospective,
       * which is the one thing this feature is not.
       */
      test('--retro and --session, because a #globalId names a record on its own', async () => {
        const { past, pastId, currentId } = await twoRetrospectives()

        const result = await cli.run([
          'record',
          'relate',
          String(currentId),
          String(pastId),
          '--how',
          'supersedes',
          '--retro',
          String(past),
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('crosses retrospectives')
      })

      test('a record related to itself, and a number nothing was minted for', async () => {
        const { currentId } = await twoRetrospectives()

        const itself = await cli.run([
          'record',
          'relate',
          String(currentId),
          String(currentId),
          '--how',
          'itself',
          '--json',
        ])
        const nowhere = await cli.run([
          'record',
          'relate',
          String(currentId),
          '404',
          '--how',
          'nowhere',
          '--json',
        ])

        expect(itself.code).toBe(EXIT.usage)
        expect(nowhere.code).toBe(EXIT.notFound)
      })

      test('a pair that already stands, and one that does not', async () => {
        const { pastId, currentId } = await twoRetrospectives()

        const absent = await cli.run([
          'record',
          'unrelate',
          String(currentId),
          String(pastId),
          '--json',
        ])
        expect(absent.code).toBe(EXIT.conflict)

        await cli.run([
          'record',
          'relate',
          String(currentId),
          String(pastId),
          '--how',
          'supersedes',
          '--json',
        ])
        const again = await cli.run([
          'record',
          'relate',
          String(currentId),
          String(pastId),
          '--how',
          'supersedes again',
          '--json',
        ])
        expect(again.code).toBe(EXIT.conflict)
      })
    })
  })

  describe('review status', () => {
    test('returns the counts for the active revision', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(
        sessionId,
        aRevisionDraft([
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ]),
      )

      const result = await cli.run(['review', 'status', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId,
        state: 'reviewing',
        finished: false,
        revision: 1,
        counts: { pending: 2, approved: 0, declined: 0, revise: 0, hold: 0, total: 2 },
      })
    })

    /**
     * The one place the counts are read by a person rather than parsed. It ended
     * with "; N held" for a time — the lifecycle axis stated apart from the
     * verdicts — and `r-remove-hold` removed the feature, so the line is the
     * live verdicts and stops. The trailing clause is asserted gone as well as
     * the counts asserted present: an assertion that only checked the prefix
     * would pass on a line that still had it.
     *
     * `revise` joined the line with the verdict (`r-verdict-revise`); the
     * frozen `hold` bucket stays off it, which is the difference between a
     * count that can still change and one that never will again.
     */
    test('reads out the verdict counts, and says nothing about holds', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(
        sessionId,
        aRevisionDraft([
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ]),
      )
      const human = createApp(cli.store, { clock: cli.clock })
      await human.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-one',
        decision: { state: 'approved' },
      })

      const result = await cli.run(['review', 'status', '--retro', String(retroId)])

      expect(result.code).toBe(EXIT.ok)
      const printed = result.stdout.join('\n')
      expect(printed).toContain('1 pending, 1 approved, 0 declined, 0 to revise')
      expect(printed).not.toContain('held')
    })

    /**
     * A status in between, in the field the AI parses: one that says the human
     * has submitted but the AI has not closed. This command is what the AI runs
     * in exactly that window — `review wait` returns on the human's press and
     * this is the next thing it asks — and until now the answer was
     * `reviewing`, the same word it gives while the round has not been touched
     * at all.
     *
     * `finished` is asserted beside `state` at both points because the two say
     * different things now and a reader has to be able to tell which is which:
     * `state` is the reading (four words), `finished` is the stored terminal
     * state (still the same boolean every existing script keys off).
     *
     * The human text is asserted too — it interpolates `state`, so the word
     * reaches a person as well as a parser.
     */
    test('says submitted in the gap between their finish and the AI’s close', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId, aRevisionDraft([{ rid: 'r-one', num: 1 }]))
      await finishRound(retroId)

      const json = await cli.run(['review', 'status', '--retro', String(retroId), '--json'])

      expect(json.code).toBe(EXIT.ok)
      expect(json.json()).toEqual({
        retroId,
        state: 'submitted',
        finished: false,
        revision: 1,
        counts: { pending: 0, approved: 1, declined: 0, revise: 0, hold: 0, total: 1 },
      })

      const printed = await cli.run(['review', 'status', '--retro', String(retroId)])
      expect(printed.stdout.join('\n')).toContain(`Retro ${retroId} (submitted) revision 1`)
    })

    test('says finished once the AI has closed the review', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId, aRevisionDraft([{ rid: 'r-one', num: 1 }]))
      await finishRound(retroId)
      const close = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])
      expect(close.code).toBe(EXIT.ok)

      const result = await cli.run(['review', 'status', '--retro', String(retroId), '--json'])

      expect(result.json()).toMatchObject({ state: 'finished', finished: true })
    })

    test('is exit 3 for a retrospective that does not exist', async () => {
      const result = await cli.run(['review', 'status', '--retro', '404', '--json'])

      expect(result.code).toBe(EXIT.notFound)
    })
  })

  /**
   * The AI's end of the loop (`r-one-finish-button`): the human presses one
   * button, the AI reads the round, and when there is nothing left to address
   * it runs this. Every refusal below is the CLI's contract with the skill —
   * the exit code is what an AI following instructions actually sees.
   */
  describe('review close', () => {
    /**
     * The verdicts and the finish are the human's, and no CLI command can write
     * as the human — so the setup reaches past the CLI to the use cases, the
     * way the server does on the reviewer's behalf.
     */
    const asHuman = (): App => createApp(cli.store, { clock: cli.clock })

    async function aFinishedRound(): Promise<number> {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      const app = asHuman()
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await app.review.finish.execute({ actor: 'human', retro: { retroId } })
      return retroId
    }

    test('returns { retroId, state, revision, finishedAt } and exits 0', async () => {
      const retroId = await aFinishedRound()

      const result = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.ok)
      expect(result.json()).toEqual({
        retroId,
        state: 'finished',
        revision: 1,
        finishedAt: '2026-08-23T09:00:00.000Z',
      })
    })

    test('is exit 4 while the human has not finished the round', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().code).toBe('CONFLICT')
    })

    test('is exit 4 while a record still asks to be rewritten, and names it', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      const app = asHuman()
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'revise' },
      })
      await app.review.finish.execute({ actor: 'human', retro: { retroId } })

      const result = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().message).toContain('r-stale-lock')
    })

    /**
     * The state a cold agent lands in when they un-decides a record after
     * finishing, and the exit from it — SKILL.md §4 tells one to read the
     * `FINISH_GATE` code, name the records to them, and retry the close on the
     * finish they already gave. This is that sequence at the surface the skill
     * actually calls.
     */
    test('is exit 4 with FINISH_GATE when a verdict was undone, and closes once they rule again', async () => {
      const retroId = await aFinishedRound()
      const app = asHuman()
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'pending' },
      })

      const blocked = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      expect(blocked.code).toBe(EXIT.conflict)
      expect(blocked.error().code).toBe('FINISH_GATE')
      expect(blocked.error().message).toContain('r-stale-lock')

      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })

      // No second Finish review: the first one still opens the door.
      const closed = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])
      expect(closed.code).toBe(EXIT.ok)
      expect(closed.jsonAs<{ state: string }>().state).toBe('finished')
    })

    test('is exit 4 the second time', async () => {
      const retroId = await aFinishedRound()
      await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      const again = await cli.run(['review', 'close', '--retro', String(retroId), '--json'])

      expect(again.code).toBe(EXIT.conflict)
    })

    test('is exit 3 for a retrospective that does not exist', async () => {
      expect((await cli.run(['review', 'close', '--retro', '404', '--json'])).code).toBe(
        EXIT.notFound,
      )
    })
  })

  describe('export', () => {
    async function aFinishedRetro(): Promise<number> {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)
      const record = (await cli.store.revisions.findLatestByRetro(retroId))?.records[0]
      await cli.store.decisions.add({
        retroId,
        rid: record?.rid ?? '',
        version: 1,
        state: 'approved',
        severity: 2,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: 'Do this one first.',
        revisionN: 1,
        contentHash: '',
        decidedAt: '2026-08-23T10:00:00.000Z',
      })
      // Decide through the app so the content hash is the real one, then finish.
      await cli.store.decisions.add({
        retroId,
        rid: record?.rid ?? '',
        version: 2,
        state: 'approved',
        severity: 2,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: 'Do this one first.',
        revisionN: 1,
        contentHash: (await import('@retro/core')).hashRecordContent(record ?? ({} as never)),
        decidedAt: '2026-08-23T10:00:00.000Z',
      })
      await cli.store.retrospectives.setState(retroId, 'finished', '2026-08-23T11:00:00.000Z')
      return retroId
    }

    test('prints the export document to stdout when there is no --out', async () => {
      const retroId = await aFinishedRetro()

      const result = await cli.run(['export', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.ok)
      const document = JSON.parse(result.stdout.join('\n')) as {
        format: string
        records: unknown[]
      }
      expect(document.format).toBe('retro.export.v1')
      expect(document.records).toHaveLength(1)
    })

    test('writes the file and prints { path, records, bytes } with --out', async () => {
      const retroId = await aFinishedRetro()
      const out = join(cli.dataDir, 'export.json')

      const result = await cli.run(['export', '--retro', String(retroId), '--out', out, '--json'])

      expect(result.code).toBe(EXIT.ok)
      const receipt = result.jsonAs<{ path: string; records: number; bytes: number }>()
      expect(receipt.path).toBe(out)
      expect(receipt.records).toBe(1)
      expect(receipt.bytes).toBeGreaterThan(0)

      const written = readFileSync(out, 'utf8')
      expect(Buffer.byteLength(written)).toBe(receipt.bytes)
      expect((JSON.parse(written) as { format: string }).format).toBe('retro.export.v1')
    })

    test('is exit 4 for a review that is not finished', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(sessionId)

      const result = await cli.run(['export', '--retro', String(retroId), '--json'])

      expect(result.code).toBe(EXIT.conflict)
      expect(result.error().code).toBe('CONFLICT')
    })

    test('rejects a format it does not implement, rather than pretending', async () => {
      const retroId = await aFinishedRetro()

      const result = await cli.run([
        'export',
        '--retro',
        String(retroId),
        '--format',
        'md',
        '--json',
      ])

      expect(result.code).toBe(EXIT.usage)
    })

    test('does not offer the deferred selectors at all', async () => {
      // `--project` and `--session --all` would each produce N retrospectives,
      // which the v1 envelope cannot hold. They are deferred until the public
      // contract settles, and the honest way to say "not here" is for the option
      // not to exist: strict mode rejects it as unknown. This test exists so a
      // later stub that accepts the flag and explains itself fails loudly — such
      // a stub would quietly promise a shape nothing implements.
      const byProject = await cli.run(['export', '--project', 'retro', '--json'])
      expect(byProject.code).toBe(EXIT.usage)
      expect(byProject.error().message).toContain('Unknown argument: project')

      const everyOne = await cli.run(['export', '--session', '1', '--all', '--json'])
      expect(everyOne.code).toBe(EXIT.usage)
      expect(everyOne.error().message).toContain('Unknown argument: all')
    })
  })

  /**
   * The reading half of the loop (cli.md `note list`, `revision get`,
   * `comment list`) and the AI's one write back into a review (`comment add`).
   *
   * There were two of each until `r-remove-requests` — `request list` and
   * `request respond` went with the ask channel that was removed, and a
   * comment is the whole of it now.
   *
   * Everything the human writes here has to be written *as* the human, which no
   * CLI command can do — so these tests reach past the CLI to the use cases for
   * their setup, exactly as the server will on the reviewer's behalf.
   */
  describe('reading the human back', () => {
    function asHuman(): App {
      return createApp(cli.store, { clock: cli.clock })
    }

    describe('note list', () => {
      test('returns { sessionId, notes } with the AI notes only', async () => {
        const sessionId = await aSession()
        await cli.run(['note', 'add', '--session', String(sessionId), '--text', 'ai wrote this'])
        await asHuman().notes.addHuman.execute({
          actor: 'human',
          session: sessionId,
          text: 'the human wrote this',
        })

        const result = await cli.run(['note', 'list', '--session', String(sessionId), '--json'])

        const stored = (await cli.store.notes.listBySession(sessionId, { author: 'ai' }))[0]
        expect(result.code).toBe(EXIT.ok)
        expect(result.json()).toEqual({
          sessionId,
          notes: [
            {
              noteId: stored?.id,
              author: 'ai',
              kind: 'human-cost',
              text: 'ai wrote this',
              at: '2026-08-23T09:00:00.000Z',
              annotation: null,
            },
          ],
        })
      })

      test('includes human notes and annotations with --with-human', async () => {
        const sessionId = await aSession()
        await cli.run(['note', 'add', '--session', String(sessionId), '--text', 'ai wrote this'])
        const aiNote = (await cli.store.notes.listBySession(sessionId, { author: 'ai' }))[0]
        await asHuman().notes.annotate.execute({
          actor: 'human',
          noteId: aiNote?.id as number,
          text: 'it is worse than that',
        })
        await asHuman().notes.addHuman.execute({
          actor: 'human',
          session: sessionId,
          text: 'the human wrote this',
        })

        const result = await cli.run([
          'note',
          'list',
          '--session',
          String(sessionId),
          '--with-human',
          '--json',
        ])

        const notes = result.jsonAs<{ notes: readonly Record<string, unknown>[] }>().notes
        expect(notes).toEqual([
          {
            noteId: aiNote?.id,
            author: 'ai',
            kind: 'human-cost',
            text: 'ai wrote this',
            at: '2026-08-23T09:00:00.000Z',
            annotation: { text: 'it is worse than that', at: '2026-08-23T09:00:00.000Z' },
          },
          {
            noteId: expect.any(Number),
            author: 'human',
            kind: null,
            text: 'the human wrote this',
            at: '2026-08-23T09:00:00.000Z',
            annotation: null,
          },
        ])
      })

      test('is exit 3 for a session that does not exist', async () => {
        expect((await cli.run(['note', 'list', '--session', '404', '--json'])).code).toBe(
          EXIT.notFound,
        )
      })
    })

    describe('revision get', () => {
      test('returns the revision, its records and its threads', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        await asHuman().decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-stale-lock',
          decision: { state: 'approved', severity: 2, reviewerNote: 'do this one first' },
        })
        await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
          text: 'it also ate the cache',
        })
        const result = await cli.run(['revision', 'get', '--retro', String(retroId), '--json'])

        expect(result.code).toBe(EXIT.ok)
        const body = result.jsonAs<{
          retroId: number
          state: string
          revision: Record<string, unknown>
          records: readonly Record<string, unknown>[]
          threads: readonly Record<string, unknown>[]
        }>()
        expect(body.retroId).toBe(retroId)
        expect(body.state).toBe('reviewing')
        expect(body.revision).toEqual({
          n: 1,
          createdAt: '2026-08-23T09:00:00.000Z',
          records: 1,
        })
        expect(body.records[0]).toEqual({
          rid: 'r-stale-lock',
          num: 1,
          title: 'Deploy blocked on a stale lock file',
          type: 'issue',
          state: 'approved',
          decidedOnRevision: 1,
          carriedOver: false,
          contentChangedSince: null,
          severity: 2,
          solutionLevel: 2,
          selectedSolution: 2,
          involvement: 'pull-request',
          reviewerNote: 'do this one first',
          // The bodies are here in full — this is the form that carries them.
          content: expect.objectContaining({
            problem: 'The deploy waited 40 minutes on a lock nothing held.',
            workaround: 'Delete the lock file by hand.',
          }),
        })
        expect(body.threads).toEqual([
          {
            threadId: expect.any(Number),
            rid: 'r-stale-lock',
            section: 'problem',
            openedAt: '2026-08-23T09:00:00.000Z',
            resolved: false,
            messages: [
              {
                commentId: expect.any(Number),
                actor: 'human',
                text: 'it also ate the cache',
                at: '2026-08-23T09:00:00.000Z',
                revision: 1,
              },
            ],
          },
        ])
        // The `requests` key went with the surface that wrote it
        // (`r-remove-requests`), and this is the contract test that says so: an
        // asserted-absent key on the shape a caller parses. `toEqual` on the
        // whole records object above already rules out `held`/`holdNote`.
        expect(body).not.toHaveProperty('requests')
      })

      test('--feedback-only drops the record bodies and keeps the verdicts', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        await asHuman().decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-stale-lock',
          decision: { state: 'declined', reviewerNote: 'we already fixed this upstream' },
        })

        const result = await cli.run([
          'revision',
          'get',
          '--retro',
          String(retroId),
          '--feedback-only',
          '--json',
        ])

        expect(result.code).toBe(EXIT.ok)
        const body = result.jsonAs<{
          records: readonly Record<string, unknown>[]
          finishMessage: string | null
        }>()
        expect(body.records).toEqual([
          {
            rid: 'r-stale-lock',
            num: 1,
            state: 'declined',
            decidedOnRevision: 1,
            contentChangedSince: null,
            // The dials the human left alone still fell back to the record's own
            // proposals, and the verdict carries what the export would carry.
            severity: 3,
            solutionLevel: 2,
            selectedSolution: 2,
            involvement: 'pull-request',
            reviewerNote: 'we already fixed this upstream',
          },
        ])
        // Present and null on a round they have not finished — the key never comes
        // and goes (`views.ts`), and the AI reads its absence as "no final word".
        expect(body.finishMessage).toBeNull()
      })

      /**
       * `r-finish-confirm-message`: the word the human left finishing the round
       * reaches the drafting step here, on the same read as the verdicts and
       * separately from the comments, which is what it is for.
       */
      test('--feedback-only carries the final message left on the round', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const app = asHuman()
        await app.decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-stale-lock',
          decision: { state: 'approved' },
        })
        await app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Ship this one; open a follow-up for the lock file.',
        })

        const result = await cli.run([
          'revision',
          'get',
          '--retro',
          String(retroId),
          '--feedback-only',
          '--json',
        ])

        expect(result.code).toBe(EXIT.ok)
        expect(result.jsonAs<{ finishMessage: string | null }>().finishMessage).toBe(
          'Ship this one; open a follow-up for the lock file.',
        )
      })

      /** The full projection is deliberately not the feedback one with extras bolted on. */
      test('the full projection carries no finish message', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const app = asHuman()
        await app.decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-stale-lock',
          decision: { state: 'approved' },
        })
        await app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Ship it.',
        })

        const result = await cli.run(['revision', 'get', '--retro', String(retroId), '--json'])

        expect(result.jsonAs<Record<string, unknown>>()).not.toHaveProperty('finishMessage')
      })

      test('reads an older revision with --revision', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        await finishRound(retroId)
        await cli.run([
          'revision',
          'create',
          '--session',
          String(sessionId),
          '--file',
          cli.file(
            'rev2.json',
            aRevisionDraft([{ rid: 'r-stale-lock', num: 1, title: 'Reworded' }]),
          ),
        ])

        const first = await cli.run([
          'revision',
          'get',
          '--retro',
          String(retroId),
          '--revision',
          '1',
          '--json',
        ])
        const latest = await cli.run(['revision', 'get', '--retro', String(retroId), '--json'])

        expect(first.jsonAs<{ revision: { n: number } }>().revision.n).toBe(1)
        expect(latest.jsonAs<{ revision: { n: number } }>().revision.n).toBe(2)
      })

      test('is exit 2 with neither --retro nor --session', async () => {
        const result = await cli.run(['revision', 'get', '--json'])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('--retro or --session')
      })

      test('still demands --session and --file to create', async () => {
        // `create` needs both; `get` needs neither. Relaxing the option for one
        // action must not quietly let the other run without it.
        const noSession = await cli.run(['revision', 'create', '--file', 'x.json', '--json'])
        const noFile = await cli.run(['revision', 'create', '--session', '1', '--json'])

        expect(noSession.code).toBe(EXIT.usage)
        expect(noSession.error().message).toContain('--session')
        expect(noFile.code).toBe(EXIT.usage)
        expect(noFile.error().message).toContain('--file')
      })
    })

    /**
     * The recovery SKILL.md promises when the draft file is gone: each record's
     * `content` is one record of a revision file, with nothing to strip and
     * nothing to rename, so `{records: [...contents]}` submits.
     *
     * It holds because `content` is the stored record itself. That is easy to
     * break by "improving" the projection — adding a computed key, renaming one —
     * and the breakage would only ever surface as an exit 2 in someone else's
     * session, so it is pinned here.
     */
    test('a revision rebuilt from revision get’s content is a revision file', async () => {
      const sessionId = await aSession()
      const retroId = await aRevision(
        sessionId,
        aRevisionDraft([
          { rid: 'r-stale-lock', num: 1 },
          { rid: 'r-slow-tests', num: 2 },
        ]),
      )

      await finishRound(retroId)
      const view = await cli.run(['revision', 'get', '--retro', String(retroId), '--json'])
      const records = view.jsonAs<{ records: readonly { content: unknown }[] }>().records
      const rebuilt = cli.file(
        'rebuilt.json',
        JSON.stringify({ records: records.map((record) => record.content) }),
      )

      const result = await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        rebuilt,
        '--expect-revision',
        '2',
        '--json',
      ])

      expect(result.code).toBe(EXIT.ok)
      expect(result.jsonAs<{ revision: number }>().revision).toBe(2)
    })

    describe('comment list', () => {
      async function aRetroWithThreads(): Promise<number> {
        const sessionId = await aSession()
        const retroId = await aRevision(
          sessionId,
          aRevisionDraft([
            { rid: 'r-stale-lock', num: 1 },
            { rid: 'r-slow-tests', num: 2 },
          ]),
        )
        const app = asHuman()
        await app.threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
          text: 'the human asked something',
        })
        const answered = await app.threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-slow-tests', section: 'direction' },
          text: 'and something here too',
        })
        await app.threads.addComment.execute({
          actor: 'ai',
          retro: { retroId },
          target: { kind: 'thread', threadId: answered.thread.id },
          text: 'the AI answered this one',
        })
        return retroId
      }

      test('returns { retroId, threads } with every message', async () => {
        const retroId = await aRetroWithThreads()

        const result = await cli.run(['comment', 'list', '--retro', String(retroId), '--json'])

        expect(result.code).toBe(EXIT.ok)
        const body = result.jsonAs<{
          retroId: number
          threads: readonly Record<string, unknown>[]
        }>()
        expect(body.retroId).toBe(retroId)
        expect(body.threads).toHaveLength(2)
        expect(body.threads[0]).toEqual({
          threadId: expect.any(Number),
          rid: 'r-stale-lock',
          section: 'problem',
          openedAt: '2026-08-23T09:00:00.000Z',
          resolved: false,
          messages: [
            {
              commentId: expect.any(Number),
              actor: 'human',
              text: 'the human asked something',
              at: '2026-08-23T09:00:00.000Z',
              revision: 1,
            },
          ],
        })
      })

      /**
       * `r-resolvable-comments`: the AI can *see* that the human has settled a
       * thread, and can never settle one itself. Both halves are here, because
       * the read is only worth having if the write really is closed — the CLI
       * writes as `ai` and `ResolveThreadUseCase` refuses that actor.
       */
      test('carries the human’s resolved flag, and offers no flag that writes it', async () => {
        const retroId = await aRetroWithThreads()
        const [settled, open] = await cli.store.threads.listByRetro(retroId)
        await asHuman().threads.resolve.execute({
          actor: 'human',
          threadId: settled?.id ?? 0,
          resolved: true,
        })

        const result = await cli.run(['comment', 'list', '--retro', String(retroId), '--json'])
        const threads = result.jsonAs<{
          threads: readonly { threadId: number; resolved: boolean }[]
        }>().threads

        expect(threads.map((thread) => [thread.threadId, thread.resolved])).toEqual([
          [settled?.id ?? 0, true],
          [open?.id ?? 0, false],
        ])

        // No flag on `comment add` writes it, and yargs runs strict, so asking
        // for one is exit 2 rather than a silently ignored argument.
        for (const flag of ['--resolved', '--resolve', '--unresolve']) {
          const refused = await cli.run([
            'comment',
            'add',
            '--retro',
            String(retroId),
            '--thread',
            String(settled?.id ?? 0),
            '--text',
            'x',
            flag,
          ])
          expect(refused.code, `${flag} was accepted`).toBe(EXIT.usage)
        }
      })

      /** The human-readable line says it too, so a reader of the plain output sees it. */
      test('says so on the plain line for a settled thread, and not for an open one', async () => {
        const retroId = await aRetroWithThreads()
        const [settled] = await cli.store.threads.listByRetro(retroId)
        await asHuman().threads.resolve.execute({
          actor: 'human',
          threadId: settled?.id ?? 0,
          resolved: true,
        })

        const lines = (await cli.run(['comment', 'list', '--retro', String(retroId)])).stdout
          .join('\n')
          .split('\n')

        expect(lines[0]).toContain('· resolved')
        expect(lines[1]).not.toContain('resolved')
      })

      /**
       * The revision each message belongs to: a comment shows the rev number it
       * is associated with, while the thread still shows across all revisions.
       * One thread, two revisions, and the thread is still one thread.
       */
      test('stamps each message with the revision it was written against', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const opened = await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
          text: 'asked against the first draft',
        })
        await finishRound(retroId)
        await aRevision(sessionId)

        await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--thread',
          String(opened.thread.id),
          '--text',
          'answered against the second',
        ])

        const result = await cli.run(['comment', 'list', '--retro', String(retroId), '--json'])
        const threads = result.jsonAs<{
          threads: readonly { messages: readonly { revision: number }[] }[]
        }>().threads

        expect(threads).toHaveLength(1)
        expect(threads[0]?.messages.map((message) => message.revision)).toEqual([1, 2])
      })

      test('--unanswered keeps only the threads whose last message is the human', async () => {
        const retroId = await aRetroWithThreads()

        const result = await cli.run([
          'comment',
          'list',
          '--retro',
          String(retroId),
          '--unanswered',
          '--json',
        ])

        const threads = result.jsonAs<{ threads: readonly { rid: string }[] }>().threads
        expect(threads.map((thread) => thread.rid)).toEqual(['r-stale-lock'])
      })

      /**
       * The threads the human opens on the review itself come back through the
       * same list, with nothing to anchor them (`r-cli-review-thread-reply`):
       * `threadId` is the only handle on one, which is why `comment add --thread`
       * exists.
       */
      test('returns review-level threads with a null rid and section', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'review' },
          text: 'an ask about the whole retro',
        })

        const result = await cli.run([
          'comment',
          'list',
          '--retro',
          String(retroId),
          '--unanswered',
          '--json',
        ])

        const threads = result.jsonAs<{
          threads: readonly { threadId: number; rid: string | null; section: string | null }[]
        }>().threads
        expect(threads).toHaveLength(1)
        expect(threads[0]?.rid).toBeNull()
        expect(threads[0]?.section).toBeNull()
        expect(threads[0]?.threadId).toEqual(expect.any(Number))
      })

      test('--record narrows to one record', async () => {
        const retroId = await aRetroWithThreads()

        const result = await cli.run([
          'comment',
          'list',
          '--retro',
          String(retroId),
          '--record',
          'r-slow-tests',
          '--json',
        ])

        const threads = result.jsonAs<{ threads: readonly { rid: string }[] }>().threads
        expect(threads.map((thread) => thread.rid)).toEqual(['r-slow-tests'])
      })
    })

    describe('comment add', () => {
      test('returns { retroId, threadId, rid, section, commentId, at, revision }', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--section',
          'root_cause',
          '--text',
          'the liveness check lands in revision 2',
          '--json',
        ])

        expect(result.code).toBe(EXIT.ok)
        expect(result.json()).toEqual({
          retroId,
          threadId: expect.any(Number),
          rid: 'r-stale-lock',
          section: 'root_cause',
          commentId: expect.any(Number),
          at: '2026-08-23T09:00:00.000Z',
          revision: 1,
        })
      })

      test('replies into the thread the human already opened', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const opened = await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
          text: 'why did nothing notice?',
        })

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--section',
          'problem',
          '--text',
          'nothing checked the holder was alive',
          '--json',
        ])

        expect(result.jsonAs<{ threadId: number }>().threadId).toBe(opened.thread.id)
        const thread = await cli.store.threads.findById(opened.thread.id)
        expect(thread?.messages.map((message) => message.actor)).toEqual(['human', 'ai'])
      })

      test('writes as the AI and never as the human', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--section',
          'problem',
          '--text',
          'a reply',
          '--json',
        ])

        const threads = await cli.store.threads.listByRetro(retroId)
        expect(
          threads.flatMap((thread) => thread.messages).map((message) => message.actor),
        ).toEqual(['ai'])
      })

      /**
       * The AI's side of a review-level ask (`r-cli-review-thread-reply`).
       *
       * A human can open review-level threads that the CLI once could not answer:
       * `--record` was required, so the reply went through chat instead — off the
       * durable review record, which is the smuggling review-level threads exist to
       * end. The store takes all three targets; these lock the two the CLI was
       * missing.
       */
      test('--thread answers the review-level thread the human opened', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const opened = await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'review' },
          text: 'where do the asks go now?',
        })

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--thread',
          String(opened.thread.id),
          '--text',
          'here, in the thread you opened',
          '--json',
        ])

        expect(result.code).toBe(EXIT.ok)
        expect(result.json()).toEqual({
          retroId,
          threadId: opened.thread.id,
          rid: null,
          section: null,
          commentId: expect.any(Number),
          at: '2026-08-23T09:00:00.000Z',
          revision: 1,
        })
        const thread = await cli.store.threads.findById(opened.thread.id)
        expect(thread?.messages.map((message) => message.actor)).toEqual(['human', 'ai'])
        // And it stops waiting on the AI, which is what `--unanswered` reads.
        const unanswered = await cli.run([
          'comment',
          'list',
          '--retro',
          String(retroId),
          '--unanswered',
          '--json',
        ])
        expect(unanswered.jsonAs<{ threads: readonly unknown[] }>().threads).toBeEmpty()
      })

      test('--thread answers a record-level thread by id too', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const opened = await asHuman().threads.addComment.execute({
          actor: 'human',
          retro: { retroId },
          target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
          text: 'why did nothing notice?',
        })

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--thread',
          String(opened.thread.id),
          '--text',
          'nothing checked the holder was alive',
          '--json',
        ])

        expect(result.json()).toEqual({
          retroId,
          threadId: opened.thread.id,
          rid: 'r-stale-lock',
          section: 'problem',
          commentId: expect.any(Number),
          at: '2026-08-23T09:00:00.000Z',
          revision: 1,
        })
      })

      test('--review opens a new review-level thread anchored to no record', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--review',
          '--text',
          'the export landed at ~/.retroloop/retros/4/retro.json',
          '--json',
        ])

        expect(result.code).toBe(EXIT.ok)
        expect(result.json()).toEqual({
          retroId,
          threadId: expect.any(Number),
          rid: null,
          section: null,
          commentId: expect.any(Number),
          at: '2026-08-23T09:00:00.000Z',
          revision: 1,
        })
        const threads = await cli.store.threads.listByRetro(retroId)
        expect(threads).toHaveLength(1)
        expect(threads[0]?.rid).toBeUndefined()
        expect(threads[0]?.section).toBeUndefined()
      })

      test('is exit 3 for a thread that does not exist', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--thread',
          '404',
          '--text',
          'a reply',
          '--json',
        ])

        expect(result.code).toBe(EXIT.notFound)
      })

      test('is exit 2 for two targets at once, and for --review with a section', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const both = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--review',
          '--record',
          'r-stale-lock',
          '--text',
          'a reply',
          '--json',
        ])
        expect(both.code).toBe(EXIT.usage)
        expect(both.error().message).toContain('not several')

        const sectioned = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--review',
          '--section',
          'problem',
          '--text',
          'a reply',
          '--json',
        ])
        expect(sectioned.code).toBe(EXIT.usage)
        expect(sectioned.error().message).toContain('no --section')
      })

      test('is exit 2 with neither --text nor --file', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--section',
          'problem',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('--text or --file')
      })

      /**
       * Naming no target is exit 2, not a review-level thread by default: a bare
       * `comment add` is a forgotten `--record` far more often than it is a
       * deliberate review-level ask, and inferring the second would open a thread
       * nobody asked for (`r-cli-review-thread-reply`).
       */
      test('is exit 2 naming no target, and names all three', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--text',
          'a reply',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('--thread')
        expect(result.error().message).toContain('--review')
        expect(result.error().message).toContain('--record')
      })

      test('is exit 2 with --record and no --section', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--text',
          'a reply',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
        expect(result.error().message).toContain('needs --section')
      })

      test('is exit 2 for a section the enum does not have', async () => {
        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          '1',
          '--record',
          'r-stale-lock',
          '--section',
          'impact',
          '--text',
          'a reply',
          '--json',
        ])

        expect(result.code).toBe(EXIT.usage)
      })

      test('is exit 4 once the review is closed', async () => {
        const sessionId = await aSession()
        const retroId = await aRevision(sessionId)
        const app = asHuman()
        await app.decisions.record.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-stale-lock',
          decision: { state: 'approved' },
        })
        await app.review.finish.execute({ actor: 'human', retro: { retroId } })
        // What closes a retrospective is the AI's close, not the human's finish
        // (`r-one-finish-button`) — and this is the command that does it.
        expect(
          (await cli.run(['review', 'close', '--retro', String(retroId), '--json'])).code,
        ).toBe(EXIT.ok)

        const result = await cli.run([
          'comment',
          'add',
          '--retro',
          String(retroId),
          '--record',
          'r-stale-lock',
          '--section',
          'problem',
          '--text',
          'one more thing',
          '--json',
        ])

        expect(result.code).toBe(EXIT.conflict)
      })
    })
  })

  describe('global behaviour', () => {
    test('is exit 2 for an unknown command and an unknown option', async () => {
      expect((await cli.run(['frobnicate', '--json'])).code).toBe(EXIT.usage)
      expect((await cli.run(['session', 'create', '--nope', '--json'])).code).toBe(EXIT.usage)
      expect((await cli.run(['--json'])).code).toBe(EXIT.usage)
    })

    test('reports errors as a plain sentence without --json', async () => {
      const result = await cli.run(['record', 'list', '--retro', '404'])

      expect(result.code).toBe(EXIT.notFound)
      expect(result.stderr[0]).toStartWith('retro: ')
      expect(() => result.error()).toThrow()
    })

    test('answers --help and --version at exit 0', async () => {
      // yargs prints help through `console.log`, which it gives no seam for.
      // Capturing it keeps the suite's own output readable.
      const printed: string[] = []
      // biome-ignore lint/suspicious/noConsole: stubbing yargs' only output path.
      const log = console.log
      console.log = (...parts: unknown[]) => printed.push(parts.join(' '))
      try {
        expect((await cli.run(['--help'])).code).toBe(EXIT.ok)
        expect((await cli.run(['--version'])).code).toBe(EXIT.ok)
      } finally {
        console.log = log
      }

      expect(printed.join('\n')).toContain('retroloop session <action>')
    })
  })
})
