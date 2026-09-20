import { expect, type Locator, type Page } from '@playwright/test'
import { Given, Then, When } from '../fixtures'

/**
 * The dashboard's steps. Same rules as the review page's: select by
 * `data-testid` and nothing else, and every reviewer act goes through the page —
 * a row is clicked, the router navigates, the real tRPC client asks the typed
 * mock. Nothing here reaches into the world to arrange an answer.
 *
 * The one exception is the fresh-install flag, which cannot be performed: nothing
 * in the product deletes a retrospective, so no act a reviewer can take gets a
 * store back to empty. It is starting state, not a step reaching past the client.
 */

/** A tile's figure, by the tile's testid. */
function tile(page: Page, id: string): Locator {
  return page.getByTestId(`${id}-value`)
}

/** A row inside the diary, addressed by the retrospective's global id. */
function diaryRow(page: Page, retroId: number): Locator {
  return page.getByTestId(`retro-row-${retroId}`)
}

/* ── opening it ───────────────────────────────────────────────────────────── */

/**
 * Waits on the stat row rather than on any one block: it is the first thing the
 * composition renders that requires *both* queries to have answered, so a step
 * that continued past it would be racing the chart and the diary.
 */
Given('the reviewer opens the dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dashboard-stats')).toBeVisible()
})

Given('the AI has never filed a revision', async ({ page }) => {
  await page.addInitScript(() => {
    window.retroMockFreshInstall = true
  })
})

/** Its own opening step, because the stat row this one waits for is never rendered. */
Given('the reviewer opens the dashboard of a fresh install', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dashboard-empty')).toBeVisible()
})

/**
 * Set before the page is opened, so the first paint is at this size — a layout
 * that only survives being resized after loading is not evidence about the iPad
 * it was opened on.
 */
Given(
  "the reviewer's screen is {int} by {int}",
  async ({ page }, width: number, height: number) => {
    await page.setViewportSize({ width, height })
  },
)

/* ── moving between the pages ─────────────────────────────────────────────── */

When('the reviewer opens retro {int} from the dashboard', async ({ page }, retroId: number) => {
  await diaryRow(page, retroId).click()
  await expect(page.getByTestId('review-actions')).toBeVisible()
})

/**
 * **In-SPA navigation, never a reload.** The typed mock's world is module state in
 * the page, so `page.goto('/')` boots a fresh app and resets every act the
 * scenario performed — which is how a scenario that archives a record and then
 * "opens the dashboard" sees the record un-archived and reports the tile as
 * broken. Following the trail keeps the world, which is the only way a
 * before-and-after assertion on these tiles means anything.
 */
When('the reviewer goes back to the dashboard', async ({ page }) => {
  await page.getByTestId('breadcrumb-crumb').first().click()
  await expect(page.getByTestId('dashboard-stats')).toBeVisible()
})

When('the reviewer opens readings row {int}', async ({ page }, globalId: number) => {
  await page.getByTestId(`readings-row-${globalId}`).click()
})

/* ── the empty page ───────────────────────────────────────────────────────── */

Then('the dashboard says {string}', async ({ page }, line: string) => {
  await expect(page.getByTestId('dashboard-empty')).toHaveText(line)
})

/* ── the band ─────────────────────────────────────────────────────────────── */

/**
 * The count is read off the band's own heading, which carries it in brackets past
 * one — so this asserts the heading the reader sees and the number of rows agree.
 * A band that drew three rows under a heading saying one would be a band nobody
 * could trust.
 */
Then('the band names {int} retrospective(s) in flight', async ({ page }, count: number) => {
  const band = page.getByTestId('live-band')
  await expect(band).toBeVisible()
  await expect(band).toHaveAttribute('data-count', String(count))
  await expect(band.getByTestId(/^live-row-/)).toHaveCount(count)
})

/**
 * The absence half of "exclusively". Asserted as a count of zero rather than as
 * "not visible", because a band rendered off-screen or with zero height is
 * invisible and still present — and what the band promises is that there is
 * nothing there at all.
 */
