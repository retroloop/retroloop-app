import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { loadExportSchema, validate } from '../../packages/core/test/support/json-schema'
import { Given, Then, When } from '../fixtures'
import { aRevisionDraft, type RetroWorld } from '../support/world'

/**
 * The AI's moves are spawned CLI processes and the human's moves go through the
 * page, because that is what they are in the real system: two processes that
 * share only a database, and a person who can only ever act in a browser.
 *
 * Every browser selection is by `data-testid` (testing.md §Determinism).
 */
const schema = loadExportSchema()

async function openReview(page: Page, world: RetroWorld): Promise<void> {
  await page.goto(world.url(`/retros/${world.state.retroId}`))
  await expect(page.getByTestId('review-actions')).toBeVisible()
}

async function approveEveryRecord(page: Page, world: RetroWorld): Promise<void> {
  for (const rid of world.state.rids) {
    await page.getByTestId(`record-${rid}`).getByTestId('approved').click()
    await expect(page.getByTestId(`record-${rid}`).getByTestId('record-state')).toContainText(
      'approved',
    )
  }
}

/* ── the stage ────────────────────────────────────────────────────────────── */

Given('a stage with the server running', async ({ retro }) => {
  await retro.startServer()
})

/* ── what the AI does, as a real process ──────────────────────────────────── */

async function fileRevision(retro: RetroWorld, rids: string[], expectRevision: number) {
  const draft = retro.writeFile(`revision-${expectRevision}.json`, aRevisionDraft(rids))
  const result = await retro.cli(
    'revision',
    'create',
    '--session',
    'uuid-e2e',
    '--file',
    draft,
    '--expect-revision',
    String(expectRevision),
    '--json',
  )
  expect(result.code, `revision create failed: ${result.stderr}`).toBe(0)
  const created = result.json<{ retroId: number; revision: number }>()
  retro.state.retroId = created.retroId
  retro.state.rids = rids
  return created
}

async function registerSession(retro: RetroWorld): Promise<void> {
  const session = await retro.cli(
    'session',
    'create',
    '--claude-session',
    'uuid-e2e',
    '--project',
    'retro',
    '--cwd',
    '/Users/haider/Developer/retro',
    '--branch',
    'main',
    '--supervised',
    '--json',
  )
  expect(session.code, `session create failed: ${session.stderr}`).toBe(0)
  retro.state.sessionId = session.json<{ sessionId: number }>().sessionId

  const note = await retro.cli(
    'note',
    'add',
    '--session',
    'uuid-e2e',
    '--text',
    'The deploy waited on a stale lock again.',
    '--json',
  )
  expect(note.code, `note add failed: ${note.stderr}`).toBe(0)
}

When(
  'the AI registers a session and files a revision with {int} records',
  async ({ retro }, count: number) => {
    await registerSession(retro)
    const rids = Array.from({ length: count }, (_, index) => `r-record-${index + 1}`)
    await fileRevision(retro, rids, 1)
  },
)

Given('the AI has filed a revision with {int} records', async ({ retro }, count: number) => {
  await registerSession(retro)
  const rids = Array.from({ length: count }, (_, index) => `r-record-${index + 1}`)
  await fileRevision(retro, rids, 1)
})

When('the AI files a second revision', async ({ retro }) => {
  await fileRevision(retro, retro.state.rids, 2)
})

When('the AI waits for the review to end', async ({ retro }) => {
  // A second process, blocking on the events table — no server involved.
  retro.state.waiting = retro.background(
    'review',
    'wait',
    '--retro',
    String(retro.state.retroId),
    '--timeout',
    '60',
    '--json',
  )
})

/* ── what the reviewer does, through the page ─────────────────────────────── */

When('the reviewer opens the review', async ({ page, retro }) => {
  await openReview(page, retro)
})

When('the reviewer approves every record', async ({ page, retro }) => {
  await approveEveryRecord(page, retro)
})

/**
 * Two presses since `r-finish-confirm-message`: one arms, one answers. The final
 * message is written here rather than left blank on purpose — this is the only
 * suite where the whole pipeline is real, so it is the only place that proves
 * the word the reviewer typed in the browser reaches the database the CLI reads.
 */
When('the reviewer finishes the review', async ({ page }) => {
  await page.getByTestId('finish-review').click()
  await page.getByTestId('finish-message').fill(FINAL_MESSAGE)
  await page.getByTestId('finish-confirm-submit').click()
  // His side of the round, acknowledged on the page (retro 4
  // `r-one-finish-button`). The retrospective is still `reviewing` here.
  await expect(page.getByTestId('finish-acknowledged')).toBeVisible()
})

