import { expect, type Locator, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import type { MockControl } from '../../test/trpc-mock'
import { Given, Then, When } from '../fixtures'

/**
 * The flat records page's steps. The same two rules the review page's obey:
 * select by `data-testid` and nothing else, and every *reviewer* act goes
 * through the page — the click reaches the real component, the component calls
 * the real tRPC client, and the client reaches the typed mock. Only the AI's
 * moves are driven from outside, because the AI is a different process in the
 * real system too.
 *
 * Everything here addresses a record by **`(retro, rid)`**, never by rid alone.
 * That is the identity a record actually has (a rid is minted per
 * retrospective), and the fixture mints `r-stale-lock` in two of them — so a
 * step that took a bare rid would be a step that could not say which record it
 * meant, on the one page where the difference exists.
 */

type MockWindow = Window & { readonly retroMock: MockControl }

function row(page: Page, retroId: number, rid: string): Locator {
  return page.getByTestId(`records-row-${retroId}-${rid}`)
}

/**
 * Every row on the page, in document order.
 *
 * The pattern matches `records-row-<digits>-<rid>` and therefore only the row
 * articles: every part *inside* a row is `records-row-<word>`, so a testid like
 * `records-row-severity` cannot be counted as a row.
 */
function rows(page: Page): Locator {
  return page.getByTestId(/^records-row-\d+-/)
}

/**
 * The resolve composer, addressed at page level rather than inside its row.
 *
 * `PopoverContent` renders through a portal, so the panel is not a descendant of
 * the row whose button opened it — and only one is ever open, because opening a
 * second dismisses the first. Reaching for it inside the row would find nothing,
 * which is a failure that says the wrong thing.
 */
function resolvePanel(page: Page): Locator {
  return page.getByTestId('record-resolve-panel')
}

/* ── opening it ───────────────────────────────────────────────────────────── */

/**
 * The stage as it is by the time a cross-retro page is worth having: three
 * retrospectives across two sessions and two working directories, two of them
 * already closed.
 *
 * Arranged before the app boots and read once by the mock's own fixture
 * (`crossRetro` in `test/trpc-mock.ts`), because it cannot be performed —
 * nothing a browser can do starts a retrospective, let alone one in another
 * session and another checkout. It is starting state, not a step reaching past
 * the tRPC client.
 */
Given('the stage holds the retrospectives of two sessions', async ({ page }) => {
  await page.addInitScript(() => {
    window.retroMockCrossRetro = true
  })
})

Given('the reviewer opens the records page', async ({ page }) => {
  await page.goto('/records')
  await expect(page.getByTestId('records-list')).toBeVisible()
})

/** Its own opening step, because the list this one waits for is never rendered. */
Given('the reviewer opens the records page of a fresh install', async ({ page }) => {
  await page.goto('/records')
  await expect(page.getByTestId('records-empty')).toBeVisible()
})

/**
 * The row is the way to the record, and the record is on a page of its own. It
 * used to land on the record's review page instead, which was read as a bug.
 *
 * The wait is on the record's heading being in the document and nothing more:
 * *which* record arrived is the next step's question, and answering it here
 * would hide a link that went to the wrong one.
 */
When(
  'the reviewer opens record {string} of retro {int} from the records page',
  async ({ page }, rid: string, retroId: number) => {
    await row(page, retroId, rid).getByTestId('records-row-link').click()
    await expect(page.getByTestId('record-title')).toBeVisible()
  },
)

/* ── the filters ──────────────────────────────────────────────────────────── */

/**
 * The chips are independent toggles, so the step asserts the chip it pressed is
 * in the state its name claims: a filter whose state the reader cannot see is a
 * filter they cannot trust.
 */
When('the reviewer filters to {string} records', async ({ page }, status: string) => {
  const chip = page.getByTestId(`records-filter-${status}`)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
})

When('the reviewer filters to the verdict {string}', async ({ page }, verdict: string) => {
  await withFilterPanel(page, async () => {
    const option = page.getByTestId(`records-filter-verdict-${verdict}`)
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  })
})

When('the reviewer filters to the requester {string}', async ({ page }, party: string) => {
  await withFilterPanel(page, async () => {
    const option = page.getByTestId(`records-filter-requester-${party}`)
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  })
})

/**
 * Open the panel, do something in it, and leave it closed.
 *
 * Closing is by Escape rather than by a second press on the trigger: a click
 * lands wherever the panel happens to be and Radix's dismiss layer may take it
 * as the outside press that closes the panel anyway, which would leave the
 * trigger's own state depending on which of the two won. Escape has one meaning.
 * The step is over when the panel is out of the document and the page takes
 * presses again — the same two conditions `chrome.steps.ts` §followAppMenuItem
 * waits on, and the account of *why* lives there rather than in a second copy
 * here. Read it before trusting either: a follow-up measurement checked the
 * swallowed-press hazard both of these comments used to assert and could not
 * reproduce it on `radix-ui` 1.6.7, where the layer releases the body before it
 * unmounts.
 *
 * Exported for `labels.steps.ts`: the label filter is a fourth group in this
 * same panel, and a second copy of this helper would be a second chance to get
 * the Radix dismissal wrong in one of them.
 */
export async function withFilterPanel(page: Page, act: () => Promise<void>): Promise<void> {
  await page.getByTestId('records-filter-more').click()
  await expect(page.getByTestId('records-filter-more-panel')).toBeVisible()

  await act()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('records-filter-more-panel')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      message: 'the closing filter panel is still holding the page',
    })
    .not.toBe('none')
}