Then('there is no band for retrospectives in flight', async ({ page }) => {
  await expect(page.getByTestId('live-band')).toHaveCount(0)
})

Then(
  "the band's row for retro {int} is {string}",
  async ({ page }, retroId: number, state: string) => {
    await expect(page.getByTestId(`live-row-${retroId}`).getByTestId('retro-state')).toHaveText(
      state,
    )
  },
)

Then(
  "the band's row for retro {int} shows {int} awaiting the reviewer",
  async ({ page }, retroId: number, pending: number) => {
    await expect(page.getByTestId(`live-row-${retroId}`).getByTestId('live-pending')).toHaveText(
      String(pending),
    )
  },
)

/**
 * The absence of both figures, counted rather than asserted invisible — the same
 * call `there is no band` makes, and for the same reason: a `<dl>` rendered at
 * zero height is invisible and still there, and what the band promises is that a
 * round nobody owes the reviewer anything on carries no numbers at all.
 *
 * Both testids, because the pair is rendered together and dropping one of them
 * would be a half-fix this step has to see.
 */
Then("the band's row for retro {int} shows no figures", async ({ page }, retroId: number) => {
  const row = page.getByTestId(`live-row-${retroId}`)
  await expect(row.getByTestId('live-pending')).toHaveCount(0)
  await expect(row.getByTestId('live-decided')).toHaveCount(0)
})

/**
 * What the row's one control invites the reviewer to do. "Review it" is the
 * call to act and "Open it" is the way in to a round that is not theirs — the
 * word changes with the state, so a row whose tag moved and whose button did
 * not would be sending them back to a review they have already finished.
 */
Then(
  "the band's row for retro {int} offers {string}",
  async ({ page }, retroId: number, label: string) => {
    await expect(page.getByTestId(`live-row-${retroId}`).getByTestId('live-open')).toHaveText(label)
  },
)

/**
 * `toContainText` rather than an exact match: the identity line ends with the
 * relative moment the round opened, and that half depends on the wall clock (see
 * the feature's header). The half asserted here is the part that identifies the
 * retrospective, which is what the step is about.
 */
Then(
  "the band's row for retro {int} identifies it as {string}",
  async ({ page }, retroId: number, identity: string) => {
    await expect(
      page.getByTestId(`live-row-${retroId}`).getByTestId('live-identity'),
    ).toContainText(identity)
  },
)

/* ── the four tiles ───────────────────────────────────────────────────────── */

Then('the dashboard counts {int} records', async ({ page }, total: number) => {
  await expect(tile(page, 'stat-records')).toHaveText(String(total))
})

Then('the dashboard counts {int} still open', async ({ page }, open: number) => {
  await expect(tile(page, 'stat-open')).toHaveText(String(open))
})

Then('the dashboard counts {int} at high severity', async ({ page }, count: number) => {
  await expect(tile(page, 'stat-high-sev')).toHaveText(String(count))
})

/**
 * Both halves of the pair in one step, because the claim is that they are two
 * numbers and not one: a tile that summed them, or that drew the same count
 * twice, passes either assertion taken alone and fails this one on the fixture
 * where the two differ.
 */
Then(
  'the {string} tile reads {int} interactive and {int} pull request',
  async ({ page }, label: string, interactive: number, pullRequest: number) => {
    const box = page.getByTestId('stat-requires-human')
    await expect(box).toContainText(label)
    await expect(page.getByTestId('stat-requires-human-interactive')).toHaveText(
      String(interactive),
    )
    await expect(page.getByTestId('stat-requires-human-pull-request')).toHaveText(
      String(pullRequest),
    )
  },
)

/**
 * **The pair as a document**, which is the half a picture cannot show: a
 * definition list means term then description, and this tile used to write them
 * the other way round to get its value-first look (flagged pre-existing,
 * non-conforming and load-bearing for that look).
 *
 * Read off the tag names in the order the DOM holds them, one group at a time,
 * because that order IS the claim. A count is also checked to be inside the tile
 * the scenario names, so the step cannot pass on somebody else's list.
 */