/** Distinctive on purpose: nothing else in the loop could produce this string. */
const FINAL_MESSAGE = 'Ship these; the lock one first.'

/**
 * The owner's own gesture, in the one suite where it means anything
 * (`r-finish-button-reenables`): *"when I refreshed the page, the finihs review
 * button is enabled again."*
 *
 * A real reload, against a real server, with a real store that already holds the
 * finish. Suite 4 cannot do this — its mock world lives as long as the module, so
 * a reload there starts a second, empty world and unmakes the very fact the
 * scenario is checking for (`r-mock-world-semantics`). What it proves instead is
 * that the bar recovers after the component and its in-memory state are gone;
 * what only this can prove is that the answer comes off the wire on a page that
 * was never here before.
 */
When('the reviewer reloads the review page', async ({ page }) => {
  await page.reload()
  await expect(page.getByTestId('review-actions')).toBeVisible()
})

/**
 * Both halves of what the refresh used to get wrong: the round still reads as
 * sent, and the button that sends it is unpressable.
 *
 * The second is the one the owner reported and the one a presence check would
 * miss — the Sent mark could render beside a button that had quietly re-enabled,
 * which is a page contradicting itself in exactly the way that invites a second
 * press.
 */
Then('the round is still with the AI, and finishing is not offered again', async ({ page }) => {
  await expect(page.getByTestId('finish-acknowledged')).toBeVisible()
  await expect(page.getByTestId('finish-review')).toBeDisabled()
})

/**
 * The AI's close, run as the AI actually runs it: a spawned CLI process against
 * the same stage, with no server involved.
 */
When('the AI closes the review', async ({ retro }) => {
  const result = await retro.cli(
    'review',
    'close',
    '--retro',
    String(retro.state.retroId),
    '--json',
  )
  expect(result.code, `review close failed: ${result.stderr}`).toBe(0)
})

/* ── what has to be true afterwards ───────────────────────────────────────── */

/**
 * The export's hold state, asserted gone (retro 4 `r-remove-hold`).
 *
 * This step used to read `held` and `holdNote` back off the file. The record
 * removed both, and this is the one layer where the assertion means something:
 * the schema validation above passes either way — `held` stays in
 * `export.v1.schema.json` as an optional read-only property, so that every
 * document written before the removal is still valid — so nothing but reading
 * the real bytes says the builder stopped emitting them.
 *
 * The verdict is read in the same breath. A check that only looked for missing
 * keys would pass on an export document with no records in it at all.
 */
/**
 * The record card, rendering the shape the CLI actually filed — both solutions,
 * in the order they were sent, with the tick already on the recommended one.
 *
 * An exact ordered list rather than a presence check: a page rendering only the
 * recommended solution, or rendering them in the order it happened to iterate,
 * fails here. The titles carry the marker's spoken word as well as its
 * character, because the tab holds both.
 *
 * The marker on a pending record is the **tick**, not the star, since retro 6
 * `r-recommended-preselected`: the recommendation arrives already picked, and
 * the star is what appears on it only once the reviewer has moved the tick
 * somewhere else. Nobody moves it here, so there is no star on this page — which
 * is the state this scenario is about, and it is the reason the export below
 * still records solution 2.
 *
 * The other solution's body is read after opening its tab, which is the whole
 * point of the strip: only the tab being read is in the document, and the
 * footprint is the one field that proves the browser got *that* solution rather
 * than the recommended one twice.
 */
Then('the review page shows both solutions of every record', async ({ page, retro }) => {
  for (const rid of retro.state.rids) {
    const card = page.getByTestId(`record-${rid}`)
    await expect(card.getByTestId(/^solution-tab-\d+$/)).toHaveText([
      'Solution 1 · L1',
      'Solution 2 · L2✓ (selected)',
    ])
    await card.getByTestId('solution-tab-1').click()
    await expect(card.getByTestId('solution-1-footprint')).toHaveText('docs/runbook.md')
  }
})