/**
 * Every count the table names, read wherever it lives: the lifecycle chips are
 * on the bar and the other two dimensions are behind the icon, so the panel is
 * opened only when the table asks for something inside it.
 *
 * One step for all three dimensions on purpose. The claim these scenarios make
 * is that the counts are over *every* record and do not move as the list
 * narrows, and that claim is about the set of them — asserted one at a time it
 * would be eight scenarios agreeing about nothing in particular.
 */
Then('the filters count:', async ({ page }, table: DataTable) => {
  const wanted = table.hashes().map((entry) => ({
    filter: String(entry.filter),
    count: String(entry.count),
  }))
  const behindTheIcon = wanted.some((one) => one.filter.includes('-'))

  const read = async () => {
    for (const { filter, count } of wanted) {
      await expect(
        page.getByTestId(`records-filter-${filter}-count`),
        `the ${filter} filter's count`,
      ).toHaveText(count)
    }
  }

  if (behindTheIcon) await withFilterPanel(page, read)
  else await read()
})

Then('the filters do not offer {string}', async ({ page }, filter: string) => {
  await withFilterPanel(page, async () => {
    await expect(page.getByTestId(`records-filter-${filter}`)).toHaveCount(0)
  })
})

/* ── what the page shows ──────────────────────────────────────────────────── */

/**
 * Which lifecycle the page opened on, when it opened on one — the deep link's
 * visible half: a page narrowed by an address a reader did not press says so on
 * the chip, or the narrowing is invisible and unexplainable.
 */
Then('the {string} lifecycle chip is pressed', async ({ page }, status: string) => {
  await expect(page.getByTestId(`records-filter-${status}`)).toHaveAttribute('aria-pressed', 'true')
})

/**
 * Nothing narrowed, counted across every chip rather than checked on one.
 *
 * A junk `?lifecycle=` seeds a predicate no row satisfies and presses no chip,
 * so the pair this sits in is what discriminates: the corpus is whole AND the
 * axis is untouched. Named chips would not do — the claim is that the filter
 * holds nothing, not that three particular names are unpressed.
 */
Then('no lifecycle chip is pressed', async ({ page }) => {
  const chips = page.getByTestId('records-lifecycle-filter').getByRole('button')
  await expect(chips).not.toHaveCount(0)
  await expect
    .poll(
      async () =>
        (await chips.evaluateAll((nodes) => nodes.map((node) => node.ariaPressed))).filter(
          (pressed) => pressed === 'true',
        ).length,
      { message: 'a lifecycle chip is pressed' },
    )
    .toBe(0)
})

Then('the records page lists {int} record(s)', async ({ page }, count: number) => {
  await expect(rows(page)).toHaveCount(count)
})

/**
 * The rows on screen, in order, each named by the pair that identifies it.
 *
 * `toHaveAttribute` on the collected testids rather than a per-row existence
 * check: order is the claim — newest retrospective first, each retrospective's
 * records by number — and a set of assertions that each record is *somewhere*
 * would pass on a page that had shuffled them.
 */