Then(
  'each count in the {string} tile is a term followed by its description',
  async ({ page }, label: string) => {
    const box = page.getByTestId('stat-requires-human')
    await expect(box).toContainText(label)

    const groups = box.locator('dl > div')
    await expect(groups).toHaveCount(2)
    const shapes = await groups.evaluateAll((nodes) =>
      nodes.map((node) => [...node.children].map((child) => child.tagName).join(' then ')),
    )
    expect(shapes, 'a count in the pair is not a term followed by its description').toEqual([
      'DT then DD',
      'DT then DD',
    ])
  },
)

/**
 * **The same pair as a picture**, and the reason the fix is CSS rather than a
 * markup swap: the tile is read figure-first, with the name under the number.
 *
 * A position assertion, so it is shown to fail rather than trusted
 * (`r-uncontrolled-assertions`) — a column lays itself out top-to-bottom for
 * free, which is exactly how an assertion like this ships green while proving
 * nothing. Fully above, not merely higher: the number's bottom edge clears the
 * label's top, which a two-pixel drift could satisfy the weaker way.
 */
Then(
  'each count in the {string} tile shows its number above its label',
  async ({ page }, label: string) => {
    const box = page.getByTestId('stat-requires-human')
    await expect(box).toContainText(label)

    const groups = box.locator('dl > div')
    await expect(groups).toHaveCount(2)
    for (const group of await groups.all()) {
      const value = await group.locator('dd').boundingBox()
      const term = await group.locator('dt').boundingBox()
      expect(value, 'a count in the pair is not on screen').not.toBeNull()
      expect(term, "a count's label is not on screen").not.toBeNull()
      if (value === null || term === null) continue
      expect(
        value.y + value.height,
        'the number is not above the label it belongs to',
      ).toBeLessThanOrEqual(term.y)
    }
  },
)

/* ── the chart ────────────────────────────────────────────────────────────── */

Then('the chart offers the axes {string}', async ({ page }, axes: string) => {
  const wanted = axes.split(',').map((axis) => axis.trim())
  const tabs = page.getByTestId('dimension-switch').getByRole('tab')
  await expect(tabs).toHaveCount(wanted.length)
  await expect(tabs).toHaveText(wanted)
})

Then('the chart does not offer the axis {string}', async ({ page }, axis: string) => {
  await expect(
    page.getByTestId('dimension-switch').getByRole('tab', { name: axis, exact: true }),
  ).toHaveCount(0)
})

/**
 * The orientation, one press at a time. Read off the renderer's published
 * `data-orientation` rather than off tick coordinates — a coordinate comparison
 * here would be asserting recharts' layout maths, which the browser does half
 * of for free and which would go green for the wrong reason the day it changes.
 *
 * Every tab, not a sample: the rule is about the two that used to be vertical,
 * and a step that checked only the first would prove nothing about them.
 */
Then('every axis draws the chart horizontally', async ({ page }) => {
  const tabs = page.getByTestId('dimension-switch').getByRole('tab')
  const count = await tabs.count()
  expect(count).toBeGreaterThan(0)

  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index)
    const name = (await tab.innerText()).trim()
    await tab.click()
    await expect(page.getByTestId('lifecycle-stack'), `the ${name} axis`).toHaveAttribute(
      'data-orientation',
      'horizontal',
    )
  }
})

/* ── the readings table ───────────────────────────────────────────────────── */

Then('the readings tabs read {string}', async ({ page }, labels: string) => {
  const wanted = labels.split(',').map((label) => label.trim())
  const tabs = page.getByTestId('readings-tabs').getByRole('tab')
  await expect(tabs).toHaveCount(wanted.length)
  await expect(tabs).toHaveText(wanted)
})

Then('the readings table lists {int} row(s)', async ({ page }, count: number) => {
  await expect(page.getByTestId('readings-table').getByTestId(/^readings-row-/)).toHaveCount(count)
})

/* ── the diary ────────────────────────────────────────────────────────────── */

Then('the diary holds {int} sitting(s)', async ({ page }, count: number) => {
  await expect(page.getByTestId('diary').getByTestId(/^session-card-/)).toHaveCount(count)
})

