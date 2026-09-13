import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { type App, createApp } from '@retro/core'
import { EXIT } from '#errors'
import { aRevisionDraft, type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/** The one timestamp the harness's frozen clock writes (testing.md §Determinism). */
const AT = '2026-08-23T09:00:00.000Z'

type FinishedRow = {
  retroId: number
  retro: number
  sessionId: number
  claudeSession: string
  finishedAt: string
  closed: boolean
  counts: Record<string, number>
}

/**
 * `review list --finished` — the catch-up read, for the agent that was not
 * waiting when the human pressed Finish.
 *
 * `review wait` answers about one retrospective and only about a finish that
 * lands while it blocks. An agent resuming a session, or picking up a stage it
 * has never read, has nothing to ask instead: the dashboard's list says which
 * retrospectives exist, not which rounds are waiting on an answer. This is that
 * question, and it names no retrospective and no session.
 *
 * The decisions and the finishes are taken **through the App as the human**,
 * because the CLI acts as `ai` and has no command for either — which is the
 * actor rule holding in the suite as well as in the product.
 */
describe('review list --finished', () => {
  let cli: Cli
  let human: App

  beforeEach(() => {
    cli = createCli()
    human = createApp(cli.store, { clock: cli.clock })
  })

  const startSession = async (claudeSession: string): Promise<number> =>
    (
      await cli.run([
        'session',
        'create',
        '--claude-session',
        claudeSession,
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--json',
      ])
    ).jsonAs<{ sessionId: number }>().sessionId

  let drafts = 0
  const fileRevision = async (
    sessionId: number,
    records: readonly { rid: string; num: number }[],
  ): Promise<number> => {
    drafts += 1
    const path = cli.file(`draft-${drafts}.json`, aRevisionDraft(records))
    return (
      await cli.run([
        'revision',
        'create',
        '--session',
        String(sessionId),
        '--file',
        path,
        '--json',
      ])
    ).jsonAs<{ retroId: number }>().retroId
  }

  /** The human's half of the round: a verdict on each record, then Finish. */
  const decideAndFinish = async (
    retroId: number,
    verdicts: readonly (readonly [string, 'approved' | 'declined'])[],
  ): Promise<void> => {
    for (const [rid, state] of verdicts) {
      await human.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state },
      })
    }
    await human.review.finish.execute({ actor: 'human', retro: { retroId } })
  }

  /**
   * The stage the rest of this suite reads: two sessions, three retrospectives,
   * one of each reading. Returns what the rows are expected to say about them.
   */
  async function aStage(): Promise<{
    readonly sessionId: number
    readonly closed: number
    readonly submitted: number
    readonly reviewing: number
  }> {
    const sessionId = await startSession('uuid-a')
    const closed = await fileRevision(sessionId, [
      { rid: 'r-stale-lock', num: 1 },
      { rid: 'r-slow-tests', num: 2 },
    ])
    await decideAndFinish(closed, [
      ['r-stale-lock', 'approved'],
      ['r-slow-tests', 'declined'],
    ])
    await cli.run(['review', 'close', '--retro', String(closed), '--json'])

    // Another session's round, still with the human — started between the two
    // of the first session, so its id sits between theirs and the ordinal below
    // cannot be the id wearing a different name.
    const otherSession = await startSession('uuid-b')
    const reviewing = await fileRevision(otherSession, [{ rid: 'r-flaky-ci', num: 1 }])

    const submitted = await fileRevision(sessionId, [{ rid: 'r-stale-lock', num: 1 }])
    await decideAndFinish(submitted, [['r-stale-lock', 'approved']])

    return { sessionId, closed, submitted, reviewing }
  }

  test('lists every finished round oldest first, with its ordinal, state and counts', async () => {
    const stage = await aStage()

    const result = await cli.run(['review', 'list', '--finished', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<FinishedRow[]>()).toEqual([
      {
        retroId: stage.closed,
        retro: 1,
        sessionId: stage.sessionId,
        claudeSession: 'uuid-a',
        finishedAt: AT,
        closed: true,
        counts: { pending: 0, approved: 1, declined: 1, revise: 0, hold: 0, total: 2 },
      },
      {
        retroId: stage.submitted,
        // The second retrospective **of its session**, though the third on the
        // stage: "Retro #n" is a position within a session and the id is not.
        retro: 2,
        sessionId: stage.sessionId,
        claudeSession: 'uuid-a',
        finishedAt: AT,
        // He has finished it and the AI has not closed it — the window that
        // makes this list worth reading.
        closed: false,
        counts: { pending: 0, approved: 1, declined: 0, revise: 0, hold: 0, total: 1 },
      },
    ])
    expect(result.jsonAs<FinishedRow[]>().map((row) => row.retroId)).not.toContain(stage.reviewing)
  })

  test('answers with an empty array when no round has been put down', async () => {
    const sessionId = await startSession('uuid-open')
    await fileRevision(sessionId, [{ rid: 'r-stale-lock', num: 1 }])

    const result = await cli.run(['review', 'list', '--finished', '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<FinishedRow[]>()).toEqual([])
  })

  /**
   * The shape a monitor script parses, locked by its sorted key list: a key
   * added here silently would widen a contract nobody re-reads.
   */
  test('answers in exactly the keys cli.md pins', async () => {
    await aStage()

    const result = await cli.run(['review', 'list', '--finished', '--json'])

    expect(Object.keys(result.jsonAs<FinishedRow[]>()[0] ?? {}).sort()).toEqual([
      'claudeSession',
      'closed',
      'counts',
      'finishedAt',
      'retro',
      'retroId',
      'sessionId',
    ])
  })

  /**
   * `list` is offered for one question today. A bare `review list` is far more
   * likely a forgotten flag than a request for everything, and answering it with
   * every retrospective would be the CLI inferring what was meant.
   */
  test('is exit 2 without --finished', async () => {
    const result = await cli.run(['review', 'list', '--json'])

    expect(result.code).toBe(EXIT.usage)
    expect(result.error().code).toBe('USAGE')
    expect(result.stdout).toBeEmpty()
  })

  test('is exit 2 when --finished is asked of another action', async () => {
    const sessionId = await startSession('uuid-c')
    const retroId = await fileRevision(sessionId, [{ rid: 'r-stale-lock', num: 1 }])

    const result = await cli.run([
      'review',
      'status',
      '--finished',
      '--retro',
      String(retroId),
      '--json',
    ])

    expect(result.code).toBe(EXIT.usage)
    expect(result.error().code).toBe('USAGE')
  })

  test('says it in one line per row for a reader', async () => {
    const stage = await aStage()

    const result = await cli.run(['review', 'list', '--finished'])

    expect(result.stdout.join('\n')).toBe(
      `Retro ${stage.closed} (#1 of session ${stage.sessionId}) finished ${AT}, closed — 1 approved, 1 declined, 0 to revise\n` +
        `Retro ${stage.submitted} (#2 of session ${stage.sessionId}) finished ${AT} — 1 approved, 0 declined, 0 to revise`,
    )
  })

  test('says so plainly when nothing is finished', async () => {
    const result = await cli.run(['review', 'list', '--finished'])

    expect(result.stdout).toEqual(['No finished retrospectives.'])
  })
})