Then('the records read, in order:', async ({ page }, table: DataTable) => {
  const wanted = table.hashes().map((entry) => `records-row-${entry.retro}-${entry.rid}`)
  await expect(rows(page)).toHaveCount(wanted.length)
  const shown = await rows(page).evaluateAll((articles) =>
    articles.map((article) => article.getAttribute('data-testid') ?? 'untagged'),
  )
  expect(shown).toEqual(wanted)
})

/**
 * The whole of the empty state, `toHaveText` rather than `toContainText`: the
 * claim is that the page says this one sentence and nothing else, whether it is
 * the emptied filter or the empty product. A panel growing beside either is what
 * this exists to catch.
 */
Then('the records page says {string}', async ({ page }, line: string) => {
  const empty = page.getByTestId('records-empty')
  const emptied = page.getByTestId('records-empty-filter')
  const which = (await empty.count()) > 0 ? empty : emptied
  await expect(which).toHaveText(line)
})

Then(
  'record {string} of retro {int} is titled {string}',
  async ({ page }, rid: string, retroId: number, title: string) => {
    await expect(row(page, retroId, rid).getByTestId('records-row-link')).toContainText(title)
  },
)

Then(
  'record {string} of retro {int} is numbered {string}',
  async ({ page }, rid: string, retroId: number, num: string) => {
    await expect(row(page, retroId, rid).getByTestId('records-row-num')).toHaveText(num)
  },
)

/**
 * Every row's number, read off the page in one pass and compared as a whole.
 *
 * Row by row rather than as a bare list of numbers, and paired with the row's
 * own `(retro, rid)`: the claim is that **this** record carries **that** number,
 * and a list of seven numbers in the right order is also what a page numbering
 * rows by their position would produce.
 */
Then('the records are numbered, in order:', async ({ page }, table: DataTable) => {
  const wanted = table
    .hashes()
    .map((entry) => [`records-row-${entry.retro}-${entry.rid}`, entry.number])

  await expect(rows(page)).toHaveCount(wanted.length)
  const shown = await rows(page).evaluateAll((articles) =>
    articles.map((article) => [
      article.getAttribute('data-testid') ?? 'untagged',
      article.querySelector('[data-testid="records-row-num"]')?.textContent ?? 'unnumbered',
    ]),
  )
  expect(shown).toEqual(wanted)
})

Then(
  'record {string} of retro {int} shows the severity {string}',
  async ({ page }, rid: string, retroId: number, severity: string) => {
    await expect(row(page, retroId, rid).getByTestId('records-row-severity')).toHaveText(severity)
  },
)

Then(
  'record {string} of retro {int} shows the identity {string}',
  async ({ page }, rid: string, retroId: number, identity: string) => {
    await expect(row(page, retroId, rid).getByTestId('records-row-identity')).toHaveText(identity)
  },
)

Then(
  'record {string} of retro {int} was raised by {string}',
  async ({ page }, rid: string, retroId: number, party: string) => {
    await expect(row(page, retroId, rid).getByTestId('records-row-requester')).toHaveText(party)
  },
)

Then(
  'the verdict on record {string} of retro {int} is {string}',
  async ({ page }, rid: string, retroId: number, state: string) => {
    await expect(row(page, retroId, rid).getByTestId('record-state')).toHaveText(state)
  },
)

/** The page's own axis takes the plain phrasing; the verdict says it is one. */
Then(
  'record {string} of retro {int} is {string}',
  async ({ page }, rid: string, retroId: number, status: string) => {
    await expect(row(page, retroId, rid).getByTestId('record-lifecycle')).toHaveText(status)
  },
)

Then(
  'record {string} of retro {int} was resolved by {string}',
  async ({ page }, rid: string, retroId: number, actor: string) => {
    await expect(row(page, retroId, rid).getByTestId('record-evidence-actor')).toHaveText(actor)
  },
)

/**
 * The references in force, in order and whole. A resolve carries every reference
 * it cited, so this asserts the list rather than that one of them is in there
 * somewhere — a page that dropped the second would otherwise pass.
 */
Then(
  'record {string} of retro {int} cites:',
  async ({ page }, rid: string, retroId: number, table: DataTable) => {
    const wanted = table.raw().map(([reference]) => String(reference))
    await expect(row(page, retroId, rid).getByTestId('record-ref')).toHaveText(wanted)
  },
)

/**
 * Nothing at all, which is what an open record has: a reopen supersedes the
 * resolve before it and carries no references of its own, so the evidence block
 * is gone rather than empty.
 */