/**
 * The sessions the diary is grouped into, in the order it draws them. The order is
 * half the claim — sittings descend, so the most recent work is the top card — and
 * asserting the set without the order would pass a diary drawn backwards.
 */
Then("the diary's sittings are sessions {string}", async ({ page }, sessions: string) => {
  const wanted = sessions.split(',').map((session) => `session-card-${session.trim()}`)
  const cards = page.getByTestId('diary').getByTestId(/^session-card-/)
  await expect(cards).toHaveCount(wanted.length)
  const seen = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')),
  )
  expect(seen).toEqual(wanted)
})

Then('the diary lists {int} retrospective(s)', async ({ page }, count: number) => {
  await expect(page.getByTestId('diary').getByTestId(/^retro-row-/)).toHaveCount(count)
})

/**
 * The global ids the rows print, in draw order. This is the diary's second half
 * and the fixture is what gives it teeth: across two sessions the per-session
 * numbers repeat, so a row that had gone back to `retroNumber` reads "Retro 1,
 * Retro 2, Retro 1" and fails here.
 */
Then("the diary's rows are identified {string}", async ({ page }, ids: string) => {
  const wanted = ids.split(',').map((id) => id.trim())
  const labels = page.getByTestId('diary').getByTestId('retro-global-id')
  await expect(labels).toHaveCount(wanted.length)
  await expect(labels).toHaveText(wanted)
})

Then(
  "the diary's row for retro {int} shows the name {string}",
  async ({ page }, retroId: number, name: string) => {
    await expect(diaryRow(page, retroId).getByTestId('retro-name')).toHaveText(name)
  },
)

/**
 * The state tag on a diary row — the same component and the same word the band
 * above it and the review page's header carry (`retro-state.tsx`). Read on the
 * row rather than on the page, because the diary lists every retrospective and
 * the assertion is about one of them.
 */
Then(
  "the diary's row for retro {int} is {string}",
  async ({ page }, retroId: number, state: string) => {
    await expect(diaryRow(page, retroId).getByTestId('retro-state')).toHaveText(state)
  },
)

/**
 * The pending count gone, not zero. The diary hides it off the same reading the
 * band hides its figures off — a round that has been put down is not a round
 * anything is owed on — and "0 pending" beside a tag that says SUBMITTED would
 * be the page arguing with itself.
 */
Then(
  "the diary's row for retro {int} counts nothing pending",
  async ({ page }, retroId: number) => {
    await expect(diaryRow(page, retroId).getByTestId('retro-pending')).toHaveCount(0)
  },
)

/**
 * Two different states never wear one look, in whichever theme the scenario put
 * the page in (`r-theme-blind-assertions`).
 *
 * Grouped by the word rather than compared pairwise: the same state appears
 * several times on this page — the band and the diary both draw the round in
 * flight, and the diary draws every finished retro — so "all tags differ" would
 * be false about a correct page. What must differ is one *word* from another.
 *
 * Two channels, because a fill and an ink are two rules and a dark override that
 * suppresses one leaves the other standing. A transparent fill is refused
 * outright: an undefined token paints nothing and would otherwise "differ" from
 * every other state by being absent.
 */
Then('no two retro states on the dashboard share a look', async ({ page }) => {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  const looks = await page.getByTestId('retro-state').evaluateAll((tags) =>
    tags.map((tag) => {
      const style = getComputedStyle(tag)
      return { word: tag.textContent?.trim() ?? '', fill: style.backgroundColor, ink: style.color }
    }),
  )

  const byWord = new Map<string, { fill: string; ink: string }>()
  for (const look of looks) {
    expect(look.fill, `the ${look.word} tag is painted with nothing`).not.toBe('rgba(0, 0, 0, 0)')
    expect(look.ink, `the ${look.word} tag's ink is its own fill`).not.toBe(look.fill)
    const seen = byWord.get(look.word)
    if (seen === undefined) byWord.set(look.word, look)
    else expect(seen, `two ${look.word} tags are drawn differently`).toEqual(look)
  }
  expect(byWord.size, 'only one state is on the page, so nothing is being told apart').toBe(2)

  const drawn = [...byWord.entries()]
  for (const [word, look] of drawn) {
    for (const [otherWord, other] of drawn) {
      if (word === otherWord) continue
      expect(look.fill, `${word} and ${otherWord} share a fill`).not.toBe(other.fill)
      expect(look.ink, `${word} and ${otherWord} share an ink`).not.toBe(other.ink)
    }
  }
})

