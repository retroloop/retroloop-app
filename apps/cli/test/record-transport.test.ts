import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createApp, openSqliteStore } from '@retro/core'
import { EXIT } from '#errors'
import { aRevisionDraft, type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/**
 * **The transport test** — the AI actor can never write a human
 * field, proven against the real store rather than asserted at the use case.
 *
 * The lane gives the AI three new writes: a claim, a release, and the resolve
 * that clears a claim. Each of them touches a record the human decided, in a
 * retrospective he finished, beside tables full of his words — which is exactly
 * the shape in which a write that reached one column too far would be
 * invisible. So this runs the CLI over a **real SQLite file**, photographs every
 * human-owned table before, runs the whole lane, and compares the photographs
 * byte for byte.
 *
 * Three things make it worth its cost over the in-process suites:
 *
 * 1. **It is the real adapter.** The memory store and SQLite are held together
 *    by the contract suites, and the claim's `claimed` column is a 0/1 bit —
 *    the class of difference those suites exist for.
 * 2. **It reads the database, not the API.** A read model that quietly dropped a
 *    human column would pass every assertion made through the App; `SELECT *`
 *    cannot.
 * 3. **It is the whole command path.** Argument parsing, the exit map, the store
 *    opened and closed per command — the same `run()` the binary calls.
 *
 * The snapshot is the **whole row dump** of each table rather than a count,
 * because the failure this is aimed at is a rewritten value and not a missing
 * row: an AI that edited a reviewer's note in place would leave every count
 * exactly where it was.
 */

/** Every table in this schema a human writes, or writes with. */
const HUMAN_TABLES = [
  'decisions',
  'comment_threads',
  'comments',
  'thread_resolutions',
  'holds',
  'annotations',
  'finish_messages',
  'record_labels',
  'record_attribute_values',
  'label_definitions',
  'attribute_definitions',
  'settings',
  'notes',
  'sessions',
  'retrospectives',
  'revisions',
] as const

type Snapshot = Record<string, string>

/** Every row of every human table, as text, ordered so the comparison is stable. */
function photograph(file: string): Snapshot {
  const db = new Database(file, { readonly: true })
  try {
    const rows: Snapshot = {}
    for (const table of HUMAN_TABLES) {
      rows[table] = JSON.stringify(db.query(`SELECT * FROM ${table} ORDER BY id`).all())
    }
    return rows
  } finally {
    db.close()
  }
}

/** The `actor` column of the three tables both actors write, in insertion order. */
function actors(file: string, table: string): string[] {
  const db = new Database(file, { readonly: true })
  try {
    return db
      .query<{ actor: string }, []>(`SELECT actor FROM ${table} ORDER BY id`)
      .all()
      .map((row) => row.actor)
  } finally {
    db.close()
  }
}

let cli: Cli
let file: string
let retroId: number
let ids: Record<string, number>

beforeEach(async () => {
  // The real adapter, pointed at the harness's throwaway stage — the same
  // `openStore` seam production wires, with nothing else swapped.
  cli = createCli({ openStore: (stage) => openSqliteStore({ dataDir: stage.dataDir }) })
  file = join(cli.dataDir, 'retro.db')

  const store = openSqliteStore({ dataDir: cli.dataDir })
  const app = createApp(store, { clock: cli.clock })

  const { session } = await app.sessions.create.execute({
    actor: 'ai',
    claudeSession: 'uuid-transport',
    project: 'retro',
    cwd: '/tmp/retro',
  })
  const created = await app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: JSON.parse(
      aRevisionDraft([
        { rid: 'r-stale-lock', num: 1 },
        { rid: 'r-noisy-hook', num: 2 },
      ]),
    ) as unknown,
  })
  retroId = created.retroId

  // The human's half, in full: a note on the verdict, a comment on the record,
  // and a remark about the round — the three shapes of his prose in one store.
  await app.threads.addComment.execute({
    actor: 'human',
    retro: { retroId },
    target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
    text: 'This cost me the whole afternoon.',
  })
  await app.threads.addComment.execute({
    actor: 'human',
    retro: { retroId },
    target: { kind: 'review' },
    text: 'Good round; do the lock one first.',
  })
  await app.decisions.record.execute({
    actor: 'human',
    retro: { retroId },
    rid: 'r-stale-lock',
    decision: { state: 'approved', selectedSolution: 2, reviewerNote: 'Start with this one.' },
  })
  await app.decisions.record.execute({
    actor: 'human',
    retro: { retroId },
    rid: 'r-noisy-hook',
    decision: { state: 'approved' },
  })
  await app.review.finish.execute({ actor: 'human', retro: { retroId } })
  await app.review.close.execute({ actor: 'ai', retro: { retroId } })

  ids = {
    lock: (await store.recordIds.findByRecord(retroId, 'r-stale-lock'))?.id ?? 0,
    hook: (await store.recordIds.findByRecord(retroId, 'r-noisy-hook'))?.id ?? 0,
  }

  // Closed before the CLI runs: two connections on one file is what production
  // does, and it is not what this test is about.
  await store.close()
})