Then(
  'record {string} of retro {int} cites nothing',
  async ({ page }, rid: string, retroId: number) => {
    await expect(row(page, retroId, rid).getByTestId('record-evidence')).toHaveCount(0)
  },
)

Then(
  'record {string} of retro {int} notes {string}',
  async ({ page }, rid: string, retroId: number, note: string) => {
    await expect(row(page, retroId, rid).getByTestId('record-note')).toHaveText(note)
  },
)

/**
 * A link, asked of the browser rather than of the markup: the claim is that the
 * reader can follow it, so what matters is the element the page laid out and the
 * address it resolved — not whether a class or a component name suggests one.
 */
Then(
  'the reference {string} of record {string} of retro {int} links to it',
  async ({ page }, reference: string, rid: string, retroId: number) => {
    const mark = referenceOn(page, retroId, rid, reference)
    await expect(mark).toHaveJSProperty('tagName', 'A')
    await expect(mark).toHaveAttribute('href', reference)
  },
)

Then(
  'the reference {string} of record {string} of retro {int} is not a link',
  async ({ page }, reference: string, rid: string, retroId: number) => {
    const mark = referenceOn(page, retroId, rid, reference)
    await expect(mark).toBeVisible()
    await expect(mark).not.toHaveJSProperty('tagName', 'A')
  },
)

function referenceOn(page: Page, retroId: number, rid: string, reference: string): Locator {
  return row(page, retroId, rid).getByTestId('record-ref').filter({ hasText: reference })
}

/* ── the lifecycle, as the human takes it ─────────────────────────────────── */

When(
  'the reviewer opens the resolve panel of record {string} of retro {int}',
  async ({ page }, rid: string, retroId: number) => {
    await row(page, retroId, rid).getByTestId('record-resolve').click()
    await expect(resolvePanel(page)).toBeVisible()
  },
)

/** One reference per line, which is what the box says and what it means. */
When('the reviewer cites:', async ({ page }, references: string) => {
  await resolvePanel(page).getByTestId('record-resolve-refs').fill(references)
})

When('the reviewer notes {string}', async ({ page }, note: string) => {
  await resolvePanel(page).getByTestId('record-resolve-note').fill(note)
})

/** The press that asks the server, and the panel closing is the answer landing. */
When('the reviewer resolves it', async ({ page }) => {
  await resolvePanel(page).getByTestId('record-resolve-submit').click()
  await expect(resolvePanel(page)).toHaveCount(0)
})

Then('the resolve cannot be sent', async ({ page }) => {
  await expect(resolvePanel(page).getByTestId('record-resolve-submit')).toBeDisabled()
})

Then('the resolve can be sent', async ({ page }) => {
  await expect(resolvePanel(page).getByTestId('record-resolve-submit')).toBeEnabled()
})

/**
 * One press and no composer, three times over: reopening, archiving and
 * unarchiving all cite nothing, because references belong to the resolve they
 * were given for.
 */
When(
  'the reviewer reopens record {string} of retro {int}',
  async ({ page }, rid: string, retroId: number) => {
    await row(page, retroId, rid).getByTestId('record-reopen').click()
  },
)

When(
  'the reviewer archives record {string} of retro {int}',
  async ({ page }, rid: string, retroId: number) => {
    await row(page, retroId, rid).getByTestId('record-archive').click()
  },
)

When(
  'the reviewer unarchives record {string} of retro {int}',
  async ({ page }, rid: string, retroId: number) => {
    await row(page, retroId, rid).getByTestId('record-unarchive').click()
  },
)

/**
 * Which acts a row offers, whole — asserted as the **set**, because the claim is
 * that a row offers what the domain's transition table permits and nothing else.
 * A control the server would refuse is a control that should not be on screen,
 * and "Archive is there" would pass on a row that still offered Resolve beside
 * it.
 */
Then(
  'record {string} of retro {int} offers only {string}',
  async ({ page }, rid: string, retroId: number, only: string) => {
    await expect(row(page, retroId, rid).getByRole('button')).toHaveText([only])
  },
)

/* ── what the AI does, in its own process ─────────────────────────────────── */

When(
  'the AI resolves record {string} of retro {int}, citing {string}',
  async ({ page }, rid: string, retroId: number, reference: string) => {
    await page.evaluate(
      ({ retroId: retro, rid: record, reference: ref }) => {
        ;(window as unknown as MockWindow).retroMock.aiResolve(retro, record, [ref])
      },
      { retroId, rid, reference },
    )
  },
)