/**
 * The machine-readable instant, which is where a `<time>` element is supposed to
 * carry it and is the half that does not depend on the machine's locale or on when
 * the suite ran. The rendered words are proved against an injected clock in
 * `test/relative-when.spec.ts`.
 */
Then(
  'the sitting for session {int} is stamped {string}',
  async ({ page }, sessionId: number, iso: string) => {
    await expect(
      page.getByTestId(`session-card-${sessionId}`).getByTestId('session-time'),
    ).toHaveAttribute('datetime', iso)
  },
)

/* ── the page itself ──────────────────────────────────────────────────────── */

Then('the page does not scroll sideways', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

/* ── the chrome this page shares with every other ─────────────────────────── */

/**
 * These three belong to `chrome.feature` and live here because the dashboard is
 * the page it opens them on. They survived the dashboard's recomposition
 * unchanged: nothing in that redesign went near the header, which is separate
 * work.
 */
Then('the top menu names the app {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId('app-brand')).toHaveText(name)
})

/**
 * A breadcrumb with no parent to lead to is not a shortened trail, it is a
 * control that earned nothing — so on the dashboard the bar is absent rather than
 * rendered with one crumb in it (`chrome/app-shell.tsx`).
 */
Then('the page carries no trail', async ({ page }) => {
  await expect(page.getByTestId('breadcrumb-bar')).toHaveCount(0)
})

/**
 * A position assertion, so it is shown to fail rather than trusted: the browser
 * lays out a document top-to-bottom for free, which is exactly how an assertion
 * like this ships green while proving nothing (`r-uncontrolled-assertions`).
 */
Then('the trail sits below the top menu', async ({ page }) => {
  const menu = await page.getByTestId('app-brand').boundingBox()
  const trail = await page.getByTestId('breadcrumb-bar').boundingBox()
  expect(menu, 'the top menu is not on screen').not.toBeNull()
  expect(trail, 'the trail is not on screen').not.toBeNull()
  if (menu === null || trail === null) return
  expect(trail.y, 'the trail overlaps the top menu').toBeGreaterThanOrEqual(menu.y + menu.height)
})

/**
 * Where a readings row lands. The number in the URL and the number on the page
 * are the same global id, which is what makes a row something a reader can cite.
 */
Then('the record page shows record {int}', async ({ page }, globalId: number) => {
  await expect(page.getByTestId('record-num')).toHaveText(`#${globalId}`)
})

/* ── the Require human cut ───────────────────────────────────────────────── */

When('the reviewer opens the {string} cut', async ({ page }, label: string) => {
  await page
    .getByTestId('readings-tabs')
    .getByRole('tab', { name: new RegExp(`^${label}`) })
    .click()
})

/**
 * That every row the cut lists genuinely belongs in it — checked through what the
 * row *shows*, not through what produced it. A row in this cut must be open (the
 * lifecycle tag says so) and must be one of the two involvements the tile counts.
 *
 * The involvement is not on the row's face, so what this can assert is the half
 * that is: the cut must contain no closed record. Paired with the count equality
 * in the scenario above — the tab lists exactly as many rows as the tile counts —
 * a predicate that had drifted to some other set would have to match both the
 * cardinality and the open-ness to slip through, which the fixture does not allow.
 */
Then('every row in the readings table needs a human', async ({ page }) => {
  const tags = page.getByTestId('readings-table').getByTestId('record-lifecycle')
  const count = await tags.count()
  expect(count, 'the cut listed no rows at all').toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await expect(tags.nth(index), `row ${index + 1} of the Require human cut`).toHaveText('open')
  }
})