Then('the export carries the solutions, and the recommended one as selected', async ({ retro }) => {
  const path = retro.state.exportPath
  if (path === undefined) throw new Error('nothing was exported')

  const document = JSON.parse(readFileSync(path, 'utf8')) as {
    records: {
      solutions?: { level: number; recommended: boolean }[]
      selectedSolution?: number
      solutionLevel?: number
      agreedDirection?: string
      footprint?: string
    }[]
  }

  for (const record of document.records) {
    expect(record.solutions?.map((solution) => solution.level)).toEqual([1, 2])
    expect(record.solutions?.map((solution) => solution.recommended)).toEqual([false, true])
    // The reviewer never moved the tick off the recommendation, so the
    // recommendation is what the verdict carried (retro 6
    // `r-recommended-preselected`) — and the level follows the pick rather than
    // being a second answer somebody had to give.
    expect(record.selectedSolution).toBe(2)
    expect(record.solutionLevel).toBe(2)
    // The two keys this shape replaced are absent from a document written today,
    // and still admitted by the contract for the ones written before it.
    expect(Object.keys(record)).not.toContain('agreedDirection')
    expect(Object.keys(record)).not.toContain('footprint')
  }
})

/**
 * `r-finish-confirm-message`, proved where every layer is the real one.
 *
 * The reviewer typed it into a browser; the server wrote it to SQLite in the same
 * transaction as `ReviewFinished`; a spawned CLI process read that database and
 * wrote this file. The suites below each prove their own half against a fake on
 * one side — this is the only place the whole channel is real at once, which is
 * what makes it worth an assertion here rather than one more unit test.
 *
 * Keyed by revision, because the owner asked for the message *per revision
 * round*: the round is what it belongs to, and a reader of a three-round
 * retrospective has to be able to tell which is which.
 */
Then('the export carries the final message the reviewer left on the round', async ({ retro }) => {
  const path = retro.state.exportPath
  if (path === undefined) throw new Error('nothing was exported')

  const document = JSON.parse(readFileSync(path, 'utf8')) as {
    retrospective: { finishMessages?: { revision: number; message: string; at: string }[] }
  }

  expect(
    document.retrospective.finishMessages?.map((one) => [one.revision, one.message]),
    'the word the reviewer typed in the browser never reached the exported file',
  ).toEqual([[1, FINAL_MESSAGE]])
})

Then('the export says nothing about holds', async ({ retro }) => {
  const path = retro.state.exportPath
  if (path === undefined) throw new Error('nothing was exported')

  const raw = readFileSync(path, 'utf8')
  const document = JSON.parse(raw) as { records: Record<string, unknown>[] }
  const first = document.records[0]
  expect(first?.rid).toBe(retro.state.rids[0])
  expect(first?.state).toBe('approved')

  const holdish = document.records.flatMap((record) =>
    Object.keys(record).filter((key) => /hold|held|park/i.test(key)),
  )
  expect(holdish, 'the export document is still carrying hold state').toEqual([])
})

Then(
  "the AI's wait returns {string} for revision {int}",
  async ({ retro }, kind: string, revision: number) => {
    const waiting = retro.state.waiting
    if (waiting === undefined) throw new Error('no `review wait` was started')

    const result = await waiting.finished
    expect(result.code, `review wait failed: ${result.stderr}`).toBe(0)
    expect(result.json()).toEqual({
      kind,
      retroId: retro.state.retroId,
      revision,
      at: expect.any(String),
    })
  },
)

Then('the review is finished', async ({ retro }) => {
  const status = await retro.cli(
    'review',
    'status',
    '--retro',
    String(retro.state.retroId),
    '--json',
  )
  expect(status.json<{ finished: boolean }>().finished).toBe(true)
})

Then('the export validates against export.v1.schema.json', async ({ retro }) => {
  const out = join(retro.dataDir, 'export.json')
  const result = await retro.cli(
    'export',
    '--retro',
    String(retro.state.retroId),
    '--out',
    out,
    '--json',
  )
  expect(result.code, `export failed: ${result.stderr}`).toBe(0)
  retro.state.exportPath = out

  // The file that leaves the product, read back from disk and held to the
  // published contract — not the in-memory object that produced it.
  const document = JSON.parse(readFileSync(out, 'utf8')) as unknown
  expect(validate(document, schema, schema)).toEqual([])
})

Then('the export carries {int} approved records', async ({ retro }, count: number) => {
  const path = retro.state.exportPath
  if (path === undefined) throw new Error('nothing was exported')

  const document = JSON.parse(readFileSync(path, 'utf8')) as {
    records: { state: string }[]
    retrospective: { state: string; reviewed: string }
  }
  expect(document.records).toHaveLength(count)
  expect(document.records.every((record) => record.state === 'approved')).toBe(true)
  expect(document.retrospective).toMatchObject({ state: 'finished', reviewed: 'human' })
})