/**
 * The reader comes back to the tab, which is the one signal this page has that
 * something changed in a process it cannot see (no cross-retro event scope,
 * because `events.onRetro` is scoped to one retrospective).
 *
 * The browser's own event, dispatched directly: no Playwright API backgrounds a
 * tab, and what the product listens for is exactly this. It goes to both targets
 * because which one carries the listener is TanStack Query's business and not a
 * thing this step should encode — `visibilitychange` is fired at the document
 * and reaches the window, and dispatching at the window as well costs nothing
 * and survives that detail changing.
 */
When('the reviewer comes back to the tab', async ({ page }) => {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    window.dispatchEvent(new Event('visibilitychange'))
  })
})

/* ── how it looks, in both themes ─────────────────────────────────────────── */

const CHIP_CHANNELS = ['fill', 'ink', 'border'] as const

type ChipLook = {
  readonly pressed: boolean
  readonly channels: Record<(typeof CHIP_CHANNELS)[number], string>
}

/**
 * Which lifecycle chip is on, read off the rendered page channel by channel and
 * in whichever theme the scenario put it in (`r-theme-blind-assertions`).
 *
 * Three channels, because the fill, the ink and the border are three separate
 * rules and a dark override that suppresses one leaves the other two standing —
 * which is how a chosen-verdict styling once shipped green with only its font
 * weight surviving. Transitions are killed before measuring, so what is sampled
 * is where the colours ended rather than where they were passing through.
 */
Then('the pressed lifecycle chip stands out from the unpressed ones', async ({ page }) => {
  await page.mouse.move(0, 0)
  await expect(async () => {
    const looks = await lifecycleChipLooks(page)
    const on = looks.filter((look) => look.pressed)
    const off = looks.filter((look) => !look.pressed)
    expect(on.length, 'no lifecycle chip is pressed').toBe(1)
    expect(off.length, 'no lifecycle chip is unpressed').toBeGreaterThan(0)

    const pressed = on[0]
    if (pressed === undefined) throw new Error('unreachable')
    // Every unpressed chip, not one of them: the axis has three positions now,
    // and a rule that separated the pressed chip from only the first of the
    // others would pass while a second one wore the pressed look.
    for (const unpressed of off) {
      for (const channel of CHIP_CHANNELS) {
        expect(
          unpressed.channels[channel],
          `the pressed chip's ${channel} is an unpressed one's (${pressed.channels[channel]})`,
        ).not.toBe(pressed.channels[channel])
      }
    }
  }).toPass()
})

async function lifecycleChipLooks(page: Page): Promise<ChipLook[]> {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  return page
    .getByTestId('records-lifecycle-filter')
    .getByRole('button')
    .evaluateAll((chips) =>
      chips.map((chip) => {
        const style = getComputedStyle(chip)
        return {
          pressed: chip.getAttribute('aria-pressed') === 'true',
          channels: {
            fill: style.backgroundColor,
            ink: style.color,
            border: style.borderColor,
          },
        }
      }),
    )
}

/* ── the record's own page ────────────────────────────────────────────────── */

/**
 * The record page's own controls, addressed at page level.
 *
 * There is no row to scope inside here — the page *is* one record — so the
 * lifecycle controls, the evidence block and the timeline are all reached
 * directly. That is also why those testids stopped saying `records-row-`: they
 * name a record's lifecycle, and a record has one on two surfaces now
 * (`record-lifecycle.tsx`).
 */
function timelineEntries(page: Page): Locator {
  return page.getByTestId('record-timeline-entry')
}

/**
 * Opened cold, by the URL a reader would paste — which is the number the page
 * shows and the number the row showed. It is a real load, so the mock's world
 * starts fresh; a scenario that has already performed something navigates by a
 * link instead (see the module header on `page.reload()`).
 */
Given('the reviewer opens record {int} directly', async ({ page }, id: number) => {
  await page.goto(`/records/${id}`)
  await expect(page.getByTestId('record-title')).toBeVisible()
})

/**
 * The way to the retrospective this page offers — a way to go to the retro
 * page. A client-side navigation, so the world survives it, and the wait is on
 * the review's own chrome rather than on the landing, which the next step asks
 * about.
 */