test('the lane’s writes leave every human-owned table byte for byte as it was', async () => {
  const before = photograph(file)

  const claimed = await cli.run(['record', 'claim', String(ids.lock), '--json'])
  const released = await cli.run(['record', 'unclaim', String(ids.lock), '--json'])
  const again = await cli.run(['record', 'claim', String(ids.lock), '--json'])
  const resolved = await cli.run([
    'record',
    'resolve',
    'r-stale-lock',
    '--retro',
    String(retroId),
    '--ref',
    'abc123',
    '--json',
  ])
  const related = await cli.run([
    'record',
    'relate',
    String(ids.lock),
    String(ids.hook),
    '--how',
    'same lock',
    '--json',
  ])

  for (const result of [claimed, released, again, resolved, related]) {
    expect(result.code).toBe(EXIT.ok)
  }

  // The assertion the file exists for. Compared table by table rather than as
  // one blob, so a failure names the column the AI reached into.
  const after = photograph(file)
  for (const table of HUMAN_TABLES) {
    expect(`${table}: ${after[table]}`).toBe(`${table}: ${before[table]}`)
  }
})

test('every row the AI wrote says so, in all three tables that record an actor', async () => {
  await cli.run(['record', 'claim', String(ids.lock), '--json'])
  await cli.run(['record', 'unclaim', String(ids.lock), '--json'])
  await cli.run(['record', 'claim', String(ids.lock), '--json'])
  await cli.run([
    'record',
    'resolve',
    'r-stale-lock',
    '--retro',
    String(retroId),
    '--ref',
    'abc123',
    '--json',
  ])
  await cli.run([
    'record',
    'relate',
    String(ids.lock),
    String(ids.hook),
    '--how',
    'same lock',
    '--json',
  ])

  // Four claim rows: taken, given back, taken again, and released by the
  // resolve — every one of them the AI's, because the CLI writes as `ai` and
  // nothing else.
  expect(actors(file, 'record_claims')).toEqual(['ai', 'ai', 'ai', 'ai'])
  expect(actors(file, 'record_lifecycle')).toEqual(['ai'])
  expect(actors(file, 'record_relations')).toEqual(['ai'])
})

/**
 * **The resolve takes the marker down and the record leaves the queue**, read
 * back through the same commands an agent would use — which is the loop this
 * feature exists for, end to end on the real store.
 */
test('the resolve clears the claim, and the record leaves the queue', async () => {
  await cli.run(['record', 'claim', String(ids.lock), '--json'])

  const held = await cli.run(['record', 'get', String(ids.lock), '--json'])
  expect(held.json()).toMatchObject({
    claim: { claimedAt: '2026-08-23T09:00:00.000Z', actor: 'ai' },
    lifecycle: { state: 'in-progress' },
  })

  await cli.run([
    'record',
    'resolve',
    'r-stale-lock',
    '--retro',
    String(retroId),
    '--ref',
    'abc123',
    '--json',
  ])

  const after = await cli.run(['record', 'get', String(ids.lock), '--json'])
  expect(after.json()).toMatchObject({
    claim: null,
    resolved: true,
    lifecycle: { state: 'resolved', ref: 'abc123', claimedAt: null },
  })

  const queue = await cli.run(['record', 'queue', '--json'])
  expect(
    (JSON.parse(queue.stdout[0] as string) as { slug: string }[]).map((row) => row.slug),
  ).toEqual(['r-noisy-hook'])
})