When('the reviewer follows the link to the retrospective', async ({ page }) => {
  await page.getByTestId('record-retro-link').click()
  await expect(page.getByTestId('review-actions')).toBeVisible()
})

/** Back to the list, by the middle crumb of `Retro › Records › #n`. */
When('the reviewer follows the records crumb', async ({ page }) => {
  await page.getByTestId('breadcrumb').getByRole('link', { name: 'Records' }).click()
  await expect(page.getByTestId('records-list')).toBeVisible()
})

/**
 * The browser's own back button, after a client-side navigation away — a
 * `popstate` the router handles, not a reload, so the mock's world survives it
 * and what the reviewer just did is still true.
 *
 * If it ever stopped being client-side the scenario using it would fail loudly
 * rather than quietly: it asserts a verdict that only exists because of an act
 * performed on the page it is coming back from.
 */
When('the reviewer goes back to the record page', async ({ page }) => {
  await page.goBack()
  await expect(page.getByTestId('record-timeline')).toBeVisible()
})

Then('the address is {string}', async ({ page }, path: string) => {
  expect(new URL(page.url()).pathname).toBe(path)
})

Then('the record page is numbered {string}', async ({ page }, num: string) => {
  await expect(page.getByTestId('record-num')).toHaveText(num)
})

Then('the record page is titled {string}', async ({ page }, title: string) => {
  await expect(page.getByTestId('record-title')).toHaveText(title)
})

Then('the record page is typed {string}', async ({ page }, type: string) => {
  await expect(page.getByTestId('record-type')).toHaveText(type)
})

Then('the record page was raised by {string}', async ({ page }, party: string) => {
  await expect(page.getByTestId('record-requester')).toHaveText(party)
})

Then('the verdict on the record page is {string}', async ({ page }, state: string) => {
  await expect(page.getByTestId('record-state')).toHaveText(state)
})

/** The page's own axis takes the plain phrasing, exactly as a row's does. */
Then('the record page is {string}', async ({ page }, status: string) => {
  await expect(page.getByTestId('record-lifecycle')).toHaveText(status)
})

Then('the record page shows the identity {string}', async ({ page }, identity: string) => {
  await expect(page.getByTestId('record-retro-link')).toHaveText(identity)
})

Then('the record page reads the problem {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('prose-problem')).toHaveText(text)
})

/**
 * Which sections the page renders, as the **set** and in order — because a
 * record carries one of two shapes and the claim is that the page renders the
 * one it was filed in and not the other. "The solutions section is there" would
 * pass on a page that also rendered an empty direction beside it.
 */
Then('the record page shows the sections:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map(([section]) => `section-${String(section)}`)
  // `[a-z_]+$` and not a bare prefix: a legacy record's footprint section holds a
  // `section-footprint-text` of its own, and a prefix match would count the
  // drawing inside a section as a section.
  const shown = await page
    .getByTestId(/^section-[a-z_]+$/)
    .evaluateAll((sections) =>
      sections.map((section) => section.getAttribute('data-testid') ?? 'untagged'),
    )
  expect(shown).toEqual(wanted)
})

/**
 * Reading, not deciding. The tick on a solution says which one the verdict
 * carries; there is nothing to press here, because a record is decided inside
 * its review against a revision the reviewer chose.
 */
Then('the record page offers no way to select a solution', async ({ page }) => {
  await expect(page.getByTestId(/^solution-\d+-select$/)).toHaveCount(0)
})

/** "let's leave out the comments for now" — no threads, and no way to start one. */
Then('the record page offers no way to comment', async ({ page }) => {
  await expect(page.getByTestId('open-thread')).toHaveCount(0)
  await expect(page.getByTestId('review-comments')).toHaveCount(0)
})

Then('the record page offers no verdict controls', async ({ page }) => {
  await expect(page.getByTestId('section-defaults')).toHaveCount(0)
  for (const verdict of ['approved', 'declined', 'revise']) {
    await expect(page.getByTestId(verdict)).toHaveCount(0)
  }
})

Then('the record page was resolved by {string}', async ({ page }, actor: string) => {
  await expect(page.getByTestId('record-evidence-actor')).toHaveText(actor)
})

Then('the record page cites:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map(([reference]) => String(reference))
  await expect(page.getByTestId('record-evidence').getByTestId('record-ref')).toHaveText(wanted)
})

Then('the record page cites nothing', async ({ page }) => {
  await expect(page.getByTestId('record-evidence')).toHaveCount(0)
})

/**
 * Which acts the page offers, whole — the set, because the claim is that it
 * offers what the domain's transition table permits and nothing else. The
 * buttons are collected inside the actions block so the timeline's own links,
 * and the resolve composer's, are not counted as acts.
 */
Then('the record page offers only {string}', async ({ page }, only: string) => {
  await expect(page.getByTestId('record-actions').getByRole('button')).toHaveText([only])
})

When('the reviewer opens the resolve panel on the record page', async ({ page }) => {
  await page.getByTestId('record-resolve').click()
  await expect(resolvePanel(page)).toBeVisible()
})

When('the reviewer archives the record', async ({ page }) => {
  await page.getByTestId('record-archive').click()
})

When('the reviewer unarchives the record', async ({ page }) => {
  await page.getByTestId('record-unarchive').click()
})

When('the reviewer reopens the record', async ({ page }) => {
  await page.getByTestId('record-reopen').click()
})

/* ── the timeline ─────────────────────────────────────────────────────────── */

/**
 * The whole timeline, in order, each line as the pair it reads: who did it and
 * what they did.
 *
 * The list rather than a line at a time, because order is the claim — a timeline
 * at the bottom shows how the record evolved — and a set of assertions that each
 * event is *somewhere* would pass on a page that grouped them by kind. The actor
 * rides along because two of the three kinds take theirs from a domain rule
 * rather than a column, and a line that named the wrong one would otherwise read
 * plausibly.
 */
Then("the record's timeline reads:", async ({ page }, table: DataTable) => {
  const wanted = table.hashes().map((entry) => [String(entry.actor), String(entry.what)])
  await expect(timelineEntries(page)).toHaveCount(wanted.length)
  const shown = await timelineEntries(page).evaluateAll((entries) =>
    entries.map((entry) => [
      entry.querySelector('[data-testid="record-timeline-actor"]')?.textContent ?? 'nobody',
      entry.querySelector('[data-testid="record-timeline-what"]')?.textContent ?? 'nothing',
    ]),
  )
  expect(shown).toEqual(wanted)
})

/**
 * Chronological, read off the machine-readable half of each `<time>` rather than
 * off the text — the text is formatted in the reader's own locale and zone, and
 * a scenario asserting it would be a scenario about the machine it ran on
 * (`lib/when.ts`).
 *
 * Strictly later, not merely sorted: the world stamps each write a minute after
 * the one before it, so two events sharing an instant would mean the page had
 * collapsed two acts into one line.
 */
Then('each timeline entry is later than the one before it', async ({ page }) => {
  const moments = await page
    .getByTestId('record-timeline-when')
    .evaluateAll((times) => times.map((time) => time.getAttribute('datetime') ?? ''))

  expect(moments.length, 'the timeline has nothing on it').toBeGreaterThan(1)
  for (const [index, moment] of moments.entries()) {
    if (index === 0) continue
    const before = moments[index - 1] ?? ''
    expect(
      Date.parse(moment),
      `entry ${index + 1} (${moment}) is not later than entry ${index} (${before})`,
    ).toBeGreaterThan(Date.parse(before))
  }
})

Then('the timeline cites:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map(([reference]) => String(reference))
  await expect(page.getByTestId('record-timeline-refs').getByTestId('record-ref')).toHaveText(
    wanted,
  )
})

Then('the timeline notes {string}', async ({ page }, note: string) => {
  await expect(page.getByTestId('record-timeline-note')).toHaveText(note)
})

Then('the timeline reference {string} links to it', async ({ page }, reference: string) => {
  const mark = timelineReference(page, reference)
  await expect(mark).toHaveJSProperty('tagName', 'A')
  await expect(mark).toHaveAttribute('href', reference)
})

Then('the timeline reference {string} is not a link', async ({ page }, reference: string) => {
  const mark = timelineReference(page, reference)
  await expect(mark).toBeVisible()
  await expect(mark).not.toHaveJSProperty('tagName', 'A')
})

function timelineReference(page: Page, reference: string): Locator {
  return page
    .getByTestId('record-timeline-refs')
    .getByTestId('record-ref')
    .filter({ hasText: reference })
}

/* ── relations, from the record's own page ────────────────────────────────── */

/**
 * One relation, addressed the way this page identifies one: **which way it
 * points and which other record it names**.
 *
 * Both halves are needed, and the fixture is what makes that plain — the same
 * two records can hold a relation each way round, and a locator that took the
 * number alone could not say which of the two it meant. It is the idiom a row of
 * the flat page already uses, where a record is `(retroId, rid)` and never a rid.
 */
function relation(page: Page, direction: string, other: number): Locator {
  return page.getByTestId(`record-relation-${direction}-${other}`)
}

function relatePanel(page: Page): Locator {
  return page.getByTestId('record-relate-panel')
}

/**
 * The whole block, read as a table — every line, in the order the page draws
 * them, with all four things a line says.
 *
 * Read in one `evaluateAll` rather than as four assertions per row, exactly as
 * the timeline's own step reads: what is being asserted is that *these* lines
 * are on the page and no others, and a per-field loop would pass a page that had
 * grown a fifth line nobody asked for.
 */
Then("the record page's relations read:", async ({ page }, table: DataTable) => {
  const wanted = table
    .hashes()
    .map((entry) => [
      String(entry.direction),
      `#${entry.record}`,
      `${entry.how} →`,
      String(entry.title),
      String(entry.who),
    ])

  const rows = page.getByTestId(/^record-relation-(outgoing|incoming)-\d+$/)
  await expect(rows).toHaveCount(wanted.length)

  const shown = await rows.evaluateAll((entries) =>
    entries.map((entry) => {
      const testId = entry.getAttribute('data-testid') ?? ''
      const link = entry.querySelector('[data-testid="record-relation-link"]')
      return [
        testId.split('-')[2] ?? 'nowhere',
        link?.querySelector('span')?.textContent ?? 'no number',
        entry.querySelector('[data-testid="record-relation-how"]')?.textContent ?? 'nothing',
        (link?.textContent ?? '').replace(/^#\d+\s*/, ''),
        entry.querySelector('[data-testid="record-relation-actor"]')?.textContent ?? 'nobody',
      ]
    }),
  )
  expect(shown).toEqual(wanted)
})

/**
 * The block with no lines on it — asserted by the list's absence, because there
 * is no empty-state branch to assert instead: a relations list is `[]` until
 * somebody writes one, and a message saying so would be a rendered branch the
 * page can reach and no scenario would ever check
 * (`r-untested-rendered-branch`).
 */
Then('the record page relates to nothing', async ({ page }) => {
  await expect(page.getByTestId('record-relations')).toBeVisible()
  await expect(page.getByTestId('record-relation-list')).toHaveCount(0)
})

When(
  'the reviewer follows the {word} relation to record {int}',
  async ({ page }, direction: string, other: number) => {
    await relation(page, direction, other).getByTestId('record-relation-link').click()
    await expect(page.getByTestId('record-title')).toBeVisible()
  },
)

When(
  'the reviewer un-relates the {word} relation to record {int}',
  async ({ page }, direction: string, other: number) => {
    await relation(page, direction, other).getByTestId('record-relation-unrelate').click()
  },
)

When('the reviewer opens the relate panel', async ({ page }) => {
  await page.getByTestId('record-relate').click()
  await expect(relatePanel(page)).toBeVisible()
})

/** The number, which is what a relation names — never a rid. */
When('the reviewer names record {int}', async ({ page }, other: number) => {
  await relatePanel(page).getByTestId('record-relate-id').fill(String(other))
})

When('the reviewer says they relate by {string}', async ({ page }, how: string) => {
  await relatePanel(page).getByTestId('record-relate-how').fill(how)
})

When('the reviewer relates them', async ({ page }) => {
  await relatePanel(page).getByTestId('record-relate-save').click()
})

Then('the relation cannot be sent', async ({ page }) => {
  await expect(relatePanel(page).getByTestId('record-relate-save')).toBeDisabled()
})

Then('the relation can be sent', async ({ page }) => {
  await expect(relatePanel(page).getByTestId('record-relate-save')).toBeEnabled()
})

/**
 * The refusal, as the server wrote it. The page shows the sentence that came
 * back rather than one of its own, so this asserts a substring of the domain's
 * message and the panel staying open — a refused write that closed the composer
 * would have thrown away what the reader was about to fix.
 */
Then('relating is refused with {string}', async ({ page }, fragment: string) => {
  await expect(relatePanel(page).getByTestId('record-relate-refusal')).toContainText(fragment)
})
