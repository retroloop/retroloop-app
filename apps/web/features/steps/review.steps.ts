import { expect, type Locator, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import type { MockControl } from '../../test/trpc-mock'
import { Given, Then, When } from '../fixtures'

/**
 * Every step selects by `data-testid` and nothing else (testing.md
 * §Determinism), and every *reviewer* step goes through the page: the click
 * reaches the real component, the component calls the real tRPC client, and the
 * client reaches the typed mock. Only the AI's moves are driven from outside,
 * because the AI is a different process in the real system too.
 */

type MockWindow = Window & { readonly retroMock: MockControl }

function card(page: Page, rid: string): Locator {
  return page.getByTestId(`record-${rid}`)
}

/**
 * The comments panel — since session 7 the one place on the page a comment is
 * read or written, whichever mount it is in (`review-thread.tsx`). The testid is
 * the same in the rail and in the sheet, and only one of them is ever in the
 * document, so this addresses whichever the viewport called for.
 */
function panel(page: Page): Locator {
  return page.getByTestId('review-thread')
}

/**
 * One thread in the panel, addressed by the record and section it hangs on —
 * which is what its anchor line's testid carries, so this is testid selection
 * and not a text match on a title that could change.
 */
function threadOn(page: Page, rid: string, section: string): Locator {
  return panel(page)
    .getByTestId('thread')
    .filter({ has: page.getByTestId(`thread-anchor-${rid}-${section}`) })
}

/** The panel's one standing composer: the review's, or a record's when aimed. */
function composer(page: Page): Locator {
  return panel(page).getByTestId('open-thread-submit-text')
}

/** The verdict row's buttons, in the order the card offers them. */
function verdicts(page: Page, rid: string): Locator {
  return card(page, rid).getByTestId('verdicts').getByRole('button')
}

/** One rendered prose block of a record — the section's own, not its comments'. */
function prose(page: Page, rid: string, section: string): Locator {
  return card(page, rid).getByTestId(`prose-${section}`)
}

/** The solutions tab strip of a record, and one tab of it, 1-based. */
function solutionStrip(page: Page, rid: string): Locator {
  return card(page, rid).getByTestId('solution-tab-strip')
}

function solutionTabs(page: Page, rid: string): Locator {
  return solutionStrip(page, rid).getByTestId(/^solution-tab-\d+$/)
}

function solutionTab(page: Page, rid: string, position: number): Locator {
  return solutionStrip(page, rid).getByTestId(`solution-tab-${position}`)
}

/**
 * The two markers by the character the owner named them with, so a scenario can
 * say `the "✓" on solution tab 3` and mean the element rather than a substring
 * of the tab's text.
 */
const MARKERS: Readonly<Record<string, string>> = { '*': 'recommended', '✓': 'selected' }

function rows(table: DataTable): string[] {
  return table.raw().map(([cell]) => (cell ?? '').trim())
}

function railEntry(page: Page, rid: string): Locator {
  return page.getByTestId(`rail-entry-${rid}`)
}

/**
 * The threads about the review itself: the ones in the panel with no anchor
 * line, because they hang on no record.
 */
function reviewThreads(page: Page): Locator {
  return panel(page)
    .getByTestId('thread')
    .filter({ hasNot: page.getByTestId(/^thread-anchor-/) })
}

/**
 * The newest of them — which is the one a scenario means by "the review thread":
 * the one it just opened, or the fixture's when it opened none. It is also where
 * the AI's own reply lands (`MockControl.aiReviewReply`), for the same reason.
 */
function reviewThread(page: Page): Locator {
  return reviewThreads(page).last()
}

function listed(raw: string): string[] {
  return raw.split(',').map((item) => item.trim())
}

/* ── opening a page ───────────────────────────────────────────────────────── */

Given('the reviewer opens {string}', async ({ page }, path: string) => {
  await page.goto(path)
})

Given('the reviewer opens retro {int}', async ({ page }, retroId: number) => {
  await page.goto(`/retros/${retroId}`)
  await expect(page.getByTestId('review-actions')).toBeVisible()
})

Given(
  'the reviewer opens retro {int} pinned to revision {int}',
  async ({ page }, retroId: number, revision: number) => {
    await page.goto(`/retros/${retroId}?rev=${revision}`)
    await expect(page.getByTestId('review-actions')).toBeVisible()
  },
)

/**
 * The review page on the stage the records page is about — three retrospectives
 * rather than the one this feature's Background opens on (`crossRetro` in
 * `test/trpc-mock.ts`).
 *
 * It sets the flag and navigates again, which is how a world is arranged rather
 * than performed: `addInitScript` applies to the *next* navigation, and this file's
 * Background has already made one. Nothing has been done to the world by then —
 * the Background only opened a page — so there is nothing for the second visit to
 * throw away, which is the thing the mock's header warns about.
 *
 * A scenario reaches for it when it needs the retro under review to be numbered
 * against a store that holds more than it: the global record sequence runs across
 * retrospectives, so a record filed here *after* two others exist is the only one
 * in this fixture whose number and whose per-retro `num` differ.
 */
Given(
  'the reviewer opens retro {int} on a stage of three retrospectives',
  async ({ page }, retroId: number) => {
    await page.addInitScript(() => {
      window.retroMockCrossRetro = true
    })
    await page.goto(`/retros/${retroId}`)
    await expect(page.getByTestId('review-actions')).toBeVisible()
  },
)

When('the page is reloaded', async ({ page }) => {
  await page.reload()
})

/**
 * Leave the review and come back — the mock's own answer to "and then he
 * refreshed" (`r-finish-button-reenables`).
 *
 * The owner pressed F5. A scenario cannot: a real reload re-executes the module
 * and the mock's world starts over, so the finish it is asking about would be
 * unmade by the very act of checking for it (`r-mock-world-semantics`, and the
 * mock module's own header). What the reload actually did to the page is
 * destroy the component and its in-memory state and make it work out the answer
 * again, and a client-side round trip does exactly that while the world stands:
 * the bar unmounts, `useMutation` goes with it, and what comes back has only
 * what the store will tell it.
 *
 * That is the whole mechanism the record is about — *"it behaves like in-memory
 * state that a fresh page cannot recover"* — so this is the assertion's real
 * subject rather than a weaker stand-in for it. `goBack` is a `popstate` the
 * router handles, not a navigation, which is what keeps the world.
 */
When('the reviewer leaves the review and comes back', async ({ page }) => {
  await page.getByTestId('breadcrumb').getByRole('link', { name: 'Retro' }).click()
  // The dashboard's landmark since the session-12 recomposition: `retro-list` was
  // the flat list of retrospectives that led the page before the corpus block, and
  // both are gone. The stat row is what says the dashboard has finished loading.
  await expect(page.getByTestId('dashboard-stats')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('review-actions')).toBeVisible()
})

/**
 * The narrow half of the two screens this product is read on (ux-brief:
 * laptop and iPad). It is where the long labels have to wrap, so it is the only
 * width at which "the explanation is never dropped" can be observed at all — on
 * a 1280px laptop even the longest severity row fits on one line.
 */
When('the reviewer is on an iPad in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 })
})

/** The OS setting, as the page reads it: `prefers-reduced-motion: reduce`. */
Given('the reviewer has asked for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

/**
 * A retrospective nobody has commented on — **the state every one of them is in
 * until the first comment is written**, and the only state the comments panel
 * has nothing to show in now that it shows every thread rather than the
 * review's own.
 *
 * Arranged rather than performed, because it cannot be performed: threads are
 * append-only (D4), so nothing a reviewer can do empties them. This runs before
 * the app boots and the mock's
 * own fixture reads it once (`bareReview` in `test/trpc-mock.ts`); it is starting
 * state, not a step reaching past the tRPC client. Every scenario that does not
 * set it gets the full fixture.
 */
Given('the review has no comments at all', async ({ page }) => {
  await page.addInitScript(() => {
    window.retroMockBareReview = true
  })
})

/**
 * A store carrying the frozen `hold` verdict — the fourth `DecisionState`,
 * unwritable since retro 3 `r-hold-semantics`.
 *
 * Arranged rather than performed, for the reason it has to be: no write path in
 * the product can produce one. The mock's own fixture reads the flag once and
 * starts its decision table with a real row of the real shape
 * (`legacyHoldVerdict` in `test/trpc-mock.ts`); everything downstream — the
 * effective state, the counts, whether the chip is rendered — is computed from
 * it the way the server computes it.
 */
Given('the review carries a decision recorded as {string}', async ({ page }, state: string) => {
  expect(state, 'the only unwritable verdict a store can carry is `hold`').toBe('hold')
  await page.addInitScript(() => {
    window.retroMockLegacyHoldVerdict = true
  })
})

/* ── what the reviewer does ───────────────────────────────────────────────── */

When('the reviewer approves record {string}', async ({ page }, rid: string) => {
  await card(page, rid).getByTestId('approved').click()
})

When('the reviewer declines record {string}', async ({ page }, rid: string) => {
  await card(page, rid).getByTestId('declined').click()
})

When('the reviewer asks for a revision of record {string}', async ({ page }, rid: string) => {
  await card(page, rid).getByTestId('revise').click()
})

/**
 * The undo (retro 4 `r-verdict-revise`): *"if I click it again it should undo
 * it."* The step presses whatever is selected rather than a verdict it was
 * told, because that is the act — the reviewer aims at the button that is lit.
 */
When(
  'the reviewer presses the chosen verdict of record {string} again',
  async ({ page }, rid: string) => {
    await verdicts(page, rid).and(page.locator('[aria-pressed="true"]')).click()
  },
)

When(
  'the reviewer sets the {string} of record {string} to {string}',
  async ({ page }, field: string, rid: string, value: string) => {
    await card(page, rid).getByTestId(field).click()
    // Radix renders the open list in a portal at the document root, and only one
    // list is ever open, so this is unambiguous without leaving testid selection.
    await page.getByTestId(`${field}-${value}`).click()
  },
)

// Solution level is a radio list, not a dropdown (data-model.md), so there is
// nothing to open first — its own step, because it is its own control.
When(
  'the reviewer chooses solution level {string} on record {string}',
  async ({ page }, value: string, rid: string) => {
    await card(page, rid).getByTestId(`solution-level-${value}`).click()
  },
)

/**
 * Reading a solution. It is deliberately a different step from selecting one,
 * because they are different acts: opening a tab is how the reviewer finds out
 * what a solution says, and nothing about the record changes when he does.
 */
When(
  'the reviewer opens solution tab {int} of record {string}',
  async ({ page }, position: number, rid: string) => {
    await solutionTab(page, rid, position).click()
  },
)

/**
 * Choosing one. The tab is opened first because the control lives in the tab's
 * body and only the open body is in the document — which is the reviewer's own
 * path to it, not a convenience: he cannot choose a solution he is not looking
 * at.
 */
When(
  'the reviewer selects solution {int} of record {string}',
  async ({ page }, position: number, rid: string) => {
    await solutionTab(page, rid, position).click()
    await card(page, rid).getByTestId(`solution-${position}-select`).click()
  },
)

/**
 * The keyboard arriving at the strip, which is one press of Tab in a real
 * session — here, focus put on the strip itself, because that is the element
 * the tab order stops at. Where it goes from there is the claim, and it is not
 * this step's to assert: a strip that dropped focus on its first tab instead of
 * its open one would satisfy this and fail the next line.
 */
When(
  'the reviewer puts the keyboard on the solution strip of record {string}',
  async ({ page }, rid: string) => {
    await solutionStrip(page, rid).focus()
  },
)

When('the reviewer presses {string}', async ({ page }, key: string) => {
  await page.keyboard.press(key)
})

When(
  'the reviewer writes the note {string} on record {string}',
  async ({ page }, text: string, rid: string) => {
    await card(page, rid).getByTestId('reviewer-note').fill(text)
  },
)

/**
 * A comment on one section of one record, written the way the reviewer writes
 * one now: press Comment on the section, and the panel's own composer is what
 * takes the words. Two surfaces in one act, which is the change — the click is
 * on the card and the typing is in the panel, and the anchor chip in between is
 * what says the two are talking about the same thing.
 */
When(
  'the reviewer comments {string} on the {string} of record {string}',
  async ({ page }, text: string, section: string, rid: string) => {
    await sectionGlyph(page, rid, section).click()
    await expect(panel(page).getByTestId('composer-anchor')).toBeVisible()
    await composer(page).fill(text)
    await panel(page).getByTestId('open-thread-submit').click()
  },
)

/**
 * The glyph that starts a thread on one section of one record — every section,
 * including the one that is not a `section-` block.
 *
 * `title` is a first-class comment section in the model, in the CLI and in
 * `SECTION_TITLES`, but on the card it is the record's `<h2>` rather than a
 * `<section>` (`r-title-comments-unreachable`). So the branch is here, once,
 * rather than in each step that reaches for a glyph — and every step that says
 * "the X of record Y" now works for `title` without knowing that.
 */
function sectionGlyph(page: Page, rid: string, section: string): Locator {
  return section === 'title'
    ? card(page, rid).getByTestId('record-header').getByTestId('open-thread')
    : card(page, rid).getByTestId(`section-${section}`).getByTestId('open-thread')
}

/**
 * **Where a comment glyph sits, measured** — the shared half of
 * `r-comment-button-below-section` and `r-title-comments-unreachable`, which the
 * owner asked for as one pattern and pinned with a reviewer note: *"make sure
 * that the comment is incline with the title … it should be right next to the
 * last word of the title. it shouldn't be separate on the right etc."*
 *
 * A controlled assertion, and it has to be three claims rather than one
 * (`r-uncontrolled-assertions`, `r-theme-blind-assertions`' per-channel half):
 *
 *   - **after the name's last word** — the glyph starts at or past the name's
 *     right edge. A glyph rendered before the name passes nothing here;
 *   - **and next to it** — within `NEXT_TO`, which is what rules out the shape
 *     he named. A floated-right glyph satisfies "after" perfectly and lands a
 *     column away, so the gap is the assertion that carries his note;
 *   - **on the name's own line** — centres within one line of each other, so a
 *     glyph that dropped onto the row below is not "beside the heading".
 *
 * Each is checked on its own with its own message, because a single combined
 * expression that fails cannot say which of the three broke.
 */
const NEXT_TO = 14

async function glyphSitsAfter(name: Locator, glyph: Locator, what: string): Promise<void> {
  await expect(name).toBeVisible()
  await expect(glyph).toBeVisible()
  const nameBox = await name.boundingBox()
  const glyphBox = await glyph.boundingBox()
  if (nameBox === null || glyphBox === null) throw new Error(`${what}: nothing to measure`)

  const gap = glyphBox.x - (nameBox.x + nameBox.width)
  expect(gap, `${what}: the glyph starts before the last word ends`).toBeGreaterThan(-2)
  expect(
    gap,
    `${what}: the glyph is ${Math.round(gap)}px past the last word — that is a column away, not inline (his note: "it shouldn't be separate on the right")`,
  ).toBeLessThan(NEXT_TO)

  const nameMid = nameBox.y + nameBox.height / 2
  const glyphMid = glyphBox.y + glyphBox.height / 2
  expect(
    Math.abs(glyphMid - nameMid),
    `${what}: the glyph is off the line the name is on`,
  ).toBeLessThan(nameBox.height)
}

Then(
  'the comment glyph of the {string} of record {string} sits inline after the heading',
  async ({ page }, section: string, rid: string) => {
    const block = card(page, rid).getByTestId(`section-${section}`)
    await glyphSitsAfter(
      block.getByTestId('heading-label'),
      block.getByTestId('open-thread'),
      `the ${section} heading`,
    )
  },
)

/**
 * The other half of `r-comment-button-below-section`: it left the bottom. Read as
 * the glyph clearing the top of the section's body, because "beside the heading"
 * and "not after the body" are two different ways for this to be wrong and the
 * geometry above only rules out the first.
 */
Then(
  'the comment glyph of the {string} of record {string} is above the section body',
  async ({ page }, section: string, rid: string) => {
    const block = card(page, rid).getByTestId(`section-${section}`)
    const glyphBox = await block.getByTestId('open-thread').boundingBox()
    const bodyTop = await block.evaluate((element) => {
      const body = element.lastElementChild
      return body === null ? null : body.getBoundingClientRect().top
    })
    if (glyphBox === null || bodyTop === null) throw new Error(`the ${section} body: nothing there`)
    expect(
      glyphBox.y + glyphBox.height,
      `the ${section} glyph runs past the top of the body it belongs to`,
    ).toBeLessThanOrEqual(bodyTop + 1)
  },
)

Then(
  "the comment glyph on the title of record {string} sits after the title's last word",
  async ({ page }, rid: string) => {
    await glyphSitsAfter(
      card(page, rid).getByTestId('record-title'),
      sectionGlyph(page, rid, 'title'),
      'the record title',
    )
  },
)

/**
 * The glyph carries a word for the readers a glyph is nothing to — the same rule
 * the solution tab markers are held to. Read off the accessible name rather than
 * the visible text, which is the whole point: there is no visible text.
 */
Then(
  'every comment glyph on record {string} says what it is for',
  async ({ page }, rid: string) => {
    const glyphs = card(page, rid).getByTestId('open-thread')
    const count = await glyphs.count()
    expect(count, 'no glyphs to check').toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const name = await glyphs.nth(index).evaluate((element) => element.textContent ?? '')
      expect(name.trim(), 'a comment glyph with no name').toMatch(/^Comment on \S/)
    }
  },
)

When(
  'the reviewer replies {string} in the {string} thread of record {string}',
  async ({ page }, text: string, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await thread.getByTestId('thread-reply').click()
    await thread.getByTestId('thread-reply-submit-text').fill(text)
    await thread.getByTestId('thread-reply-submit').click()
  },
)

/**
 * The replies, which a thread keeps behind their count until they are asked for
 * — the owner: *"it should only show top level comments, with reply count, one
 * can click to view the reply."* Asserted open rather than assumed, so a step
 * that silently found nothing to click cannot pass for the reviewer having read
 * a reply.
 */
When(
  'the reviewer opens the replies in the {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await thread.getByTestId('thread-replies').click()
    await expect(thread.getByTestId('thread-reply-list')).toBeVisible()
  },
)

When(
  'the reviewer closes the replies in the {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await thread.getByTestId('thread-replies').click()
    await expect(thread.getByTestId('thread-reply-list')).toHaveCount(0)
  },
)

When('the reviewer opens the replies in the review thread', async ({ page }) => {
  await reviewThread(page).getByTestId('thread-replies').click()
  await expect(reviewThread(page).getByTestId('thread-reply-list')).toBeVisible()
})

/* ── settling a thread (r-resolvable-comments) ────────────────────────────── */

When(
  'the reviewer resolves the {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    await threadOn(page, rid, section).getByTestId('thread-resolve').click()
  },
)

When('the reviewer resolves the review thread', async ({ page }) => {
  await reviewThread(page).getByTestId('thread-resolve').click()
})

When(
  'the reviewer opens the settled {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    await threadOn(page, rid, section).getByTestId('thread-settled').click()
  },
)

When(
  'the reviewer reopens the {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    await threadOn(page, rid, section).getByTestId('thread-reopen').click()
  },
)

/* ── aiming the composer (the anchor chip) ────────────────────────────────── */

When(
  'the reviewer starts a comment on the {string} of record {string}',
  async ({ page }, section: string, rid: string) => {
    await sectionGlyph(page, rid, section).click()
  },
)

When('the reviewer takes the aim off the composer', async ({ page }) => {
  await panel(page).getByTestId('composer-anchor-clear').click()
})

When(
  'the reviewer jumps to the record from the {string} thread of record {string}',
  async ({ page }, section: string, rid: string) => {
    await threadOn(page, rid, section).getByTestId(`thread-anchor-${rid}-${section}`).click()
  },
)

/* ── the review's own threads (r-retro-level-comments) ────────────────────── */

/**
 * The same composer the record sections carry, in the one place on the page that
 * is not a record — so the testids are the same and only the container differs.
 * That is the point of it: a comment about the review is written the same way a
 * comment about a record is, it just does not have to be smuggled under one.
 *
 * There is no button to open it first any more (`r-review-actions-pinned`): the
 * review's composer stands open wherever it is mounted, which is what makes it
 * typeable from where the reviewer is standing.
 */
When('the reviewer comments {string} on the review', async ({ page }, text: string) => {
  // Aimed at nothing, which is the default: a comment about the round as a
  // whole is what the panel's composer takes when no section was pointed at.
  await expect(panel(page).getByTestId('composer-anchor')).toHaveCount(0)
  await composer(page).fill(text)
  await panel(page).getByTestId('open-thread-submit').click()
})

/**
 * Post into the composer wherever it already stands, without pointing at a
 * section first.
 *
 * The step above it aims and posts in one act, which is right for a scenario
 * about the comment landing. This is for a scenario about the *aim* — it has
 * already pressed a glyph and asserted where the composer is pointed, and
 * pressing the glyph a second time to post would be a second act it is not
 * making a claim about. On the narrow layout it is also impossible: the first
 * press opened the sheet, and the card behind it is under a backdrop.
 */
When('the reviewer writes {string} in the panel composer', async ({ page }, text: string) => {
  await composer(page).fill(text)
  await panel(page).getByTestId('open-thread-submit').click()
})

/* ── reaching the review's comments (r-review-actions-pinned) ─────────────── */

When('the reviewer opens the review comments', async ({ page }) => {
  await page.getByTestId('review-comments').click()
  await expect(page.getByTestId('review-comments-sheet')).toBeVisible()
})

When('the reviewer presses the Escape key', async ({ page }) => {
  await page.keyboard.press('Escape')
})

/**
 * The backdrop, aimed at its top-left corner — as far from the sheet as the
 * viewport goes, so this cannot pass by landing on the sheet's own edge.
 */
When('the reviewer clicks outside the review comments', async ({ page }) => {
  await page.getByTestId('review-comments-backdrop').click({ position: { x: 8, y: 8 } })
})

/**
 * Puts the reviewer down mid-list, at a *known* offset rather than wherever
 * `scrollIntoView` felt like leaving them: everything below asks whether they
 * are still at that offset, and a claim about keeping your place needs a place
 * precise enough to be lost.
 *
 * The offset is where the reading area starts: under the app header and under
 * the decision bar stuck to it, which is what `scroll-mt-28` on a record's slot
 * spells the same way (`record-filter.tsx`).
 */
const READING_TOP = 112

async function place(page: Page, rid: string): Promise<string> {
  return card(page, rid).evaluate((element, top) => {
    const actual = Math.round(element.getBoundingClientRect().top)
    return Math.abs(actual - top) <= 2
      ? 'where they were'
      : `${actual}px from the top of the viewport`
  }, READING_TOP)
}

When('the reviewer scrolls to record {string}', async ({ page }, rid: string) => {
  await card(page, rid).evaluate((element, top) => {
    window.scrollBy({ top: element.getBoundingClientRect().top - top, behavior: 'instant' })
  }, READING_TOP)
  await expect.poll(() => place(page, rid)).toBe('where they were')
  // And they really are down the page. At scroll position zero there is no
  // place to lose, so every assertion below would hold whatever the page did.
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled, 'the page never scrolled, so there is no place to keep').toBeGreaterThan(200)
})

/**
 * The record itself, in pixels — which is the whole complaint: *"I have to
 * scroll up all the way to add a comment and then find where I was and then go
 * there again."*
 *
 * A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`), and it has to be: taking a comment surface out
 * of the reading column is exactly the kind of change a browser will half-do for
 * free. Hand-run with the comments mounted back above the records — the panel he
 * was shown — and the failure output is in the lane report.
 */
Then('the reviewer is still on record {string}', async ({ page }, rid: string) => {
  const where = await place(page, rid)
  expect(where, `the reviewer was moved off record ${rid}`).toBe('where they were')
})

/**
 * A rotation, rather than a resize before the page opens: the sheet is already
 * on screen when this runs, which is the whole point of the scenario using it.
 */
When('the reviewer turns the iPad to {int} by {int}', async ({ page }, width, height) => {
  await page.setViewportSize({ width, height })
})

/**
 * The prose measure, at the viewport where it can go wrong.
 *
 * The claim is not a number: the column is 704px where three columns first fit
 * (1472, both rails mounted) and 768px once the page has stopped widening at
 * 1536, so what is asserted is that it stays inside the band its layouts define,
 * whichever one the review is in. Above the band is the comment rail's room
 * being spent on line length nobody asked for — the state a UI review measured
 * at **992px**, on every retrospective filed before review-level comments.
 * Below it is the reading column paying for the rails instead of the page doing
 * it, which is the 576px a 1344px page would hand it now that the rails are 288
 * and 368, and the reason the breakpoint moves with the geometry every time.
 *
 * **The band itself has not moved since session 9, and that is the point of
 * `r-wider-page-for-panels`**: the measure grew by exactly what the two rails
 * took, so the prose neither gained nor paid — *"all of it should go to the left
 * index panel and the right comments panel"*. What moved is the width at which
 * the column enters the band.
 *
 * The card is the column: `RecordSlot` is a full-width grid cell inside it.
 *
 * A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`), hand-run with the width fix deleted; the failure
 * output is in the lane report.
 */
const READING_COLUMN = { narrowest: 704, widest: 768 }

/**
 * The right-hand end of the three-column row lands exactly where the page's
 * content does — *"the last column ends where the header's last control does"*
 * (`app-shell.tsx`), which is the rule that makes the measure a sum rather than a
 * taste value: 24 + 288 + 32 + 768 + 32 + 368 + 24.
 *
 * It exists because nothing else could see the comments rail's width. The index
 * rail is pinned by where the reading column starts, and the reading column by
 * its own band — but the comments rail could have been left at any width and
 * every other assertion would have passed, with the slack simply going unclaimed
 * off the right of the page. `r-wider-page-for-panels` moved that rail 288 -> 368
 * and this is the assertion that number answers to.
 *
 * Measured against the page's content box rather than its border box, because the
 * padding is the gutter the arithmetic names and a check against the outer edge
 * would be off by exactly it, in agreement with itself.
 */
Then('the three columns close flush at the cap', async ({ page }) => {
  const measure = page.getByTestId('page-measure')
  const page_ = await measure.boundingBox()
  const padding = await measure.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingRight),
  )
  const rail = await page.getByTestId('review-comment-rail').boundingBox()
  expect(page_, 'no page to measure').not.toBeNull()
  expect(rail, 'the comments rail is not mounted, so nothing closes the row').not.toBeNull()
  if (page_ === null || rail === null) return

  expect(
    Math.round(rail.x + rail.width),
    'the comments rail does not end where the page does — the row leaves width no column claims',
  ).toBe(Math.round(page_.x + page_.width - padding))
})

Then('the reading column keeps its measure', async ({ page }) => {
  const box = await card(page, 'r-stale-lock').boundingBox()
  expect(box, 'there is no first record to measure').not.toBeNull()
  if (box === null) return
  const width = Math.round(box.width)
  expect(
    width,
    `the reading column is ${width}px — outside the ${READING_COLUMN.narrowest}…${READING_COLUMN.widest}px the page's two layouts give it`,
  ).toBeGreaterThanOrEqual(READING_COLUMN.narrowest)
  expect(
    width,
    `the reading column is ${width}px — outside the ${READING_COLUMN.narrowest}…${READING_COLUMN.widest}px the page's two layouts give it`,
  ).toBeLessThanOrEqual(READING_COLUMN.widest)
})

/**
 * Where the reading column *starts*, which is the half of the width question a
 * band cannot answer. The page's measure was a function of whether the comment
 * rail had mounted until session 7, so the column moved sideways when a query
 * came back with a thread on it; one measure everywhere means the same number
 * here whether the rail is beside the column or not, and the two scenarios that
 * use this step are those two states with the same expected value.
 *
 * The card is the column: `RecordSlot` is a full-width grid cell inside it.
 *
 * A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`), hand-run with the page's width coupled back to
 * the rail; the failure output is in the lane report.
 */
Then('the reading column starts {int} pixels from the left', async ({ page }, left: number) => {
  const box = await card(page, 'r-stale-lock').boundingBox()
  expect(box, 'there is no first record to measure').not.toBeNull()
  if (box === null) return
  const actual = Math.round(box.x)
  expect(
    actual,
    `the reading column starts at x=${actual} rather than x=${left}, so it moved with the rail`,
  ).toBe(left)
})

/**
 * The page's one measure, on whichever route the scenario is on — the owner's
 * third ask of session 7: *"The width of the home page is not consistent with
 * the width of the retro page."* Asserted with the same numbers from both
 * features, which is the only way "consistent" can be a thing a suite checks.
 */
Then('the page is {int} pixels wide', async ({ page }, expected: number) => {
  const box = await page.getByTestId('page-measure').boundingBox()
  expect(box, 'the page has no measured body').not.toBeNull()
  if (box === null) return
  const width = Math.round(box.width)
  expect(width, `the page measures ${width}px rather than ${expected}px`).toBe(expected)
})

Then('the comment rail is on screen', async ({ page }) => {
  await expect(page.getByTestId('review-comment-rail')).toBeVisible()
})

/**
 * `toHaveCount(0)` rather than `toBeHidden()`: below `wide` the rail is not
 * rendered at all, and that is load-bearing rather than tidy — a hidden rail
 * beside an open sheet would be a second live composer and a second copy of
 * every thread in the document (`review-thread.tsx`).
 */
Then('the comment rail is not on screen', async ({ page }) => {
  await expect(page.getByTestId('review-comment-rail')).toHaveCount(0)
})

Then('the review comments affordance is offered', async ({ page }) => {
  await expect(page.getByTestId('review-comments')).toBeVisible()
})

Then('the review comments affordance is not offered', async ({ page }) => {
  await expect(page.getByTestId('review-comments')).toHaveCount(0)
})

/**
 * The badge, which is what stops an unanswered review thread being silent on the
 * widths where the threads are behind a glyph. `nothing` is the zero case: no
 * badge rather than a badge reading 0, and the glyph still there because there
 * is still something behind it — the composer on a live review, and every
 * settled thread on any review (`r-badge-counts-settled`).
 */
Then('the review comments affordance counts {string}', async ({ page }, count: string) => {
  const badge = page.getByTestId('review-comments-count')
  if (count === 'nothing') {
    await expect(page.getByTestId('review-comments')).toBeVisible()
    await expect(badge).toHaveCount(0)
    return
  }
  await expect(badge).toHaveText(count)
})

/**
 * The badge said out loud. It is asserted separately from the number because
 * they are two renderings of one fact for two readers, and a badge whose
 * accessible name still says "2 comments" on a review holding five is the label
 * lying about the three that are settled — which no assertion on the digit can
 * see.
 */
Then('the review comments affordance is named {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId('review-comments')).toHaveAttribute('aria-label', name)
})

Then('the review comments are open', async ({ page }) => {
  await expect(page.getByTestId('review-comments-sheet')).toBeVisible()
})

Then('the review comments are closed', async ({ page }) => {
  await expect(page.getByTestId('review-comments-sheet')).toHaveCount(0)
})

/**
 * The composer is there to type into, with nothing to press first — *"a small
 * affordance that travels … opening the review-level composer in place"*. The
 * button that used to swap it in is asserted gone in the same breath, because a
 * composer that is open *and* a button that opens one is the old surface with a
 * new one beside it.
 */
Then('the review offers its composer with nothing to press first', async ({ page }) => {
  await expect(composer(page)).toBeVisible()
  await expect(panel(page).getByTestId('open-thread')).toHaveCount(0)
})

/**
 * The sheet's width, exactly — `min(48rem, 100vw - 4rem)`, so the number depends
 * on the screen the scenario named and every scenario that asks names one. A
 * number rather than a band, because the rule computes one and a band would let
 * it drift halfway back to the proportional width it replaced.
 */
Then('the comments sheet is {int} pixels wide', async ({ page }, expected: number) => {
  const box = await page.getByTestId('review-comments-sheet').boundingBox()
  expect(box, 'the comments sheet is not open').not.toBeNull()
  if (box === null) return
  const width = Math.round(box.width)
  expect(width, `the comments sheet is ${width}px rather than ${expected}px`).toBe(expected)
})

/**
 * The other half of the reveal rule, and the half that is about the page rather
 * than the sheet: *"the flyouts should have a rule that makes them leave X
 * pixels uncovered, rest should all be covered."*
 *
 * Measured as the sheet's own distance from the edge it did *not* come out of —
 * the comments open from the right, so the strip is everything to the left of
 * `box.x`. A subtraction of two widths would say the same number about a sheet
 * floating in the middle of the viewport, which is the one arrangement this can
 * be asked about that would be wrong.
 *
 * A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`): a width that is nearly right leaves a strip that
 * is nearly right, and the point of a fixed reveal is the pixel it is fixed at.
 * Re-proven against main's proportional 85vw; the failure output is in the lane
 * report.
 */
Then(
  'the comments sheet leaves {int} pixels of the page uncovered',
  async ({ page }, expected: number) => {
    const box = await page.getByTestId('review-comments-sheet').boundingBox()
    expect(box, 'the comments sheet is not open').not.toBeNull()
    if (box === null) return
    const strip = Math.round(box.x)
    expect(
      strip,
      `the comments sheet leaves ${strip}px of the page showing rather than ${expected}px`,
    ).toBe(expected)
  },
)

/**
 * `r-sheet-composer-jump`, both halves: the box sits where its steady state has
 * it *before* the first comment exists, so the first post does not move the
 * control the reviewer is using from the top of the sheet to the bottom.
 *
 * Measured off the Post button, which is the composer's bottom edge, against the
 * panel's own bottom. A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`) — a flex column will put a lone child wherever it
 * likes for free — hand-run with the empty thread area deleted; the failure
 * output is in the lane report.
 */
const COMPOSER_FOOT = 8

Then('the composer sits at the bottom of the panel', async ({ page }) => {
  const holder = await panel(page).boundingBox()
  const post = await panel(page).getByTestId('open-thread-submit').boundingBox()
  expect(holder, 'there is no comments panel on this page').not.toBeNull()
  expect(post, 'the panel offers no composer').not.toBeNull()
  if (holder === null || post === null) return

  const gap = Math.round(holder.y + holder.height) - Math.round(post.y + post.height)
  expect(
    gap,
    `the composer's foot is ${gap}px above the panel's, so it is riding the threads rather than anchored`,
  ).toBeLessThanOrEqual(COMPOSER_FOOT)
})

/**
 * Where the comments are, in the page's own coordinates: to the right of the
 * reading column and starting above the first record, which is what "beside"
 * means and what the panel above the records was not.
 *
 * A controlled assertion (`r-uncontrolled-assertions`), hand-run with the
 * comments mounted back above the records; the failure output is in the lane
 * report.
 */
Then('the review comments sit beside the records rather than above them', async ({ page }) => {
  const rail = await page.getByTestId('review-comment-rail').boundingBox()
  const first = await card(page, 'r-stale-lock').boundingBox()
  expect(rail, 'there is no comment rail on this page').not.toBeNull()
  expect(first, 'there is no first record on this page').not.toBeNull()
  if (rail === null || first === null) return

  const column = `${Math.round(first.x)}…${Math.round(first.x + first.width)}`
  expect(
    Math.round(rail.x),
    `the comments start at x=${Math.round(rail.x)}, inside the reading column (${column})`,
  ).toBeGreaterThanOrEqual(Math.round(first.x + first.width))
  expect(
    Math.round(rail.y),
    'the comments start below the first record, so they are in its column rather than beside it',
  ).toBeLessThan(Math.round(first.y))
})

/**
 * The chips are independent toggles, so pressing one is a different act from
 * pressing it again — and each step asserts the chip it just pressed is in the
 * state its name claims, because a filter the reviewer cannot see the state of
 * is a filter they cannot trust (G5, KC-0021).
 */
When('the reviewer filters to {string}', async ({ page }, state: string) => {
  const chip = page.getByTestId(`filter-${state}`)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
})

When('the reviewer clears the {string} filter', async ({ page }, state: string) => {
  const chip = page.getByTestId(`filter-${state}`)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

When(
  'the reviewer jumps to record {string} from the record index',
  async ({ page }, rid: string) => {
    await railEntry(page, rid).click()
  },
)

/**
 * The reviewer's one terminal act, both of its steps
 * (`r-finish-confirm-message`): the press that arms it and the press that
 * answers the confirm. It is one step here because it is one act — every
 * scenario that finishes a review wants the round finished, not the confirm
 * inspected, and the scenarios that *are* about the confirm drive the two halves
 * themselves.
 */
When('the reviewer finishes the review', async ({ page }) => {
  await page.getByTestId('finish-review').click()
  await page.getByTestId('finish-confirm-submit').click()
})

/**
 * The first press on its own, and it is **one primitive with two outcomes**
 * (`r-finish-refusal-fires-late`): on a finishable round it opens the confirm and
 * the round is untouched; on a round with an undecided record it is refused, and
 * the composer never opens.
 *
 * It used to be called "arms the finish", which named an outcome the press no
 * longer always has — a step that says what the reviewer did is the one that
 * still reads correctly when the gate moves under it.
 */
When('the reviewer presses Finish review', async ({ page }) => {
  await page.getByTestId('finish-review').click()
})

/**
 * The human's undo, taken somewhere this page cannot see — the only state the
 * send-time backstop can still be reached from now that the gate refuses on the
 * first press. It writes into the world without publishing, which is the window
 * before another device's event arrives (`test/trpc-mock.ts`).
 */
When('another device undoes the verdict on record {string}', async ({ page }, rid: string) => {
  await page.evaluate((rid) => {
    ;(window as unknown as MockWindow).retroMock.undecideElsewhere(rid)
  }, rid)
})

When('the reviewer writes the final message {string}', async ({ page }, text: string) => {
  await page.getByTestId('finish-message').fill(text)
})

/** Step two: the press that actually asks the server. */
When('the reviewer confirms the finish', async ({ page }) => {
  await page.getByTestId('finish-confirm-submit').click()
})

/**
 * A second press of the one terminal action (retro 4
 * `r-request-changes-multi-press`). Forced, because the button is disabled by
 * then and a disabled button is exactly what this is checking: the click is
 * dispatched at it and the page swallows it, which is why the event count on
 * the other side of the step is the assertion that matters.
 */
When('the reviewer presses finish again', async ({ page }) => {
  await page.getByTestId('finish-review').click({ force: true })
})

/** The AI's own act, in its own process: the close to export. */
When('the AI closes the review', async ({ page }) => {
  await page.evaluate(() => {
    ;(window as unknown as MockWindow).retroMock.closeReview()
  })
})

When('the reviewer loads the announced revision', async ({ page }) => {
  await page.getByTestId('revision-banner-load').click()
})

/* ── what the AI does, in its own process ─────────────────────────────────── */

When('the AI files the next revision', async ({ page }) => {
  await page.evaluate(() => {
    ;(window as unknown as MockWindow).retroMock.fileRevision()
  })
})

When('the AI replies {string} on record {string}', async ({ page }, text: string, rid: string) => {
  await page.evaluate(
    ([target, message]) => {
      ;(window as unknown as MockWindow).retroMock.aiReply(target as string, message as string)
    },
    [rid, text],
  )
})

/**
 * The same act with room to write in. The replay convention is a *quote and then
 * an answer* (`r-reply-replay-convention`), which is several lines by
 * construction, and a Gherkin `{string}` is one.
 */
When('the AI replies on record {string} with:', async ({ page }, rid: string, text: string) => {
  await page.evaluate(
    ([target, message]) => {
      ;(window as unknown as MockWindow).retroMock.aiReply(target as string, message as string)
    },
    [rid, text],
  )
})

When('the AI replies {string} in the review thread', async ({ page }, text: string) => {
  await page.evaluate((message) => {
    ;(window as unknown as MockWindow).retroMock.aiReviewReply(message)
  }, text)
})

/**
 * **The AI takes a record off the queue** (RL-50) — the in-progress marker being
 * put up, in the AI's own process.
 *
 * It names the retrospective, like the resolve step in `records.steps.ts` and for
 * that step's reason: an agent works a queue that spans retrospectives, and a rid
 * on its own does not name a record (A5). Nothing about this goes through the
 * page, because nothing can — there is no procedure to claim with, by design.
 */
When(
  'the AI claims record {string} of retro {int}',
  async ({ page }, rid: string, retro: number) => {
    await page.evaluate(
      ({ retroId, record }) => {
        ;(window as unknown as MockWindow).retroMock.aiClaim(retroId, record)
      },
      { retroId: retro, record: rid },
    )
  },
)

/* ── what the reviewer sees ───────────────────────────────────────────────── */

Then('the records appear in the order {string}', async ({ page }, order: string) => {
  const rids = listed(order)
  const cards = page.getByTestId(/^record-r-/)
  await expect(cards).toHaveCount(rids.length)
  for (const [index, rid] of rids.entries()) {
    await expect(cards.nth(index)).toHaveAttribute('data-testid', `record-${rid}`)
  }
})

Then('record {string} is {string}', async ({ page }, rid: string, state: string) => {
  await expect(card(page, rid).getByTestId('record-state')).toContainText(state)
})

/**
 * The absence of the hold surface, counted rather than named (retro 4
 * `r-remove-hold`).
 *
 * There were four testids on the control and its tag — `hold`, `release`,
 * `hold-note`, `record-held` — and checking for the four somebody remembers is
 * how a fifth comes back unnoticed. This reads every hook the card actually
 * rendered and fails on any of them that is parking-shaped.
 */
Then('record {string} offers nothing that parks it', async ({ page }, rid: string) => {
  const rendered = await card(page, rid).evaluate((root) =>
    [root, ...root.querySelectorAll('[data-testid]')].map(
      (element) => element.getAttribute('data-testid') ?? '',
    ),
  )
  const parking = rendered.filter((testid) => /hold|held|park|release/i.test(testid))
  expect(parking, `record ${rid} is still rendering a hold surface`).toEqual([])
})

/**
 * The header's whole set of hooks, in order — the same claim from the other
 * side. A record wore a HELD tag beside its verdict for one session, and an
 * exact list is what stops a second status coming back next to the first: this
 * fails on an extra tag, a missing one, and a reordering alike.
 *
 * `open-thread` joined the list in retro 10 and had to be admitted rather than
 * tolerated, which is the list working as intended: *"I want abillity to post a
 * comment at the title level as well for a record"*
 * (`r-title-comments-unreachable`). It is the last entry because it sits after
 * the title's last word, which is his reviewer note — so this ordering is a
 * second, cheaper witness to the placement the geometry step measures.
 */
Then(
  'record {string} wears no status but its verdict and who asked for it',
  async ({ page }, rid: string) => {
    const worn = await card(page, rid)
      .locator('header')
      .evaluate((header) =>
        [...header.querySelectorAll('[data-testid]')].map(
          (element) => element.getAttribute('data-testid') ?? '',
        ),
      )
    expect(worn).toEqual([
      'record-num',
      'record-type',
      'record-state',
      'record-requester',
      'record-title',
      'open-thread',
    ])
  },
)

/**
 * What the verdict row offers, counted and named rather than checked for the
 * absence of one button. `hold` left this row in `r-hold-semantics`, and
 * asserting the whole row is what stops it coming back beside the other two.
 */
Then(
  'record {string} offers the verdicts {string}',
  async ({ page }, rid: string, offered: string) => {
    // Every button on the verdict row, counted rather than named: asserting the
    // absence of a `hold` button only rules out the one somebody thought of.
    await expect(verdicts(page, rid)).toHaveText(listed(offered))
  },
)

/**
 * Which verdict the card says is selected, in the form assistive technology
 * reads it. The visible half of the same claim is the step below — both are
 * asserted, because a fill nobody can hear and a state nobody can see are each
 * half an answer to *"there should be a clear indication as to what is already
 * selected"* (retro 4 `r-verdict-revise`).
 */
Then(
  'the chosen verdict on record {string} is {string}',
  async ({ page }, rid: string, state: string) => {
    const chosen = verdicts(page, rid).and(page.locator('[aria-pressed="true"]'))
    await expect(chosen).toHaveCount(1)
    await expect(chosen).toHaveAttribute('data-testid', state)
  },
)

Then('no verdict is chosen on record {string}', async ({ page }, rid: string) => {
  await expect(verdicts(page, rid).and(page.locator('[aria-pressed="true"]'))).toHaveCount(0)
})

/**
 * The visible half: the chosen verdict must not render like the ones beside it.
 *
 * Read off the rendered page rather than off a class name, because the claim is
 * about what a reader sees — and **channel by channel**, because "differs
 * somehow" is not the claim. The treatment promises four things (fill, ink,
 * border, weight) and the record was filed because a *weight* was all that told
 * a decided button from an undecided one; an assertion that accepted any single
 * difference would accept exactly that state. Each channel is also asserted to
 * agree across the undecided buttons, so three buttons that all looked
 * different could not pass by accident.
 */
const CHANNELS = ['fill', 'ink', 'border', 'weight'] as const

type VerdictLook = {
  readonly chosen: boolean
  readonly channels: Record<(typeof CHANNELS)[number], string>
}

/**
 * Transitions are switched off before anything is measured: the claim is about
 * the colour the button comes to rest at, and an in-flight transition would let
 * the answer depend on when the step happened to look.
 */
async function verdictLooks(page: Page, rid: string): Promise<VerdictLook[]> {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  return verdicts(page, rid).evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button)
      return {
        chosen: button.getAttribute('aria-pressed') === 'true',
        channels: {
          fill: style.backgroundColor,
          ink: style.color,
          border: style.borderColor,
          weight: style.fontWeight,
        },
      }
    }),
  )
}

/**
 * The same reading, on the tab strip. Three channels rather than the verdicts'
 * four: the open tab is deliberately not bolded, because a weight change resizes
 * it and a strip that jumps every time the reviewer looks at another solution is
 * worse than one channel fewer (`tabs.tsx`).
 */
const TAB_CHANNELS = ['fill', 'ink', 'border'] as const

type TabLook = {
  readonly open: boolean
  readonly channels: Record<(typeof TAB_CHANNELS)[number], string>
}

async function solutionTabLooks(page: Page, rid: string): Promise<TabLook[]> {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  return solutionTabs(page, rid).evaluateAll((tabs) =>
    tabs.map((tab) => {
      const style = getComputedStyle(tab)
      return {
        open: tab.getAttribute('aria-selected') === 'true',
        channels: {
          fill: style.backgroundColor,
          ink: style.color,
          border: style.borderColor,
        },
      }
    }),
  )
}

function expectOpenTabToStandOut(looks: TabLook[]): void {
  const open = looks.filter((look) => look.open)
  const rest = looks.filter((look) => !look.open)
  expect(open, 'exactly one tab is open').toHaveLength(1)
  expect(rest.length, 'nothing to stand out from').toBeGreaterThan(0)

  const picked = open[0]?.channels
  if (picked === undefined) return
  for (const channel of TAB_CHANNELS) {
    const closed = [...new Set(rest.map((look) => look.channels[channel]))]
    expect(closed.length, `the closed tabs differ from each other in ${channel}`).toBe(1)
    expect(
      closed,
      `the open tab's ${channel} is the closed ones' (${picked[channel]})`,
    ).not.toContain(picked[channel])
  }
}

function expectChosenToStandOut(looks: VerdictLook[]): void {
  const chosen = looks.filter((look) => look.chosen)
  const rest = looks.filter((look) => !look.chosen)
  expect(chosen, 'exactly one verdict is chosen').toHaveLength(1)
  expect(rest.length, 'nothing to stand out from').toBeGreaterThan(0)

  const picked = chosen[0]?.channels
  if (picked === undefined) return
  for (const channel of CHANNELS) {
    const undecided = [...new Set(rest.map((look) => look.channels[channel]))]
    expect(undecided.length, `the undecided verdicts differ from each other in ${channel}`).toBe(1)
    expect(
      undecided,
      `the chosen verdict's ${channel} is the undecided ones' (${picked[channel]})`,
    ).not.toContain(picked[channel])
  }
}

/**
 * At rest: nothing is touching the page.
 *
 * This is a controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`), and the control has earned its keep four times.
 * With the selected styling deleted, the first version passed because **the
 * pointer was resting on the button it had just clicked** and `hover:bg-muted`
 * was doing the standing out for it. Moving the mouse away left a second way to
 * pass — `transition-all` was still animating *back* from the hover colour, so
 * the answer depended on when the step looked. With both fixed, the suite still
 * shipped a dark-theme collapse green, because nothing here had ever looked at
 * the page in the other theme. And with the theme covered, the shipped bug
 * *still* passed, because the four channels were compared as one string and the
 * font weight survived where the fill did not — which is why they are compared
 * one at a time above.
 */
Then(
  'the chosen verdict on record {string} stands out from the ones beside it',
  async ({ page }, rid: string) => {
    await page.mouse.move(0, 0)
    await expect(async () => {
      expectChosenToStandOut(await verdictLooks(page, rid))
    }).toPass()
  },
)

/**
 * And under the pointer, where `hover:bg-muted` / `hover:text-foreground` from
 * the Button's outline variant used to erase the treatment — the reviewer hovers
 * the button they are about to press again to undo it, which is exactly the
 * moment they need to see what it currently says.
 */
Then(
  'the chosen verdict on record {string} still stands out with the pointer on it',
  async ({ page }, rid: string) => {
    await verdicts(page, rid).and(page.locator('[aria-pressed="true"]')).hover()
    await expect(async () => {
      expectChosenToStandOut(await verdictLooks(page, rid))
    }).toPass()
  },
)

Then('record {string} shows {string}', async ({ page }, rid: string, text: string) => {
  await expect(card(page, rid)).toContainText(text)
})

/**
 * The number in the card's header, exactly — `toHaveText` on the one element,
 * not `toContainText` on the card, because a card contains a great deal of prose
 * and "#7" appears inside a footprint the moment somebody writes one.
 */
Then('record {string} is numbered {string}', async ({ page }, rid: string, num: string) => {
  await expect(card(page, rid).getByTestId('record-num')).toHaveText(num)
})

Then(
  'record {string} shows the sections {string}',
  async ({ page }, rid: string, sections: string) => {
    for (const section of listed(sections)) {
      await expect(card(page, rid).getByTestId(`section-${section}`)).toBeVisible()
    }
  },
)

Then(
  'the {string} of record {string} reads {string}',
  async ({ page }, field: string, rid: string, text: string) => {
    await expect(card(page, rid).getByTestId(field)).toContainText(text)
  },
)

/** Whose complaint this is (`requester`), in the header where the record starts. */
Then('record {string} is requested by {string}', async ({ page }, rid: string, party: string) => {
  await expect(card(page, rid).getByTestId('record-requester')).toHaveText(party)
})

/**
 * The in-progress marker, read off the card's own header (RL-50).
 *
 * `toHaveText` on the tag rather than `toContainText` on the card: a record whose
 * narrative happened to contain the words would satisfy the looser check while
 * the badge was missing, which is the assertion that cannot fail
 * (`r-assertion-value-distinctiveness`).
 */
Then('record {string} is marked {string}', async ({ page }, rid: string, mark: string) => {
  await expect(card(page, rid).getByTestId('record-claim')).toHaveText(mark)
})

/**
 * The absence of it, said twice on purpose: the tag is gone, **and** the words
 * are gone from the header.
 *
 * The second half is what makes this the negative of the step above rather than
 * a check that one testid vanished — a badge that came back under another name,
 * or a mark left rendered without its hook, would satisfy the count alone.
 */
Then('record {string} is not marked {string}', async ({ page }, rid: string, mark: string) => {
  await expect(card(page, rid).getByTestId('record-claim')).toHaveCount(0)
  await expect(card(page, rid).getByTestId('record-header')).not.toContainText(mark)
})

/* ── how prose renders (r-prose-renders-raw) ──────────────────────────────── */

/**
 * The bold leads, as an exact ordered list. The owner reads a record by skimming
 * them, so the claim is not "some bold exists somewhere" — it is that these
 * leads, in this order, are what a skim would pick up.
 */
Then(
  'the {string} prose of record {string} has the bold leads:',
  async ({ page }, section: string, rid: string, leads: DataTable) => {
    await expect(prose(page, rid, section).getByTestId('prose-strong')).toHaveText(rows(leads))
  },
)

Then(
  'the {string} prose of record {string} has the bullets:',
  async ({ page }, section: string, rid: string, items: DataTable) => {
    await expect(prose(page, rid, section).getByTestId('prose-bullet')).toHaveText(rows(items))
  },
)

Then(
  'the {string} prose of record {string} has the numbered items:',
  async ({ page }, section: string, rid: string, items: DataTable) => {
    await expect(prose(page, rid, section).getByTestId('prose-number')).toHaveText(rows(items))
  },
)

/**
 * A nested list, asserted as nested rather than as "a second list that happens
 * to be there": the whole difference between reading the indentation and
 * ignoring it is whether the list hangs off a list item or off the prose root,
 * and only the DOM can say which.
 */
Then(
  'the {string} prose of record {string} nests the bullets:',
  async ({ page }, section: string, rid: string, items: DataTable) => {
    const nested = prose(page, rid, section).getByTestId('prose-nested')
    await expect(nested).toHaveCount(1)
    await expect(nested.getByTestId('prose-nested-bullet')).toHaveText(rows(items))
    const parent = await nested.evaluate(
      (element) => element.parentElement?.tagName.toLowerCase() ?? 'nothing',
    )
    expect(parent, 'the nested list does not hang off a list item').toBe('li')
  },
)

/**
 * A fence, asserted as the two things it claims to be: preformatted, so the
 * whitespace that *is* the content survives, and unparsed, so what comes out is
 * character for character what went in. `innerText` is what the page shows —
 * under a collapsing `white-space` the indentation is gone from the screen while
 * still sitting in the DOM.
 */
Then(
  'the {string} prose of record {string} fences exactly:',
  async ({ page }, section: string, rid: string, code: string) => {
    const fence = prose(page, rid, section).getByTestId('prose-fence')
    await expect(fence).toHaveCount(1)
    const whiteSpace = await fence.evaluate((element) => getComputedStyle(element).whiteSpace)
    expect(['pre', 'pre-wrap'], 'the fence collapses whitespace').toContain(whiteSpace)
    expect((await fence.innerText()).replace(/\n+$/, '')).toBe(code)
  },
)

/**
 * The human's own words, which nothing may reinterpret — so this reads them as
 * lines rather than as rendered structure, and the table below it carries the
 * markdown characters the human typed still being characters.
 */
Then(
  'the {string} human words of record {string} read the lines:',
  async ({ page }, half: string, rid: string, lines: DataTable) => {
    const words = card(page, rid).getByTestId(`human-words-${half}`).first()
    const rendered = (await words.innerText())
      .trim()
      .split('\n')
      .map((line) => line.trim())
    expect(rendered).toEqual(rows(lines))
  },
)

/* ── the root-cause gutter (r-whys-labels) ────────────────────────────────── */

/** INCIDENT · WHY 1 … WHY n · ROOT, in the order the section lays them out. */
function gutterLabels(page: Page, rid: string): Locator {
  return card(page, rid).getByTestId('section-root_cause').getByTestId('gutter-label')
}

/**
 * Every gutter label as the browser laid it out.
 *
 * `lines` is counted off a range over the label's own text rather than off its
 * box: a gutter label is a flex item, so its box is stretched to the height of
 * the prose beside it and says nothing about how many lines the *word* took. The
 * range's client rects are the line boxes the text actually got, counted by
 * their tops because "WHY" and "1" are two text nodes even when they share one.
 */
async function gutterBoxes(
  page: Page,
  rid: string,
): Promise<{ text: string; width: number; lines: number; overflow: number }[]> {
  return gutterLabels(page, rid).evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
      return {
        text: (element as HTMLElement).innerText,
        width: element.getBoundingClientRect().width,
        lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
        overflow: element.scrollWidth - element.clientWidth,
      }
    }),
  )
}

/**
 * The labels as a reader sees them: `useInnerText`, because the caps are painted
 * by `text-transform` and `textContent` would report a page showing "why 1" as
 * though it said WHY 1. An exact ordered list, so a missing INCIDENT, a why that
 * lost its number, or a ROOT that drifted back to title case fails here.
 */
Then(
  'the root-cause labels of record {string} read:',
  async ({ page }, rid: string, labels: DataTable) => {
    await expect(gutterLabels(page, rid)).toHaveText(rows(labels), { useInnerText: true })
  },
)

/**
 * "The Ys label is taking two lines. It should be just one line."
 *
 * A controlled assertion (testing.md §Operational rules, `r-uncontrolled-assertions`):
 * hand-run with `.gutter-label`'s width and `nowrap` deleted — the gutter he was
 * shown, shrinking against the prose beside it until "WHY" and its number were
 * on different lines — and the failure output is in the lane report. Asserted on
 * the iPad in portrait, his review screen and the width where a text-relative
 * gutter has least room to stay on one line.
 */
Then(
  'the root-cause labels of record {string} are one line each',
  async ({ page }, rid: string) => {
    const boxes = await gutterBoxes(page, rid)
    expect(boxes.length, 'the root cause section rendered no labels at all').toBeGreaterThan(0)
    for (const box of boxes) {
      expect(box.lines, `"${box.text}" is folded onto more than one line`).toBe(1)
    }
  },
)

/**
 * "The width of the why's div is dependent on the size of the text in front of
 * it. That shouldn't be the case." Widths compared to each other rather than to
 * a number, because the claim is that they are one width — and the second half
 * checks that the width they share actually holds the longest of them, which is
 * what keeps `w-20` from being a number nobody ever re-measures.
 *
 * A controlled assertion: hand-run with the shared width deleted, and again with
 * it shrunk below INCIDENT; both failure outputs are in the lane report.
 */
Then(
  'the root-cause labels of record {string} are all the same width',
  async ({ page }, rid: string) => {
    const boxes = await gutterBoxes(page, rid)
    expect(boxes.length, 'a single label is the same width as itself').toBeGreaterThan(1)
    const widths = [...new Set(boxes.map((box) => Math.round(box.width)))]
    expect(
      widths,
      `the labels are sized off the text beside them (${boxes
        .map((box) => `${box.text}: ${Math.round(box.width)}px`)
        .join(', ')})`,
    ).toHaveLength(1)
    for (const box of boxes) {
      expect(
        box.overflow,
        `"${box.text}" does not fit the ${widths[0]}px the labels share`,
      ).toBeLessThanOrEqual(1)
    }
  },
)

/**
 * `r-incident-line-overflow` (retro 5): the prose half of a gutter row is a flex
 * item, so its automatic minimum size is its own min-content — the longest thing
 * in it that cannot be broken — and a cell whose min-content beats the row lays
 * out at that min-content and hangs off the end of it.
 *
 * **Two channels, because the fix is two clamps and each leaves the other's
 * failure standing** (`r-theme-blind-assertions`' rule about joined signatures,
 * applied to geometry):
 *
 *   - `box` — how far the prose *cell* reaches past its row. This is what
 *     `min-w-0` answers, and it is not `scrollWidth`: the cell does not
 *     overflow, it *grows*, so by every measure taken inside it everything fits.
 *     The first version of this step asked the cell whether it was overflowing
 *     and it truthfully said no while sitting 641px past the column.
 *   - `text` — how much the cell holds that is wider than the cell. This is what
 *     `break-words` answers. With `min-w-0` alone the box comes back inside the
 *     row and the token runs out of the box instead, which is the same lost line
 *     one box further in — and a step that only checked `box` passed on it.
 *
 * Nor does the page scroll sideways when any of this happens: a record's slot
 * clips (`overflow-hidden`, for the departure animation), so what a reader gets
 * is the incident line cut off at the card's edge with no scrollbar to suggest
 * there was more. That is why the sideways-scroll check is *not* in this
 * scenario — it cannot fail here, and an assertion that cannot fail is not
 * evidence.
 *
 * The offending row is named, so a regression says which of INCIDENT, a WHY or
 * ROOT ran over and by how much.
 */
Then(
  'the root-cause lines of record {string} stay inside their column',
  async ({ page }, rid: string) => {
    const rows = await card(page, rid)
      .getByTestId('section-root_cause')
      .evaluate((section) =>
        [
          ...section.querySelectorAll(
            '[data-testid="root-cause-incident"], [data-testid="root-cause-whys"] > li, [data-testid="root-cause-root"]',
          ),
        ].map((row) => {
          const prose = row.querySelector('[data-testid^="prose-"]')
          const edge = row.getBoundingClientRect().right
          return {
            label: row.querySelector('[data-testid="gutter-label"]')?.textContent ?? 'a line',
            box: prose === null ? 0 : Math.round(prose.getBoundingClientRect().right - edge),
            text: prose === null ? 0 : prose.scrollWidth - prose.clientWidth,
            room: Math.round(row.getBoundingClientRect().width),
          }
        }),
      )

    expect(rows.length, 'the root cause section rendered no lines at all').toBeGreaterThan(0)
    for (const row of rows) {
      expect(
        row.box,
        `"${row.label}" is a box reaching ${row.box}px past the ${row.room}px row it is in`,
      ).toBeLessThanOrEqual(0)
      expect(
        row.text,
        `"${row.label}" holds ${row.text}px more text than the box it was given, so the end of the line is cut off`,
      ).toBeLessThanOrEqual(0)
    }
  },
)

/* ── the solutions a record proposes ──────────────────────────────────────── */

/**
 * Every tab title, in order, as one exact ordered list — so a solution added,
 * dropped, reordered, or missing a marker fails here rather than passing on a
 * `toContain` that any one of them satisfies.
 *
 * The expected strings carry the marker's spoken word as well as its character,
 * because both are in the tab and both are the contract: `*` alone is a glyph
 * a reader has to have been told the meaning of, and the word is what a screen
 * reader announces in its place. A page that dropped either fails this line.
 */
Then(
  'the solution tabs of record {string} read:',
  async ({ page }, rid: string, titles: DataTable) => {
    await expect(solutionTabs(page, rid)).toHaveText(rows(titles))
  },
)

/**
 * One marker, read as the two things it is (`r-theme-blind-assertions`' rule
 * about channels, applied to a mark rather than a style): the character the
 * owner named, and the word it stands for. Either one alone is a marker that
 * only works for some readers, and a single joined assertion would pass with
 * one of them missing.
 */
Then(
  'the {string} on solution tab {int} of record {string} is named {string}',
  async ({ page }, symbol: string, position: number, rid: string, name: string) => {
    const mark = await solutionTab(page, rid, position)
      .getByTestId(`solution-tab-${position}-${MARKERS[symbol] ?? symbol}`)
      .evaluate((element) => ({
        symbol: (element.querySelector('[aria-hidden]')?.textContent ?? '').trim(),
        word: (element.querySelector('.sr-only')?.textContent ?? '').trim(),
      }))
    expect(mark.symbol, `the marker on solution tab ${position} is not the one asked for`).toBe(
      symbol,
    )
    expect(
      mark.word,
      `the "${symbol}" on solution tab ${position} says nothing a reader hears`,
    ).toBe(`(${name})`)
  },
)

/**
 * Which tab the reviewer is reading, and it is exactly one of them.
 *
 * **The whole set, polled** — and each half of that is load-bearing.
 *
 * The set, because the interesting failures are a strip with two tabs open and a
 * strip with none, and an assertion that only asked about tab N would pass on
 * both. The read is one pass over the strip so those states are visible at all.
 *
 * Polled, because this is the step a key press is read through and the press is
 * answered asynchronously: the arrow moves focus, the strip's own handler sets
 * the value, and React commits on a later tick. A single read taken the moment
 * the press returned caught the tab that *was* open about one run in five — the
 * flake the guards lane found on main, reproduced here at 7 in 36 before this
 * changed. Instrumenting it settled the question: the strip reached the right
 * tab **5ms** after the failing read, so the key was never lost and nothing was
 * unready — the step was simply reading a state machine mid-step.
 *
 * The claim is a settled one ("tab N is the one open"), so a settled read is
 * what states it. Nothing is weakened: the poll still has to arrive at exactly
 * `[position]`, and a strip that stays on the wrong tab, opens two, or opens
 * none fails here with the set it was actually showing.
 *
 *   cd apps/web && bun run test --grep 'operable from the keyboard' --repeat-each=36
 */
Then(
  'solution tab {int} of record {string} is the one open',
  async ({ page }, position: number, rid: string) => {
    await expect
      .poll(
        () =>
          solutionTabs(page, rid).evaluateAll((tabs) =>
            tabs.flatMap((tab, index) =>
              tab.getAttribute('aria-selected') === 'true' ? [index + 1] : [],
            ),
          ),
        { message: 'the strip says a different set of tabs is open' },
      )
      .toEqual([position])
    await expect(card(page, rid).getByTestId(`solution-${position}`)).toBeVisible()
  },
)

Then(
  'solution tab {int} of record {string} is ticked',
  async ({ page }, position: number, rid: string) => {
    await expect(solutionTab(page, rid, position).getByTestId(/-selected$/)).toHaveCount(1)
  },
)

/**
 * The two markers are two things, and this is the arrangement that proves it:
 * the AI's mark stays where the AI put it while the tick sits on the tab the
 * human chose. A page that drew one marker for both states passes every
 * assertion that only ever looks at one tab.
 */
Then(
  "solution tab {int} of record {string} carries the AI's mark and no tick",
  async ({ page }, position: number, rid: string) => {
    const tab = solutionTab(page, rid, position)
    await expect(tab.getByTestId(/-recommended$/)).toHaveCount(1)
    await expect(tab.getByTestId(/-selected$/)).toHaveCount(0)
  },
)

/**
 * Counted across the whole strip, because the interesting failure is a second
 * tick rather than a missing one: a page that *marks* the recommendation instead
 * of moving the pick to it leaves two ticks standing, and every assertion that
 * looks at one tab passes.
 *
 * Its opposite, "no tick anywhere", left with `r-recommended-preselected` — a
 * strip with no tick on it is not a state a record with solutions is ever in
 * now.
 */
Then('record {string} has exactly one ticked solution tab', async ({ page }, rid: string) => {
  await expect(solutionStrip(page, rid).getByTestId(/-selected$/)).toHaveCount(1)
})

/**
 * The agreement state, counted across the whole strip: the `*` is what the AI
 * had recommended and it is worth showing only once the tick has moved off it
 * (`r-recommended-preselected`). While the two agree there is no mark anywhere,
 * and a strip that kept the star on the ticked tab would fail here rather than
 * pass an assertion that only ever looked at the tick.
 */
Then('record {string} shows no AI mark on any solution tab', async ({ page }, rid: string) => {
  await expect(solutionStrip(page, rid).getByTestId(/-recommended$/)).toHaveCount(0)
})

/**
 * The single-solution shape, swept by counting rather than by naming what is
 * gone (`r-single-solution-no-tabs`, and the session-6 renamed-panel lesson: a
 * sweep that names the elements it expects to be absent passes the day one of
 * them is renamed).
 *
 * Four zeros and a one. The zeros are the choice chrome — no strip, no tab, no
 * tick, nothing to press — and the one is the solution itself, because a card
 * that rendered no solution at all would satisfy every zero and prove nothing
 * (`r-uncontrolled-assertions`).
 */
Then(
  'record {string} shows its one solution and no way to choose',
  async ({ page }, rid: string) => {
    const record = card(page, rid)
    await expect(record.getByTestId('solution-tab-strip')).toHaveCount(0)
    await expect(record.getByTestId(/^solution-tab-\d+$/)).toHaveCount(0)
    await expect(record.getByTestId(/-selected$/)).toHaveCount(0)
    await expect(record.getByTestId(/^solution-\d+-select$/)).toHaveCount(0)
    await expect(record.getByTestId(/^solution-\d+$/)).toHaveCount(1)
  },
)

/**
 * A solution's body order, read as the panel's own child order rather than as
 * three visibility checks — three things all being present says nothing about
 * which one the reader meets first.
 *
 * **One step for both shapes since `r-level-legend-below-fold`.** The tab body
 * used to run bullets → footprint → level and the single-solution branch
 * level → bullets → footprint, so there were two steps a line apart. The owner
 * moved the level to the top of the tab body — *"move the Level right after the
 * tabs so that the user can immediately see what L2 means"* — which is the order
 * the branch already had, and two orders became one.
 */
Then(
  'solution {int} of record {string} is laid out as its level, then bullets, then a footprint',
  async ({ page }, position: number, rid: string) => {
    const order = await card(page, rid)
      .getByTestId(`solution-${position}`)
      .evaluate((panel) =>
        [...panel.children].map((child) => child.getAttribute('data-testid') ?? 'untagged'),
      )
    expect(order.slice(0, 3)).toEqual([
      `solution-${position}-level`,
      `prose-solution-${position}`,
      `solution-${position}-footprint-block`,
    ])
  },
)

/**
 * The canonical level label, both halves, never abbreviated — the owner's
 * standing rule for the enums that explain themselves. An exact match rather
 * than a containment: a truncated label contains its own prefix.
 */
Then(
  'solution {int} of record {string} reads the level {string}',
  async ({ page }, position: number, rid: string, label: string) => {
    await expect(card(page, rid).getByTestId(`solution-${position}-level`)).toHaveText(label)
  },
)

Then(
  'solution {int} of record {string} shows {string}',
  async ({ page }, position: number, rid: string, text: string) => {
    await expect(card(page, rid).getByTestId(`solution-${position}`)).toContainText(text)
  },
)

/**
 * The frame the owner asked for, read one channel at a time
 * (`r-footprint-block-presentation`, and `r-theme-blind-assertions` for the
 * shape of the check): a border that is actually drawn, a border colour that is
 * not the surface it sits on, and room above and below.
 *
 * The colour is compared against the card behind it rather than against a
 * literal, because a hairline is a *contrast* claim and the token it comes from
 * is a different value in each theme — a hard-coded rgb would pass in one theme
 * and be asserted away in the other. A frame painted in the card's own colour is
 * a frame nobody can see, and it is the failure a `borderWidth > 0` check alone
 * would wave through.
 */
Then(
  'the footprint of solution {int} of record {string} is framed',
  async ({ page }, position: number, rid: string) => {
    const frame = await card(page, rid)
      .getByTestId(`solution-${position}-footprint-block`)
      .evaluate((box) => {
        const style = getComputedStyle(box)
        const behind = box.closest('[data-testid^="record-r-"]')
        return {
          width: Math.round(Number.parseFloat(style.borderTopWidth)),
          ink: style.borderTopColor,
          surface: behind === null ? 'no card' : getComputedStyle(behind).backgroundColor,
          above: Math.round(Number.parseFloat(style.marginTop)),
          below: Math.round(Number.parseFloat(style.marginBottom)),
        }
      })
    expect(
      frame.width,
      'the footprint has no border, so nothing says it is a block',
    ).toBeGreaterThan(0)
    expect(
      frame.ink,
      `the footprint's border is the card's own colour (${frame.surface}), so there is no frame to see`,
    ).not.toBe(frame.surface)
    expect(frame.above, 'the footprint is still squeezed against what is above it').toBeGreaterThan(
      0,
    )
    expect(frame.below, 'the footprint is still squeezed against what is below it').toBeGreaterThan(
      0,
    )
  },
)

/**
 * The title on the block — *"give it a title, something like 'Change footprint',
 * so it's clear what this section is"*. An exact match: a caption that says half
 * of it says the wrong thing.
 */
Then(
  'the footprint of solution {int} of record {string} is captioned {string}',
  async ({ page }, position: number, rid: string, caption: string) => {
    await expect(card(page, rid).getByTestId(`solution-${position}-footprint-caption`)).toHaveText(
      caption,
    )
  },
)

/**
 * The other direction, and the one the record is explicit about: a record filed
 * before solutions existed keeps its footprint section exactly as it shipped —
 * its own heading, no frame, no caption. Human data is never re-presented to suit
 * a newer page.
 */
Then('record {string} keeps its footprint section unframed', async ({ page }, rid: string) => {
  const record = card(page, rid)
  await expect(record.getByTestId(/-footprint-block$/)).toHaveCount(0)
  await expect(record.getByTestId(/-footprint-caption$/)).toHaveCount(0)
  const border = await record
    .getByTestId('section-footprint-text')
    .evaluate((box) => Math.round(Number.parseFloat(getComputedStyle(box).borderTopWidth)))
  expect(border, 'the legacy record footprint gained a frame it never had').toBe(0)
})

/** The same painted-drawing check as the record footprint, per solution. */
Then(
  'the footprint of solution {int} of record {string} is preformatted',
  async ({ page }, position: number, rid: string) => {
    const painted = await card(page, rid)
      .getByTestId(`solution-${position}-footprint`)
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          whiteSpace: style.whiteSpace,
          font: style.fontFamily.toLowerCase(),
        }
      })
    expect(painted.tag, 'the footprint is not a preformatted element').toBe('pre')
    expect(['pre', 'pre-wrap'], 'the footprint collapses whitespace').toContain(painted.whiteSpace)
    expect(painted.font, 'the footprint is not monospace').toContain('mono')
  },
)

/**
 * The wide-drawing case, read as the two things that can actually go wrong here.
 *
 * The first is about the **fixture**: the drawing really is wider than its box.
 * A footprint whose every line fits makes the second assertion pass by having
 * nothing to do, and the first version of this scenario was exactly that — the
 * guard is what said so (`r-assertion-value-distinctiveness`).
 *
 * The second is the claim: the box is a scroller, so what is off the edge can be
 * reached instead of lost.
 *
 * **A third channel was written and then removed, because it could not fail.**
 * The tab strip puts two new flex ancestors between this `<pre>` and the card,
 * which looks like `r-incident-line-overflow` — but both are *column* flex
 * containers, and a column flex item stretches to its container's width rather
 * than growing it, so the box cannot reach past the section however wide the
 * drawing is. Neither can the page scroll sideways: a record's slot clips for
 * the departure animation, which is the same reason the root-cause scenario
 * leaves that check out. With `overflow-x-auto` deleted, both stayed green while
 * the wide line was silently cut — hand-run, and in the lane report.
 *
 * A controlled assertion; the failure output with `overflow-x-auto` deleted is
 * in the lane report.
 */
Then(
  'the footprint of solution {int} of record {string} scrolls inside its own box',
  async ({ page }, position: number, rid: string) => {
    const drawn = await card(page, rid)
      .getByTestId(`solution-${position}-footprint`)
      .evaluate((box) => ({
        hidden: box.scrollWidth - box.clientWidth,
        scroller: getComputedStyle(box).overflowX,
        width: Math.round(box.getBoundingClientRect().width),
      }))
    expect(
      drawn.hidden,
      `every line of this footprint fits the ${drawn.width}px box it is drawn in, so nothing here is under any pressure`,
    ).toBeGreaterThan(0)
    expect(drawn.scroller, 'the footprint is not a scroller, so the wide line is simply lost').toBe(
      'auto',
    )
  },
)

/**
 * Two solutions whose footprints are the same string are a page rendering one
 * footprint twice — which is exactly what a card that kept the record-level
 * field and printed it under each solution would look like.
 *
 * Read one tab at a time, because one tab at a time is what is in the document:
 * the closed panels are unmounted, which is also why this cannot pass by
 * reading the same element twice.
 */
Then(
  'the footprint of solution {int} of record {string} differs from solution {int}',
  async ({ page }, position: number, rid: string, other: number) => {
    const read = async (at: number) => {
      await solutionTab(page, rid, at).click()
      return card(page, rid).getByTestId(`solution-${at}-footprint`).innerText()
    }
    expect(await read(position)).not.toBe(await read(other))
  },
)

/**
 * Counted absence, not a guess at what a wrong page would look like: the
 * sections a record must NOT show are asserted to be zero elements, so a card
 * rendering both shapes at once fails here.
 */
Then(
  'record {string} does not show the sections {string}',
  async ({ page }, rid: string, sections: string) => {
    for (const section of listed(sections)) {
      await expect(card(page, rid).getByTestId(`section-${section}`)).toHaveCount(0)
    }
  },
)

Then('record {string} offers the solution level radio', async ({ page }, rid: string) => {
  await expect(card(page, rid).getByTestId('solution-level').getByRole('radio')).toHaveCount(5)
})

Then('record {string} does not offer the solution level radio', async ({ page }, rid: string) => {
  await expect(card(page, rid).getByTestId('solution-level')).toHaveCount(0)
})

/**
 * The replacement, swept in both directions. The stacked list the tabs replaced
 * had a heading per solution and every one of them on screen at once; a card
 * rendering both would satisfy every assertion about the tabs and still be
 * wrong, so the headings are counted to zero here rather than assumed gone.
 */
Then(
  'record {string} has one solution tab strip and no stacked solution list',
  async ({ page }, rid: string) => {
    await expect(card(page, rid).getByTestId('solution-tabs')).toHaveCount(1)
    await expect(card(page, rid).getByRole('tablist')).toHaveCount(1)
    await expect(card(page, rid).getByTestId(/^solution-\d+-heading$/)).toHaveCount(0)
  },
)

/** The other direction: a record filed before solutions has nothing to tab. */
Then('record {string} has no solution tab strip', async ({ page }, rid: string) => {
  await expect(card(page, rid).getByTestId('solution-tabs')).toHaveCount(0)
  await expect(card(page, rid).getByRole('tablist')).toHaveCount(0)
})

Then(
  'solution {int} of record {string} offers no Select',
  async ({ page }, position: number, rid: string) => {
    await expect(card(page, rid).getByTestId(`solution-${position}-select`)).toHaveCount(0)
  },
)

/**
 * Every tab, not the one that happens to be open: a finished review takes no
 * control at all, and a card that hid the Select on the decided tab alone would
 * still hand one to a reviewer who clicked along the strip.
 */
Then('record {string} offers no Select on any solution', async ({ page }, rid: string) => {
  const tabs = await solutionTabs(page, rid).count()
  expect(tabs, 'the record shows no solution tabs at all').toBeGreaterThan(0)
  for (let position = 1; position <= tabs; position += 1) {
    await solutionTab(page, rid, position).click()
    await expect(card(page, rid).getByTestId(`solution-${position}`)).toBeVisible()
    await expect(card(page, rid).getByTestId(`solution-${position}-select`)).toHaveCount(0)
  }
})

/**
 * The line the tick replaced. On a record that proposes solutions the ceiling is
 * the chosen solution's, and the decision block printing a second copy of it is
 * the same answer twice on one card — so the block is asserted to hold none,
 * rather than the tab being asserted to hold one and the duplicate going unseen.
 */
Then(
  'the decision block of record {string} prints no solution level of its own',
  async ({ page }, rid: string) => {
    await expect(
      card(page, rid).getByTestId('section-defaults').getByTestId('solution-level'),
    ).toHaveCount(0)
  },
)

/**
 * Roving focus, which is the half of the tabs contract a mouse never exercises.
 *
 * Three solutions must not be three stops on the way past this record: the strip
 * takes **one** tab press, and the arrows move inside it. Before the keyboard
 * has been in there, the strip itself is the stop and every tab is out of the
 * order — which is what makes it one press rather than three.
 *
 * A controlled assertion (`r-uncontrolled-assertions`): hand-run against the
 * strip rebuilt from plain buttons, and the failure output is in the lane
 * report.
 */
Then(
  'the solution strip of record {string} is one stop in the tab order',
  async ({ page }, rid: string) => {
    await expect(solutionStrip(page, rid)).toHaveAttribute('tabindex', '0')
    const tabbable = await solutionTabs(page, rid).evaluateAll((tabs) =>
      tabs.flatMap((tab, index) => (tab.getAttribute('tabindex') === '-1' ? [] : [index + 1])),
    )
    expect(
      tabbable,
      `${tabbable.length} of the tabs are their own stop, so the strip costs that many tab presses to walk past`,
    ).toEqual([])
  },
)

/**
 * And where the keyboard rests once it is inside: on the tab that is open, so
 * coming back to the strip returns the reviewer to what he was reading rather
 * than to the first solution. This is the *roving* half — the stop moves with
 * the arrows, and it moves to exactly one place.
 */
Then(
  'the solution strip of record {string} leaves the keyboard on the open tab',
  async ({ page }, rid: string) => {
    const stops = await solutionTabs(page, rid).evaluateAll((tabs) =>
      tabs.map((tab, index) => ({
        position: index + 1,
        resting: tab.getAttribute('tabindex') === '0',
        open: tab.getAttribute('aria-selected') === 'true',
      })),
    )
    const resting = stops.filter((stop) => stop.resting).map((stop) => stop.position)
    const open = stops.filter((stop) => stop.open).map((stop) => stop.position)
    expect(resting, `the strip rests on ${resting.length} tabs, not one`).toHaveLength(1)
    expect(resting, 'the strip rests on a tab the reviewer is not reading').toEqual(open)
  },
)

Then(
  'the keyboard is on solution tab {int} of record {string}',
  async ({ page }, position: number, rid: string) => {
    expect(rid, 'the strip is addressed by record').not.toBe('')
    await expect.poll(() => focusedTestId(page)).toBe(`solution-tab-${position}`)
  },
)

/**
 * Which tab is open, read off the rendered page channel by channel and in both
 * themes (`r-theme-blind-assertions`). Three channels, because the fill, the ink
 * and the border are three separate rules and a dark override that suppresses
 * one leaves the other two standing — which is how a chosen-verdict styling
 * shipped green in retro 5 with only its font weight surviving.
 *
 * The closed tabs are also asserted to agree with each other, so a strip whose
 * tabs all looked different could not pass by accident.
 */
Then(
  'the open solution tab of record {string} stands out from the closed ones',
  async ({ page }, rid: string) => {
    await page.mouse.move(0, 0)
    await expect(async () => {
      expectOpenTabToStandOut(await solutionTabLooks(page, rid))
    }).toPass()
  },
)

/**
 * Every marker on the strip, read as the two things a marker is — the character
 * and the word. Run in both themes by the scenario that uses it, because that is
 * the point: a mark carried by a colour would pass in one theme and vanish in
 * the other, and neither of these channels is a colour at all.
 */
Then(
  'every marker on the solution tabs of record {string} carries a symbol and a word',
  async ({ page }, rid: string) => {
    const marks = await solutionStrip(page, rid)
      .getByTestId(/-(recommended|selected)$/)
      .evaluateAll((marks) =>
        marks.map((mark) => ({
          testId: mark.getAttribute('data-testid') ?? 'untagged',
          symbol: (mark.querySelector('[aria-hidden]')?.textContent ?? '').trim(),
          word: (mark.querySelector('.sr-only')?.textContent ?? '').trim(),
          shown: mark.getBoundingClientRect().width > 0,
        })),
      )
    expect(marks.length, 'the strip carries no markers at all').toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.symbol, `${mark.testId} draws no character`).not.toBe('')
      expect(mark.word, `${mark.testId} says nothing a reader hears`).not.toBe('')
      expect(mark.shown, `${mark.testId} takes up no room, so nothing is on screen`).toBe(true)
    }
  },
)

/* ── the footprint, which is not prose ────────────────────────────────────── */

/**
 * The footprint is a drawing, and the claim is that the browser painted the
 * drawing: a monospace element whose computed `white-space` keeps the runs of
 * spaces the columns are made of. `pre-line` — which preserves newlines but
 * collapses spaces — is the near miss this rules out, so the check is on the
 * computed style rather than on the class list.
 */
Then('the footprint of record {string} is preformatted', async ({ page }, rid: string) => {
  const painted = await card(page, rid)
    .getByTestId('section-footprint-text')
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        tag: element.tagName.toLowerCase(),
        whiteSpace: style.whiteSpace,
        font: style.fontFamily.toLowerCase(),
      }
    })
  expect(painted.tag, 'the footprint is not a preformatted element').toBe('pre')
  expect(['pre', 'pre-wrap'], 'the footprint collapses whitespace').toContain(painted.whiteSpace)
  expect(painted.font, 'the footprint is not monospace').toContain('mono')
})

/**
 * `innerText` rather than `textContent`, because the question is what the page
 * shows: under a collapsing `white-space` the leading spaces and the tag column
 * are gone from what the reader sees while still sitting in the DOM.
 */
Then(
  'the footprint of record {string} reads exactly:',
  async ({ page }, rid: string, tree: string) => {
    const rendered = await card(page, rid).getByTestId('section-footprint-text').innerText()
    expect(rendered.replace(/\n+$/, '')).toBe(tree)
  },
)

/**
 * What the browser actually laid out on separate lines.
 *
 * `textContent` cannot see this: `<p>a<br>b</p>` reads "ab" whether the break
 * was rendered or the newline was swallowed, which is exactly the collapse this
 * record is about. `innerText` is the rendered text, so a line break in it is a
 * line break on the page.
 */
Then(
  'the {string} prose of record {string} reads the lines:',
  async ({ page }, section: string, rid: string, lines: DataTable) => {
    const rendered = (await prose(page, rid, section).innerText())
      .trim()
      .split('\n')
      .map((line) => line.trim())
    expect(rendered).toEqual(rows(lines))
  },
)

Then(
  'the {string} prose of record {string} shows the literal text {string}',
  async ({ page }, section: string, rid: string, text: string) => {
    await expect(prose(page, rid, section)).toContainText(text)
  },
)

Then(
  'the {string} prose of record {string} shows the code {string}',
  async ({ page }, section: string, rid: string, text: string) => {
    await expect(prose(page, rid, section).getByTestId('prose-code')).toHaveText([text])
  },
)

/**
 * The other half of "HTML in the source is text": the characters being on the
 * page proves nothing was executed *this* time, and this proves nothing outside
 * the subset was built at all. A renderer that grew an escape hatch fails here
 * whatever the fixture happens to contain.
 */
const SAFE_SUBSET = ['p', 'br', 'strong', 'code', 'ul', 'ol', 'li', 'pre', 'blockquote']

Then(
  'the {string} prose of record {string} is built only from the safe subset',
  async ({ page }, section: string, rid: string) => {
    const built = await prose(page, rid, section).evaluate((root) =>
      [...root.querySelectorAll('*')].map((element) => element.tagName.toLowerCase()),
    )
    expect(
      built.filter((tag) => !SAFE_SUBSET.includes(tag)),
      'the prose renderer built an element outside the safe subset',
    ).toEqual([])
  },
)

/**
 * The owner's complaint, asserted as the absence it was: markdown *syntax* on
 * the page. Read off the whole card — sections and comments alike — because a
 * renderer wired into three of four places is still a card with asterisks on it.
 *
 * Whole-card is also why the records this runs on keep their human words plain:
 * a quote is deliberately never parsed, so an asterisk inside one is the human's
 * asterisk rather than a defect. `r-silent-tailer` is where that case is proved,
 * and this step is not used on it.
 */
Then('no markdown syntax is visible on record {string}', async ({ page }, rid: string) => {
  const rendered = await card(page, rid).innerText()
  const syntax = ['**', '`'].filter((marker) => rendered.includes(marker))
  expect(syntax, `record ${rid} is showing markdown syntax rather than rendering it`).toEqual([])
})

Then(
  'the newest {string} comment of record {string} leads with the bold text {string}',
  async ({ page }, section: string, rid: string, text: string) => {
    const newest = threadOn(page, rid, section).getByTestId('thread-message-text').last()
    await expect(newest.getByTestId('prose-strong')).toHaveText(text)
  },
)

/** The newest message in a record's thread, which is what a reply step just wrote. */
function newestReply(page: Page, rid: string, section: string): Locator {
  return threadOn(page, rid, section).getByTestId('thread-message-text').last()
}

/**
 * The replayed half of a reply: a real quote, holding the bullets it was written
 * as (`r-reply-replay-convention`).
 *
 * Read as the quote's own bullet items rather than as its text, because the
 * failure this exists to catch is a quote that rendered its content as a
 * paragraph with dashes still in it — which contains every expected string and
 * would satisfy any `toContainText`. Exact and ordered, so a dropped or extra
 * bullet fails here.
 */
Then(
  'the newest {string} comment of record {string} quotes the bullets:',
  async ({ page }, section: string, rid: string, bullets: DataTable) => {
    const quote = newestReply(page, rid, section).getByTestId('prose-quote')
    await expect(quote).toHaveCount(1)
    await expect(quote.getByTestId('prose-bullet')).toHaveText(rows(bullets))
  },
)

/**
 * A reply's own bullets, exact and ordered — which is the only shape that can
 * fail on a wrapped one (`r-hard-wrap-breaks-prose`). A continuation line that
 * fell out of its bullet leaves the bullet holding half a sentence and puts the
 * other half in a paragraph underneath, and every `toContainText` over the
 * message still passes.
 */
Then(
  'the newest {string} comment of record {string} has the bullets:',
  async ({ page }, section: string, rid: string, bullets: DataTable) => {
    await expect(newestReply(page, rid, section).getByTestId('prose-bullet')).toHaveText(
      rows(bullets),
    )
  },
)

/**
 * And the other half: what the reply says *after* the quote is outside it. A
 * renderer that swallowed the rest of the message into the blockquote would pass
 * every assertion above.
 */
Then(
  'the newest {string} comment of record {string} answers outside the quote with {string}',
  async ({ page }, section: string, rid: string, text: string) => {
    const reply = newestReply(page, rid, section)
    await expect(reply.getByTestId('prose-quote').getByText(text)).toHaveCount(0)
    await expect(reply.getByTestId('prose-paragraph').filter({ hasText: text })).toHaveCount(1)
  },
)

/**
 * The subset check, asked of a reply rather than of a record section. A quote is
 * the newest construct in the grammar and the one a reader would most expect to
 * have been reached by handing a string to the DOM; this is the assertion that
 * says it was not.
 */
Then(
  'the newest {string} comment of record {string} is built only from the safe subset',
  async ({ page }, section: string, rid: string) => {
    const built = await newestReply(page, rid, section).evaluate((root) =>
      [...root.querySelectorAll('*')].map((element) => element.tagName.toLowerCase()),
    )
    expect(
      built.filter((tag) => !SAFE_SUBSET.includes(tag)),
      'the prose renderer built an element outside the safe subset',
    ).toEqual([])
  },
)

/**
 * The quote treatment, one channel at a time and in whichever theme the scenario
 * put the page in (`r-theme-blind-assertions`). The record names two properties
 * and both are asserted separately: a rule down the left, and ink that is not
 * the ink around it.
 *
 * The rule is read as a width *and* a colour, because a 2px border painted in
 * the page's own background is not a rule; and the ink is compared against the
 * text beside the quote rather than against a literal, since "muted" is a
 * different value in each theme and a hard-coded rgb would assert one theme away.
 */
Then(
  'the quote in the newest {string} comment of record {string} is ruled and muted',
  async ({ page }, section: string, rid: string) => {
    await page.addStyleTag({
      content:
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
    const look = await newestReply(page, rid, section)
      .getByTestId('prose-quote')
      .evaluate((quote) => {
        const style = getComputedStyle(quote)
        const around = quote.closest('[data-testid="thread-message-text"]')
        return {
          rule: Math.round(Number.parseFloat(style.borderLeftWidth)),
          ruleInk: style.borderLeftColor,
          ink: style.color,
          around: around === null ? 'no message' : getComputedStyle(around).color,
          behind: style.backgroundColor,
        }
      })
    expect(look.rule, 'the quote has no rule down its left').toBeGreaterThan(0)
    expect(
      look.ruleInk,
      `the quote's rule is painted in the surface behind it (${look.behind}), so there is no rule to see`,
    ).not.toBe(look.behind)
    expect(
      look.ink,
      `the quote's ink is the reply's own (${look.around}), so the quote reads as more of the answer`,
    ).not.toBe(look.around)
  },
)

/**
 * The owner's complaint about markdown syntax, asked of the comments rather than
 * of a record. It moved with them: the comments used to be inside the card, so
 * the whole-card sweep covered them, and a renderer wired into the sections and
 * not into the panel would now pass that sweep with asterisks on screen.
 */
Then('no markdown syntax is visible in the comments panel', async ({ page }) => {
  const rendered = await panel(page).innerText()
  const syntax = ['**', '`'].filter((marker) => rendered.includes(marker))
  expect(syntax, 'the comments panel is showing markdown syntax rather than rendering it').toEqual(
    [],
  )
})

Then(
  'the solution level of record {string} is {string}',
  async ({ page }, rid: string, value: string) => {
    await expect(card(page, rid).getByTestId(`solution-level-${value}`)).toBeChecked()
  },
)

/**
 * A record holding a level KC-0021 cut has nothing on the list to select, and
 * the list must not guess one for it. Asserting "no radio is checked" rather
 * than "some particular radio is not checked" is what catches a pre-selection
 * that landed on the wrong row.
 */
Then('no solution level is chosen on record {string}', async ({ page }, rid: string) => {
  const radios = card(page, rid).getByTestId('solution-level').getByRole('radio')
  await expect(radios).toHaveCount(5)
  for (const radio of await radios.all()) {
    await expect(radio).not.toBeChecked()
  }
})

/**
 * Severity's options, read off the open dropdown — the only place they exist,
 * since a closed Radix select renders nothing but the chosen one. An exact
 * ordered list, so a label that grew a sentence back fails here (retro 3 #17).
 */
Then(
  'the severity options of record {string} read:',
  async ({ page }, rid: string, options: DataTable) => {
    await card(page, rid).getByTestId('severity').click()
    await expect(page.getByTestId(/^severity-\d+$/)).toHaveText(rows(options))
    await page.keyboard.press('Escape')
  },
)

Then(
  'the solution level options of record {string} read:',
  async ({ page }, rid: string, options: DataTable) => {
    // `toHaveText` with an array is an exact, ordered, whole-list assertion, so
    // this also fails on a missing option, an extra one, or a reordering.
    await expect(card(page, rid).getByTestId('solution-level-option')).toHaveText(
      options.raw().map(([label]) => label ?? ''),
    )
  },
)

Then('the note on record {string} reads {string}', async ({ page }, rid: string, text: string) => {
  const note = card(page, rid).getByTestId('reviewer-note')
  const tag = await note.evaluate((element) => element.tagName)
  if (tag === 'TEXTAREA') {
    await expect(note).toHaveValue(text)
  } else {
    await expect(note).toHaveText(text)
  }
})

Then(
  'the {string} thread of record {string} shows {string}',
  async ({ page }, section: string, rid: string, text: string) => {
    await expect(
      threadOn(page, rid, section).getByTestId('thread-message-text').filter({ hasText: text }),
    ).toHaveCount(1)
  },
)

/* ── the comments panel (r-retro-level-comments, session 7) ───────────────── */

/**
 * What the panel is showing, anywhere in it — a record's thread or the review's,
 * since there is one column of them now. Steps that care *which* thread a
 * message is in address the thread itself.
 */
Then('the comments panel shows {string}', async ({ page }, text: string) => {
  await expect(
    panel(page).getByTestId('thread-message-text').filter({ hasText: text }),
  ).toHaveCount(1)
})

/**
 * Every thread of the retrospective, counted — and how many of them say which
 * record they are on.
 *
 * The owner's *"This enables human to see all comments in one place"* is a claim
 * about completeness, and a `toBeVisible` on the one thread somebody remembered
 * would not be evidence of it: the total fails on a panel that dropped the
 * record's comments and on one that grew a second copy of the review's. The
 * second number is the other half of the anchor rule, stated where it cannot be
 * circular — a record thread carries a line saying where it hangs, a review
 * thread does not, and counting both at once is what rules out a panel that put
 * an anchor on everything or on nothing.
 */
Then(
  'the comments panel holds {int} threads, {int} of them on a record',
  async ({ page }, total: number, anchored: number) => {
    await expect(panel(page).getByTestId('thread')).toHaveCount(total)
    await expect(panel(page).getByTestId(/^thread-anchor-/)).toHaveCount(anchored)
  },
)

/**
 * Where a record thread hangs, as the panel prints it: one line, in his order —
 * `#num · Section · title` (`r-thread-header-format`). The whole line is the
 * claim rather than its parts, because the order is what the record is about: a
 * number and a section and a title all present in some arrangement is exactly
 * what the header did before he reorganised it.
 */
Then(
  'the {string} thread of record {string} is anchored to {string}',
  async ({ page }, section: string, rid: string, header: string) => {
    const anchor = threadOn(page, rid, section).getByTestId(`thread-anchor-${rid}-${section}`)
    await expect(anchor.getByTestId('anchor-line')).toHaveText(header)
  },
)

/**
 * The header's line budget, measured off the element rather than eyeballed: the
 * lines it takes, and the lines the text it holds would need.
 *
 * Both come off the same leading, so "two lines" is a number the browser
 * produced and not one written down twice — and the pair is what makes the cut
 * checkable at all: a clamped box hides its overflow, so the only witness that
 * anything was cut is that the content wants more lines than the box gives it.
 */
function headerLines(
  page: Page,
  rid: string,
  section: string,
): Promise<{ readonly taken: number; readonly needed: number }> {
  return threadOn(page, rid, section)
    .getByTestId(`thread-anchor-${rid}-${section}`)
    .getByTestId('anchor-line')
    .evaluate((element) => {
      const leading = Number.parseFloat(getComputedStyle(element).lineHeight)
      return {
        taken: Math.round(element.clientHeight / leading),
        needed: Math.round(element.scrollHeight / leading),
      }
    })
}

Then(
  'the {string} thread header of record {string} runs {int} line(s)',
  async ({ page }, section: string, rid: string, lines: number) => {
    const { taken } = await headerLines(page, rid, section)
    expect(taken, `the header runs ${taken} lines rather than ${lines}`).toBe(lines)
  },
)

Then(
  'the {string} thread header of record {string} is cut off',
  async ({ page }, section: string, rid: string) => {
    const { taken, needed } = await headerLines(page, rid, section)
    expect(
      needed,
      `the header would take ${needed} lines and has ${taken}, so nothing was cut`,
    ).toBeGreaterThan(taken)
  },
)

Then(
  'the {string} thread header of record {string} keeps every character',
  async ({ page }, section: string, rid: string) => {
    const { taken, needed } = await headerLines(page, rid, section)
    expect(needed, `the header would take ${needed} lines and has only ${taken}`).toBe(taken)
  },
)

/**
 * Collapsed: the opening message and nothing under it (the owner: *"it should
 * only show top level comments, with reply count"*). Counted on
 * `thread-message`, so a reply rendered without its own count still fails.
 */
Then(
  'the {string} thread of record {string} shows one message and {string}',
  async ({ page }, section: string, rid: string, replies: string) => {
    const thread = threadOn(page, rid, section)
    await expect(thread.getByTestId('thread-message')).toHaveCount(1)
    await expect(thread.getByTestId('thread-replies')).toHaveText(replies)
    await expect(thread.getByTestId('thread-replies')).toHaveAttribute('aria-expanded', 'false')
    await expect(thread.getByTestId('thread-reply-list')).toHaveCount(0)
  },
)

/** Opened: the replies are in the document, one level in, and the state says so. */
Then(
  'the {string} thread of record {string} shows {int} messages, the replies nested',
  async ({ page }, section: string, rid: string, count: number) => {
    const thread = threadOn(page, rid, section)
    await expect(thread.getByTestId('thread-message')).toHaveCount(count)
    await expect(thread.getByTestId('thread-replies')).toHaveAttribute('aria-expanded', 'true')
    const nested = thread.getByTestId('thread-reply-list')
    await expect(nested).toHaveCount(1)
    await expect(nested.getByTestId('thread-message')).toHaveCount(count - 1)
  },
)

/**
 * A thread with nothing under it offers no count at all. Zero replies is not a
 * "0 replies" affordance: it is a comment nobody has answered, and a control
 * that opens onto nothing is chrome (KC-0014).
 */
Then('the review thread offers no reply count', async ({ page }) => {
  await expect(reviewThread(page).getByTestId('thread-message')).toHaveCount(1)
  await expect(reviewThread(page).getByTestId('thread-replies')).toHaveCount(0)
})

/**
 * The owner's second ask — *"comments should show the rev number they are
 * associated with"* — as an exact ordered list over the whole panel, so a page
 * that stamped every message with the same number fails here rather than
 * passing on the one that happened to be right.
 */
Then(
  'the comments say which revisions they were written against:',
  async ({ page }, revisions: DataTable) => {
    await expect(panel(page).getByTestId('thread-message-revision')).toHaveText(rows(revisions))
  },
)

/**
 * And the other half of the same ask — *"but the comments show accross all
 * revisions"*: the panel never filters by the revision on screen, so a thread
 * whose messages cross a revision boundary is one conversation, not two halves
 * on two pages.
 */
Then(
  'the {string} thread of record {string} carries revisions {string}',
  async ({ page }, section: string, rid: string, revisions: string) => {
    await expect(threadOn(page, rid, section).getByTestId('thread-message-revision')).toHaveText(
      listed(revisions),
    )
  },
)

/* ── settled threads (r-resolvable-comments) ──────────────────────────────── */

/**
 * Settled and out of the way: one line, the opener truncated behind a Resolved
 * mark, nothing else of the thread on screen — the owner's *"Resolved comments
 * should appear collapsed"*. The message count is the load-bearing half; a
 * thread that grew a mark and kept its whole conversation would satisfy a check
 * for the mark alone.
 */
Then(
  'the {string} thread of record {string} is settled and collapsed',
  async ({ page }, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await expect(thread.getByTestId('thread-settled-mark')).toHaveText('Resolved')
    await expect(thread.getByTestId('thread-settled')).toHaveAttribute('aria-expanded', 'false')
    await expect(thread.getByTestId('thread-message')).toHaveCount(0)
    await expect(thread.getByTestId('thread-settled-opener')).toBeVisible()
  },
)

Then(
  'the {string} thread of record {string} is open again',
  async ({ page }, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await expect(thread.getByTestId('thread-settled-mark')).toHaveCount(0)
    await expect(thread.getByTestId('thread-message')).toHaveCount(1)
    await expect(thread.getByTestId('thread-resolve')).toBeVisible()
  },
)

/**
 * A settled thread opened again: still settled, but readable — and the only
 * thing it offers is the way back, because reopening is another act rather than
 * an undo, and a thread the human said they were done with should not keep
 * growing while it says so.
 */
Then(
  'the {string} thread of record {string} is settled, readable, and offers only Reopen',
  async ({ page }, section: string, rid: string) => {
    const thread = threadOn(page, rid, section)
    await expect(thread.getByTestId('thread-settled')).toHaveAttribute('aria-expanded', 'true')
    await expect(thread.getByTestId('thread-message')).toHaveCount(1)
    await expect(thread.getByTestId('thread-reopen')).toBeVisible()
    await expect(thread.getByTestId('thread-resolve')).toHaveCount(0)
    await expect(thread.getByTestId('thread-reply')).toHaveCount(0)
  },
)

/**
 * The visible half: a settled thread must not render like the ones still open.
 *
 * Read off the rendered page rather than off a class name, and **channel by
 * channel** (testing.md §Operational rules, retro 5
 * `r-assertion-value-distinctiveness` / `r-theme-blind-assertions`): "differs
 * somehow" is not the claim. The treatment promises two things — the card fades
 * and its ink goes muted — and a joined-string comparison would pass on a state
 * where only one of them survived and could not say which. Each channel is also
 * asserted to agree across the threads still open, so a panel where every card
 * looked different could not pass by accident.
 *
 * Run in both themes by the scenario that uses it, driven through the app's own
 * toggle: the fade is theme-invariant and the ink is not, and a dark-mode
 * override that collapsed muted onto foreground is exactly the failure a
 * light-only scenario shipped once already.
 */
const SETTLED_CHANNELS = ['fade', 'ink'] as const

type ThreadLook = {
  readonly settled: boolean
  readonly channels: Record<(typeof SETTLED_CHANNELS)[number], string>
}

async function threadLooks(page: Page): Promise<ThreadLook[]> {
  // Transitions off before anything is measured: the claim is about the colour
  // the card comes to rest at, and an in-flight transition would let the answer
  // depend on when the step happened to look.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  return panel(page)
    .getByTestId('thread')
    .evaluateAll((cards) =>
      cards.map((card) => {
        const style = getComputedStyle(card)
        return {
          settled: card.querySelector('[data-testid="thread-settled"]') !== null,
          channels: { fade: style.opacity, ink: style.color },
        }
      }),
    )
}

Then('the settled thread reads as settled beside the ones still open', async ({ page }) => {
  const looks = await threadLooks(page)
  const settled = looks.filter((look) => look.settled)
  const open = looks.filter((look) => !look.settled)
  expect(settled, 'exactly one thread is settled').toHaveLength(1)
  expect(open.length, 'nothing to stand out from').toBeGreaterThan(0)

  const marked = settled[0]?.channels
  if (marked === undefined) return
  for (const channel of SETTLED_CHANNELS) {
    const rest = [...new Set(open.map((look) => look.channels[channel]))]
    expect(rest.length, `the open threads differ from each other in ${channel}`).toBe(1)
    expect(
      rest,
      `the settled thread's ${channel} is the open ones' (${marked[channel]})`,
    ).not.toContain(marked[channel])
  }
})

/* ── the composer's aim (the anchor chip) ─────────────────────────────────── */

/**
 * What the panel says the next comment will be filed under. Without this line
 * the composer is ambiguous in exactly the way the change is meant to remove:
 * the reviewer pressed Comment on a section, the panel is full of other threads,
 * and nothing on screen says the box has been aimed somewhere.
 */
Then('the composer is aimed at {string}', async ({ page }, header: string) => {
  const chip = panel(page).getByTestId('composer-anchor')
  await expect(chip.getByTestId('anchor-line')).toHaveText(header)
})

Then('the composer is aimed at the review', async ({ page }) => {
  await expect(composer(page)).toBeVisible()
  await expect(panel(page).getByTestId('composer-anchor')).toHaveCount(0)
})

/**
 * The keyboard follows the aim, so a section's Comment button is one press and
 * then typing — not a press, a hunt for the panel, and a click into the box.
 *
 * A controlled assertion (`r-uncontrolled-assertions`), and it has to be: a
 * browser moves focus on a click for free, and the click here is on the *card*,
 * three columns away from the box being claimed. Hand-run with the composer's
 * focus effect deleted; the failure output is in the lane report.
 */
Then('the keyboard is in the panel composer', async ({ page }) => {
  await expect.poll(() => focusedTestId(page)).toBe('open-thread-submit-text')
})

/**
 * One review-level surface and not two (retro 4 `r-remove-requests`). The panel
 * is asserted *present* first: on a page that rendered neither the absence half
 * would be true without observing anything at all.
 */
Then('the review shows a comment panel and no requests panel', async ({ page }) => {
  await expect(panel(page)).toBeVisible()
  await expect(page.getByTestId('requests-panel')).toHaveCount(0)
})

/**
 * The absence, counted rather than named.
 *
 * Checking for the one testid the removed panel used would only rule out the
 * panel somebody thought of; this reads every hook the page actually rendered
 * and fails on any of them that is request-shaped, whatever it ends up called.
 *
 * It had one exemption — `request-changes`, the review's own second button —
 * and retro 4 `r-one-finish-button` removed that button, so the rule is now
 * exactly what it says with nothing carved out of it.
 */
Then('the review offers nothing that asks for something outside a comment', async ({ page }) => {
  const rendered = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid]')].map(
      (element) => element.getAttribute('data-testid') ?? '',
    ),
  )
  const surviving = rendered.filter((testid) => testid.startsWith('request'))
  expect(surviving, 'the review page is still rendering a requests surface').toEqual([])
})

/**
 * Neither panel is on the page at all — not an empty one, not a heading over
 * nothing. `toHaveCount(0)` rather than `toBeHidden()`, because a section that
 * is merely invisible is still a section a reader's browser and a screen reader
 * have to deal with; the claim is that it was never rendered.
 */
Then('the review shows no comment panel and no requests panel', async ({ page }) => {
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByTestId('requests-panel')).toHaveCount(0)
})

/**
 * The other half of the same rule, and the one that stops it being over-applied:
 * what a review *does* carry stays readable once it is finished. A thread is
 * history (D4), so a finished review that was commented on still shows it,
 * read-only, rather than hiding it along with the controls.
 */
Then('the review still shows the comments it already had', async ({ page }) => {
  // Both of the fixture's threads: the record's and the review's. The panel is
  // the one comments surface since session 7, so "what it already had" is every
  // thread of the retrospective rather than the review's own.
  await expect(panel(page).getByTestId('thread')).toHaveCount(2)
})

/**
 * A finished review — or an older revision pinned — offers nothing to write
 * with, anywhere on the comments surface. Every control the panel has is named,
 * including the ones this lane added: settling a thread is a write like any
 * other and the server refuses it on a finished retrospective, so a Resolve
 * button here would be a control whose only outcome is an error.
 */
Then('the review takes no more comments', async ({ page }) => {
  // The surface is asserted present first, because everything below this is an
  // absence: on a page that never had one every count would be zero and this
  // step would pass without observing anything at all.
  await expect(panel(page)).toBeVisible()

  // `open-thread` is the record cards' entry point into this panel; it has no
  // business inside the panel at all, and on a read-only review it has none on
  // the cards either — which the step below checks from that side.
  for (const control of [
    'open-thread',
    'open-thread-submit',
    'open-thread-submit-text',
    'composer-anchor',
    'thread-reply',
    'thread-reply-submit',
    'thread-resolve',
    'thread-reopen',
  ]) {
    await expect(panel(page).getByTestId(control)).toHaveCount(0)
  }
})

/**
 * The same absence from the record's side: with the threads gone from the body,
 * the Comment button is the only thing a card still says about comments, and a
 * read-only review must not offer it either.
 *
 * Counted over every card on the page rather than checked on the one somebody
 * remembers, and asserted against a page that *has* cards, so a filtered-empty
 * list cannot pass this by having nothing to look at.
 */
Then('no record offers a way to comment', async ({ page }) => {
  await expect(page.getByTestId(/^record-r-/)).not.toHaveCount(0)
  await expect(page.getByTestId('open-thread')).toHaveCount(0)
})

/**
 * The threads are out of the reading column, and this is the sweep that says so
 * — **counted, not named**. Session 6's lesson was that checking one testid
 * proves nothing about a surface that came back under a different one, so this
 * reads every hook the record bodies actually rendered and fails on any of them
 * that is thread-shaped, whatever it ends up called. (`open-thread` is not: it
 * is the way *into* the panel, and it stays.)
 *
 * The panel is asserted to hold threads in the same breath, because "no threads
 * in the records" is trivially true of a page with no threads at all — which is
 * the state this rule would be quietly satisfied by if the comments had simply
 * stopped rendering anywhere.
 */
Then('no record body holds a comment thread', async ({ page }) => {
  await expect(panel(page).getByTestId('thread')).not.toHaveCount(0)

  const inside = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="record-r-"]')].flatMap((record) =>
      [...record.querySelectorAll('[data-testid]')].map(
        (element) => element.getAttribute('data-testid') ?? '',
      ),
    ),
  )
  expect(inside.length, 'no record card rendered anything at all').toBeGreaterThan(0)

  const surviving = [...new Set(inside.filter((testid) => /^threads?(-|$)/.test(testid)))]
  expect(surviving, 'a record body is still rendering comment threads').toEqual([])
})

/**
 * A finished review — or an older revision pinned — offers no way to decide and
 * no way to comment on a record.
 *
 * There used to be exactly one exception here, the hold control, and it was
 * asserted *present* on this very step. Retro 4 `r-remove-hold` removed the
 * feature, so the card is shut without qualification and the line that named the
 * exception is gone with it.
 */
Then('record {string} offers no decision buttons', async ({ page }, rid: string) => {
  const record = card(page, rid)
  for (const verdict of ['approved', 'declined']) {
    await expect(record.getByTestId(verdict)).toHaveCount(0)
  }
  // The card's one comment control. `thread-reply` used to be checked here too
  // and stopped being able to fail when the threads left the body — a card
  // renders none of them now on any review, read-only or not, so the assertion
  // was true whatever the page did. It lives on the panel's own sweep instead.
  await expect(record.getByTestId('open-thread')).toHaveCount(0)
})

/**
 * The owner's standing rule: the explanatory half of a label is never dropped for
 * brevity. A text assertion cannot see that, because clipped words are still in
 * the DOM — so this asks the browser what it actually painted. An element that
 * clips its own overflow while holding more than it shows is a label somebody
 * shortened.
 */
const CLIPPED_TEXT = (root: Element) =>
  [root, ...root.querySelectorAll('*')]
    .filter((element) => {
      // Only elements that clip can hide anything; the rest just overflow
      // visibly, which is ugly but is not a dropped explanation.
      const style = getComputedStyle(element)
      if (style.overflow === 'visible' && style.webkitLineClamp === 'none') return false
      return (
        element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1
      )
    })
    .map((element) => (element.textContent ?? '').trim().slice(0, 60))

Then('no label on record {string} is cut off', async ({ page }, rid: string) => {
  for (const control of ['severity', 'solution-level', 'involvement']) {
    const hidden = await card(page, rid).getByTestId(control).evaluate(CLIPPED_TEXT)
    expect(hidden, `${control} is showing less of its label than the label says`).toEqual([])
  }
})

/**
 * The same rule, in the place the level label moved to on a record that
 * proposes solutions: the canonical "what — why" string is printed under each
 * solution, and the explanatory half is no more droppable there than it was in
 * the radio list.
 *
 * Every tab is opened to check it, because only the open one is in the document
 * — a version of this that read whatever happened to be mounted would be a check
 * on one of three labels calling itself a check on all of them.
 */
Then('no solution level label on record {string} is cut off', async ({ page }, rid: string) => {
  const tabs = await solutionTabs(page, rid).count()
  expect(tabs, 'the record shows no solution tabs at all').toBeGreaterThan(0)
  for (let position = 1; position <= tabs; position += 1) {
    await solutionTab(page, rid, position).click()
    const label = card(page, rid).getByTestId(`solution-${position}-level`)
    await expect(label).toBeVisible()
    const hidden = await label.evaluate(CLIPPED_TEXT)
    expect(hidden, `solution ${position}'s level is showing less than its label says`).toEqual([])
  }
})

Then('record {string} shows the marker {string}', async ({ page }, rid: string, text: string) => {
  await expect(card(page, rid).getByTestId('carried-over')).toHaveText(text)
})

/* ── the filter ───────────────────────────────────────────────────────────── */

Then('no filter chip is active', async ({ page }) => {
  const chips = page.getByTestId('record-filter').getByRole('button')
  // Asserted non-empty first: "none of them is pressed" is vacuously true of a
  // bar with no chips on it, and which chips are there is its own step below.
  expect(await chips.count()).toBeGreaterThan(0)
  for (const chip of await chips.all()) {
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
  }
})

/**
 * Which chips the bar offers, as an exact ordered list.
 *
 * `hold` is on it only where a store carries that verdict (retro 4
 * `r-remove-hold`), so this is the step that holds both halves of the rule: it
 * fails on a `hold` chip that came back to a clean store, and on a missing one
 * where a hold verdict exists. Read off the testids rather than the labels,
 * because the testid is what the rest of these steps address a chip by.
 */
Then('the filter offers the chips {string}', async ({ page }, states: string) => {
  const offered = await page
    .getByTestId('record-filter')
    .evaluate((bar) =>
      [...bar.querySelectorAll('[data-testid^="filter-"]')]
        .map((element) => element.getAttribute('data-testid') ?? '')
        .filter((testid) => !testid.endsWith('-count')),
    )
  expect(offered).toEqual(listed(states).map((state) => `filter-${state}`))
})

Then('the filter counts read:', async ({ page }, counts: DataTable) => {
  for (const [state, count] of counts.raw()) {
    await expect(page.getByTestId(`filter-${state}-count`)).toHaveText(count ?? '')
  }
})

/* ── the extra filters (r-additional-filters) ─────────────────────────────── */

When('the reviewer opens the extra filters', async ({ page }) => {
  await page.getByTestId('filter-more').click()
})

When('the reviewer filters to requester {string}', async ({ page }, party: string) => {
  await page.getByTestId(`filter-requester-${party}`).click()
})

When('the reviewer filters to type {string}', async ({ page }, type: string) => {
  await page.getByTestId(`filter-type-${type}`).click()
})

When('the reviewer clears the applied filters', async ({ page }) => {
  await page.getByTestId('filter-applied-clear').click()
})

/**
 * Every slice the popover offers, with the count beside it — polled as one set
 * rather than asserted row by row, the idiom the tab strip settled on: a panel
 * showing an extra row, or one row fewer, is the interesting failure and a
 * per-row assertion passes straight through both.
 */
Then('the extra filters read:', async ({ page }, rows: DataTable) => {
  const expected = rows.raw().map(([kind, value, count]) => `${kind}:${value}=${count}`)

  await expect
    .poll(
      () =>
        page
          .getByTestId('filter-more-panel')
          .getByTestId(/^filter-(requester|type)-[a-z]+$/)
          .evaluateAll((slices) =>
            slices.map((slice) => {
              const testid = slice.getAttribute('data-testid') ?? ''
              const [, kind, value] = testid.split('-')
              const count = slice.querySelector('[data-testid$="-count"]')?.textContent ?? ''
              return `${kind}:${value}=${count}`
            }),
          ),
      { message: 'the extra filters offer a different set of slices' },
    )
    .toEqual(expected)
})

/**
 * The indication the owner asked for, and it is two things rather than one:
 * *"we will have to show some indication that extra filters are applied."* The
 * badge is readable without opening the popover; the chip says *which*, so "why
 * is the list short" has an answer on the bar itself.
 */
Then(
  'the extra filters are applied, and the chip beside the icon reads {string}',
  async ({ page }, reads: string) => {
    await expect(page.getByTestId('filter-more-badge')).toBeVisible()
    await expect(page.getByTestId('filter-applied')).toHaveText(new RegExp(escapeRegExp(reads)))
    await expect(page.getByTestId('filter-applied-clear')).toBeVisible()
  },
)

/**
 * The applied state, read off the painted page rather than off a class name.
 *
 * Two claims, kept apart on purpose. The **icon** changes on two channels at
 * once — fill and ink — because a single-channel change is what
 * `r-recommended-preselected` was filed about, and an assertion that took any
 * one difference would accept exactly that. The **badge** is a dot, so what has
 * to be true of it is that it is painted in something the bar behind it is not:
 * a dot in the bar's own colour is not a dot.
 *
 * Both readings are taken with transitions off, so the answer is the colour the
 * control comes to rest at rather than one it passed through.
 */
Then('the extra-filter icon reads as applied, on every channel it promises', async ({ page }) => {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })

  const look = await page.getByTestId('filter-more').evaluate((icon) => {
    const style = getComputedStyle(icon)
    const badge = icon.querySelector('[data-testid="filter-more-badge"]')
    const bar = icon.closest('[data-testid="review-bar"]')
    return {
      fill: style.backgroundColor,
      ink: style.color,
      badge: badge === null ? null : getComputedStyle(badge).backgroundColor,
      bar: bar === null ? null : getComputedStyle(bar).backgroundColor,
    }
  })

  // The same reading with nothing applied, for the comparison to mean anything.
  await page.getByTestId('filter-applied-clear').click()
  await expect(page.getByTestId('filter-more-badge')).toHaveCount(0)
  const plain = await page.getByTestId('filter-more').evaluate((icon) => {
    const style = getComputedStyle(icon)
    return { fill: style.backgroundColor, ink: style.color }
  })

  expect(look.fill, 'the applied icon is filled the same as the unapplied one').not.toBe(plain.fill)
  expect(look.ink, 'the applied icon is inked the same as the unapplied one').not.toBe(plain.ink)
  expect(look.badge, 'the badge was never painted').not.toBeNull()
  expect(alphaOf(look.badge ?? ''), 'the badge is transparent, so there is no dot to see').toBe(1)
  expect(
    look.badge,
    'the badge is painted in the bar’s own colour, so there is no dot to see',
  ).not.toBe(look.bar)
})

/* ── the emptied filter (r-empty-filter-message) ──────────────────────────── */

/**
 * The message the owner asked for, in the place the records were.
 *
 * Both halves are asserted, because each is a different promise: the sentence
 * says the emptiness is the filter's doing rather than a fault, and the count
 * says how much is behind it — *"with the counts real, so done-ness reads as
 * done-ness"*. The count is of records that are **decided** and hidden, which is
 * what the sentence claims, so a page that counted every hidden record under
 * that word would be saying something untrue.
 */
Then(
  'the emptied filter says so, and counts {int} decided records hidden',
  async ({ page }, hidden: number) => {
    const message = page.getByTestId('filter-empty')
    await expect(message).toBeVisible()
    await expect(message).toContainText('No records match the selected filters')
    await expect(message.getByTestId('filter-empty-hidden')).toHaveText(String(hidden))
  },
)

/**
 * The same emptiness with nothing decided behind it. The count clause is left
 * off rather than printed as a zero: "0 decided records are hidden" is true and
 * reads like the bug this record exists to stop looking like.
 */
Then('the emptied filter says so, and counts no decided records hidden', async ({ page }) => {
  const message = page.getByTestId('filter-empty')
  await expect(message).toBeVisible()
  await expect(message).toContainText('No records match the selected filters')
  await expect(message.getByTestId('filter-empty-hidden')).toHaveCount(0)
})

Then('the emptied-filter message is nowhere on the page', async ({ page }) => {
  await expect(page.getByTestId('filter-empty')).toHaveCount(0)
})

/**
 * A renderer that has almost stopped painting, made that way by the page holding
 * its own main thread (retro 7 `r-landing-clamp-race`).
 *
 * The starvation is produced here rather than borrowed from the machine, which
 * is what makes the window deterministic: the same period on a busy laptop and
 * on an idle one. All but the last few milliseconds of each period are spent
 * blocking, so a period cannot fit two frames — and the page's own timers, the
 * mock's answers and React's commits are starved along with the paint, which is
 * the state a loaded machine puts the real page in.
 *
 * It stops on its own rather than being switched off, so a scenario that ends
 * early leaves nothing running behind it.
 */
When(
  'the renderer paints once every {int} seconds for {int} seconds',
  async ({ page }, period: number, seconds: number) => {
    await page.evaluate(
      ({ period, seconds }) => {
        // Under one frame's worth of room, so the period cannot fit two.
        const idle = 12
        const busy = period * 1000 - idle
        const until = performance.now() + seconds * 1000
        const hold = () => {
          if (performance.now() >= until) return
          const stop = performance.now() + busy
          while (performance.now() < stop) {
            // Holding the main thread is the whole point of this loop.
          }
          setTimeout(hold, idle)
        }
        setTimeout(hold, 0)
      },
      { period, seconds },
    )
  },
)

/* ── the departure collapse, instrumented (r-collapse-never-animates) ─────── */

type TracedWindow = Window & { __collapseTrace?: number[] }

/**
 * Sample the departing slot's height on every painted frame, starting before the
 * verdict that sends it away.
 *
 * This is the instrument the record was found with, kept rather than described:
 * *"the departing row's `grid-template-rows` steps from full height to zero
 * between two consecutive frames; only the opacity fades."* No test can see
 * smoothness by asserting on a final state — the row ends at zero height either
 * way, and the opacity fade runs correctly over the same window, which is
 * exactly what made a jump read as "something animated" for four sessions.
 *
 * So the claim is about the frames in between, and the only way to have them is
 * to be recording while they happen. The loop stops when the slot leaves the
 * document, so nothing is left running behind a scenario.
 */
When('the collapse of record {string} is traced', async ({ page }, rid: string) => {
  await page.evaluate((rid) => {
    const find = () => document.querySelector(`[data-testid="slot-${rid}"]`)
    if (find() === null) throw new Error(`no slot for ${rid} to trace`)
    const trace: number[] = []
    ;(window as TracedWindow).__collapseTrace = trace
    /**
     * The slot is looked up **every frame** rather than held from the arming
     * step, and that is not defensiveness — it is the second half of what the
     * record was about. The departing row's element is destroyed and rebuilt as
     * it leaves: the verdict lands, the record stops matching the filter before
     * anything has marked it as departing, and the slot unmounts and mounts
     * again as a different node. A tracer holding the first one measures a
     * detached element, reads 0 from the moment the departure starts, and
     * reports a jump no matter what the live row is doing — which is exactly
     * what it did while this was being written.
     */
    const sample = () => {
      const slot = find()
      if (slot === null) {
        trace.push(0)
        return
      }
      trace.push(slot.getBoundingClientRect().height)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, rid)
})

/**
 * What the trace has to show: the row was at its full height, it reached zero,
 * and it was somewhere in between on at least one painted frame.
 *
 * The middle band is deliberately generous — anywhere from a tenth to nine
 * tenths of the row. A collapse that interpolates spends a dozen frames in
 * there; the jump the record convicts spends none, because the two consecutive
 * samples either side of it are the full height and zero. Nothing about the
 * easing curve, the duration or the frame count is being asserted, only that the
 * height was ever a value the code never wrote.
 *
 * A controlled assertion in the strongest sense (`r-uncontrolled-assertions`):
 * the browser produces every number here, and this is red on the `fr` transition
 * that shipped. The plant log carries the run.
 */
Then('record {string} collapsed through the heights between', async ({ page }, rid: string) => {
  await expect(card(page, rid)).toHaveCount(0)
  const trace = await page.evaluate(() => (window as TracedWindow).__collapseTrace ?? [])

  const tallest = Math.max(...trace, 0)
  expect(tallest, `nothing was traced for ${rid} — the slot never had a height`).toBeGreaterThan(
    100,
  )
  expect(Math.min(...trace), `${rid} never finished collapsing`).toBe(0)

  const between = trace.filter((height) => height > tallest * 0.1 && height < tallest * 0.9)
  expect(
    between.length,
    `${rid} stepped ${Math.round(tallest)}px → 0 with nothing in between: ${trace
      .map((height) => Math.round(height))
      .join(', ')}`,
  ).toBeGreaterThan(0)
})

Then('no extra filter is applied', async ({ page }) => {
  await expect(page.getByTestId('filter-more-badge')).toHaveCount(0)
  await expect(page.getByTestId('filter-applied')).toHaveCount(0)
})

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

Then('record {string} is not listed', async ({ page }, rid: string) => {
  await expect(card(page, rid)).toHaveCount(0)
})

Then('no records are listed', async ({ page }) => {
  await expect(page.getByTestId(/^record-r-/)).toHaveCount(0)
})

const LANDED = 'landed at the top of the reading area'

/**
 * How many consecutive **painted frames** the scroll position has to be
 * unchanged in before the page counts as having come to rest.
 *
 * Frames rather than milliseconds, and that is the whole fix
 * (`r-flaky-landing-test`, retro 6). A smooth scroll advances once per frame, so
 * two identical frames already mean it is over; three is what the frame the
 * click landed in costs, before the browser has scheduled the first step of the
 * animation. Counting frames is also what tells a *finished* scroll apart from a
 * *starved* one: a renderer that has stopped painting produces no samples at
 * all, so this waits instead of concluding the page is still — which is exactly
 * what a wall-clock wait gets wrong under a loaded machine.
 */
const REST_FRAMES = 3

/**
 * The ceiling, in painted frames — ten seconds of a healthy 60Hz renderer, and
 * proportionally longer on a starved one, which is the point. Nothing here
 * decides anything: a scroll still moving after this hands the verdict back to
 * the assertion, which fails carrying its own measurement rather than timing out
 * with none.
 */
const REST_BUDGET_FRAMES = 600

/**
 * Wait until the page has stopped scrolling.
 *
 * The measured account (`r-flaky-landing-test`, retro 6; the traces are in the
 * lane report). The landing itself was never wrong: on every one of 25 traced
 * runs under contention the record came to rest at 112px, exactly where it
 * belongs, and the document height never moved. What varied was *when* — a
 * healthy run settles about 900ms after the click and a starved one had not
 * begun scrolling until 1.7s and settled at 2.7s. The assertion was polling a
 * moving target against a five-second wall clock, so roughly one run in seven
 * read the animation mid-flight and ran out of budget before it landed.
 *
 * So the reading is taken off a scroll that has stopped, and "stopped" is
 * counted in frames the browser actually painted. Under load this waits longer
 * instead of failing, which is the difference between a deterministic wait and a
 * timeout.
 *
 * The control, kept here because a wait nobody can re-run is a wait nobody can
 * trust. Twelve workers on a ten-core machine is enough contention to show it:
 * the scenario failed 1 in 50 with the wait removed and 0 in 50 with it, and
 * then 30 in 30 at the suite's own worker count.
 *
 *   cd apps/web && bun run test --grep 'one click to that record' \
 *     --repeat-each=50 --workers=12
 *
 * **The scroll saying so itself comes first** (retro 7 `r-landing-clamp-race`,
 * re-scoped by its own trace). Counting frames is a sound way to notice a scroll
 * is over, but it is not a free one: it cannot know until `REST_FRAMES` more
 * frames have been *painted*, and on a renderer that has almost stopped painting
 * those frames are seconds apart. Measured on a page painting once every six
 * seconds: the landing arrived at 6.3s, correct to the pixel, and this wait did
 * not admit it until 24.4s — against an assertion budget of fifteen. Every
 * sample taken in between read the same mid-flight position, which is precisely
 * the "stable offset for the full fifteen seconds" that was filed as an app race
 * and turned out to be this.
 *
 * So the first question is the page's own scroll state (`fixtures.ts`, watched
 * from before load — a listener attached when the wait begins arrives after the
 * event on a page this starved, which is measured there). A page not scrolling
 * is at rest now, and the reading is taken now. A page mid-scroll waits for the
 * `scrollend` that is still coming.
 *
 * The frame count stays underneath both, unchanged, as the fallback it always
 * was: a browser that never fires `scrollend` still finishes, and a reading has
 * to be takeable off it.
 */
async function scrollAtRest(page: Page): Promise<void> {
  await page.evaluate(
    ({ frames, budget }) =>
      new Promise<void>((resolve) => {
        const watched = (window as Window & { retroScroll?: { scrolling: boolean } }).retroScroll
        // Nothing is moving, so nothing is owed: the page is at rest already.
        if (watched !== undefined && !watched.scrolling) {
          resolve()
          return
        }

        let last = Number.NaN
        let still = 0
        let painted = 0
        let settled = false

        const settle = () => {
          if (settled) return
          settled = true
          window.removeEventListener('scrollend', settle)
          resolve()
        }

        window.addEventListener('scrollend', settle)

        const sample = () => {
          if (settled) return
          painted += 1
          still = window.scrollY === last ? still + 1 : 0
          last = window.scrollY
          if (still >= frames || painted >= budget) {
            settle()
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }),
    { frames: REST_FRAMES, budget: REST_BUDGET_FRAMES },
  )
}

/**
 * The budget the landing assertion gets, and it is a budget for a *slow* page
 * rather than a wrong one: every sample below is taken off a scroll that has
 * already stopped, so a landing in the wrong place is wrong on the first sample
 * and the rest of this is only spent on a page that has not finished moving.
 * The default five seconds is what a starved renderer overran.
 */
const LANDING_MS = 15_000

/**
 * Where the page put the reviewer down once a record had finished leaving
 * (ledger v2 #95).
 *
 * The bar has to be this specific. Taking a record out of the list moves
 * everything under it upwards on its own, so "the successor is somewhere on
 * screen" is true whether the page landed on it or merely stayed where it was —
 * an assertion that cannot tell those apart is not evidence of anything.
 *
 * Landing is the record's top edge at the top of the reading area, and the
 * reading area starts where the page's sticky chrome ends: the header, and since
 * session 7 the decision bar stuck under it. That edge is measured rather than
 * written down, because it is the same number `scroll-mt-28` spells in
 * `record-filter.tsx` and two copies of it would drift — and it is the *lower*
 * bound, so a landing that leaves the record tucked behind the bar fails here
 * rather than reading as arrival. The miss is reported in pixels, with the
 * chrome's own edge beside it, so a failure says how far off it was and from
 * what.
 *
 * Every reading is taken off a page that has stopped scrolling (`scrollAtRest`),
 * which is what makes this deterministic rather than a race the machine's load
 * decides (`r-flaky-landing-test`). The poll stays around it, because the
 * landing has not necessarily *started* when this step runs: a record takes
 * `DEPARTURE_MS` to leave before the page moves at all, and a page at rest at
 * the wrong position is a sample this has to be able to take and reject.
 */
Then('the viewport lands on record {string}', async ({ page }, rid: string) => {
  await expect
    .poll(
      async () => {
        await scrollAtRest(page)
        return card(page, rid).evaluate((element, landed) => {
          const bar = document.querySelector('[data-testid="review-bar"]')
          const chrome = bar === null ? 56 : Math.round(bar.getBoundingClientRect().bottom)
          const top = Math.round(element.getBoundingClientRect().top)
          return top >= chrome - 4 && top <= chrome + 56
            ? landed
            : `${top}px from the top, with the page's own chrome ending at ${chrome}px`
        }, LANDED)
      },
      { timeout: LANDING_MS },
    )
    .toBe(LANDED)
})

/**
 * What the browser would type into, by the testid of the element holding focus —
 * or the name of whatever has it instead, so a failure says where the keyboard
 * actually went rather than only that it was not here.
 */
function focusedTestId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (active === null || active === document.body) return 'the page body'
    return active.getAttribute('data-testid') ?? `an untagged <${active.tagName.toLowerCase()}>`
  })
}

/**
 * The keyboard's half of the landing (`r-departure-keyboard-focus`). The record
 * that was decided has left the document, so focus is on the slot the page
 * landed on — which is what makes the next verdict one tab away instead of a
 * walk from the top of the page.
 */
Then('the keyboard is on record {string}', async ({ page }, rid: string) => {
  await expect.poll(() => focusedTestId(page)).toBe(`slot-${rid}`)
})

/**
 * Where the reviewer was put down when the filter emptied — asked of the
 * keyboard, and **only** of the keyboard (retro 3 `r-uncontrolled-assertions`).
 *
 * It used to also say `toBeInViewport` on the review actions, which could not
 * fail even then: every record has been filtered off the page, so what is left
 * is short enough that the actions are on screen whether the page landed on
 * them, scrolled somewhere else, or never moved. Since session 7 they are in the
 * sticky bar and are on screen at every scroll position of every review, so that
 * half is not merely weak, it is a fact about the layout with nothing to do with
 * the landing. It is gone.
 *
 * Focus is what is left, and it is the whole claim: nothing on this page moves
 * the keyboard to the bar except this landing.
 */
Then('the page lands on the review actions', async ({ page }) => {
  await expect.poll(() => focusedTestId(page)).toBe('review-actions')
})

/**
 * `the page shows N of M pending` used to live here, reading a line inside the
 * review's own box. The box is gone (session 7, the owner: *"I want the box at
 * the bottom that says like 'X of Y pending - Review finished ...', I want it
 * removed"*) and the pending chip is the one place the number is written now, so
 * every scenario that asked for it asks the chip instead — `the filter counts
 * read:`, which was already the step for that.
 */

Then('the review is refused over {string}', async ({ page }, rids: string) => {
  const expected = listed(rids)
  const refusal = page.getByTestId('finish-refusal')
  await expect(refusal).toBeVisible()
  for (const rid of expected) {
    await expect(refusal.getByTestId(`finish-refusal-${rid}`)).toBeVisible()
  }
  // And no others: naming a decided record would be worse than naming none.
  await expect(refusal.getByTestId(/^finish-refusal-r-/)).toHaveCount(expected.length)
})

/**
 * What one line of the refusal actually says — the number and the title, so the
 * reviewer can find the record it is complaining about. The step above proves
 * the right *records* are named; this proves they are named the way the page
 * names them everywhere else.
 */
Then(
  'the refusal names record {string} as {string}',
  async ({ page }, rid: string, line: string) => {
    await expect(page.getByTestId(`finish-refusal-${rid}`)).toHaveText(line)
  },
)

Then('the review is finished', async ({ page }) => {
  await expect(page.getByTestId('review-finished')).toBeVisible()
})

/* ── the decision bar ─────────────────────────────────────────────────────── */

/** The app header's own height (`h-14`), which is where the bar comes to rest. */
const HEADER = 56

/**
 * The owner's first ask of session 7: *"When I scroll the filter (pending,
 * approved and declined etc) they scroll away; I want them to stick to the
 * top."*
 *
 * A controlled assertion (testing.md §Operational rules,
 * `r-uncontrolled-assertions`) and it has to be: a bar near the top of a page is
 * near the top of the page for free until something scrolls, so this asserts the
 * page really moved *first* and then asks where the bar is. Hand-run with the
 * `sticky top-14` deleted; the failure output is in the lane report.
 */
Then('the decision bar is stuck under the header', async ({ page }) => {
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(
    scrolled,
    'the page never scrolled, so nothing had a chance to scroll away',
  ).toBeGreaterThan(200)

  const where = await page.getByTestId('review-bar').evaluate((bar, header) => {
    const top = Math.round(bar.getBoundingClientRect().top)
    return Math.abs(top - header) <= 1
      ? 'against the header'
      : `${top}px from the top of the viewport`
  }, HEADER)
  expect(where, 'the decision bar scrolled away with the records').toBe('against the header')
})

/**
 * The alpha of a computed colour, whichever notation the browser serialised it
 * in: `oklch(l c h / a)` for this app's own tokens, `rgba(…)` for anything that
 * came from a keyword, and the bare keyword itself for `transparent`.
 */
function alphaOf(colour: string): number {
  const slash = colour.lastIndexOf('/')
  if (slash !== -1) return Number.parseFloat(colour.slice(slash + 1))
  const channels = colour.match(/^rgba?\(([^)]*)\)$/)
  if (channels !== null) {
    const parts = (channels[1] ?? '').split(',')
    return parts.length < 4 ? 1 : Number.parseFloat(parts[3] ?? '1')
  }
  return colour === 'transparent' ? 0 : 1
}

/**
 * The bar covers records as they pass under it, so it has to be paint rather
 * than the header's own translucency: a record you can half read through the
 * chips is worse than one you cannot read at all. Asserted in both themes,
 * because the token it is painted with is a different colour in each
 * (`r-theme-blind-assertions`).
 */
Then('the decision bar is painted, not see-through', async ({ page }) => {
  const colour = await page
    .getByTestId('review-bar')
    .evaluate((bar) => getComputedStyle(bar).backgroundColor)
  expect(alphaOf(colour), `the bar's background is ${colour}, so the records pass through it`).toBe(
    1,
  )
})

/**
 * What is on the bar, counted as its own children rather than checked one
 * element at a time. The owner asked for two things on it — the filters and the
 * one act — and the box this replaced had grown a third that had to be asked for
 * again to get rid of: *"the box at the bottom that says like 'X of Y pending -
 * Review finished ...', I want it removed"*.
 *
 * It is three since `r-additional-filters`, and the third was asked for by name:
 * *"we can add a icon with filter … so when you click it show a pop-up and there
 * you can select the additional filters"*. It is named here rather than the list
 * being loosened, so the next thing to appear on this bar still has to be argued
 * for — which is the whole job of this assertion.
 *
 * The icon is its own child rather than living inside `record-filter`, and that
 * is a test-shape decision as much as a layout one: the chip steps read *every*
 * button and *every* `filter-*` testid inside that group, so an icon in there
 * would fail both of them with noise rather than signal.
 */
Then('the decision bar holds the filters and one action, and nothing else', async ({ page }) => {
  const held = await page
    .getByTestId('review-bar')
    .evaluate((bar) =>
      [...bar.children].map(
        (child) =>
          child.getAttribute('data-testid') ?? `an untagged <${child.tagName.toLowerCase()}>`,
      ),
    )
  expect(held).toEqual(['record-filter', 'filter-extra', 'review-actions'])
})

/**
 * The finished state, in his own words: *"Once a review is finished the botton
 * should be replace with an icon and text that indicates that the retro has been
 * submitted."*
 *
 * Two channels, read separately (`r-theme-blind-assertions`): the **shape** it
 * carries and the **word** it says. Either one alone would be a mark that only
 * works for some readers — a colour and an icon with no word, or a word a
 * theme's ink could bleach out — and a single joined assertion would pass with
 * one of them missing.
 */
Then('the submitted mark carries a shape and a word', async ({ page }) => {
  const mark = await page.getByTestId('review-finished').evaluate((element) => ({
    shape: element.querySelector('svg') === null ? 'no icon' : 'an icon',
    word: (element.textContent ?? '').trim(),
  }))
  expect(mark.shape, 'the submitted mark has no icon, so it is a word alone').toBe('an icon')
  expect(mark.word, 'the submitted mark does not say the retro was submitted').toBe(
    'Retro submitted',
  )
})

Then('finishing is no longer on the bar', async ({ page }) => {
  await expect(page.getByTestId('finish-review')).toHaveCount(0)
})

Then('the review is no longer refused', async ({ page }) => {
  await expect(page.getByTestId('finish-refusal')).toHaveCount(0)
})

/**
 * The keyboard, after the refusal was dismissed. Radix hands focus back to a
 * *trigger* and this popover is anchored rather than triggered, so the way back
 * is the component's own (`review-actions.tsx`) and this is what checks it.
 *
 * A controlled assertion (`r-uncontrolled-assertions`), hand-run with that
 * `onCloseAutoFocus` deleted; the failure output is in the lane report.
 */
Then('the keyboard is on the finish button', async ({ page }) => {
  await expect.poll(() => focusedTestId(page)).toBe('finish-review')
})

/**
 * Aimed at the retrospective's own name, which is above the bar and as far from
 * a popover anchored to the button on its right as this page goes.
 */
When('the reviewer clicks outside the refusal', async ({ page }) => {
  await page.getByTestId('retro-name').click()
})

Then('the review is not finished', async ({ page }) => {
  await expect(page.getByTestId('review-finished')).toHaveCount(0)
})

Then('the review is read-only', async ({ page }) => {
  await expect(page.getByTestId('review-read-only')).toBeVisible()
})

/**
 * The other side of it, and an absence assertion on purpose: a review that is
 * editable says nothing about being editable — what it does is not carry the
 * marker. It exists for the address a human typed wrong (retro-13
 * `r-validatesearch-narrows-not-polices`), where a junk `?rev=` used to pin the
 * page to a revision that does not exist and take every control away.
 */
Then('the review is not read-only', async ({ page }) => {
  await expect(page.getByTestId('review-read-only')).toHaveCount(0)
})

/**
 * The acknowledgment the press used to have none of. It is the visible half of
 * "once per round": the reviewer can see that it landed, which is what makes
 * the button's absence read as done rather than as broken.
 */
Then('the reviewer is told the round is with the AI', async ({ page }) => {
  await expect(page.getByTestId('finish-acknowledged')).toBeVisible()
})

Then('finishing is no longer offered', async ({ page }) => {
  await expect(page.getByTestId('finish-review')).toBeDisabled()
})

Then('finishing is offered again', async ({ page }) => {
  await expect(page.getByTestId('finish-review')).toBeEnabled()
  await expect(page.getByTestId('finish-acknowledged')).toHaveCount(0)
})

/**
 * Counted where the events actually land — the mock world's outbox, which is
 * the same place the real one keeps them. A second `ReviewFinished` would be a
 * second round for the AI to answer, which is the thing the record is about.
 */
Then('the review was finished exactly once', async ({ page }) => {
  const fired = await page.evaluate(() =>
    (window as unknown as MockWindow).retroMock.eventCount('ReviewFinished'),
  )
  expect(fired, 'the finish fired more than once').toBe(1)
})

/**
 * Nothing was sent at all — the assertion the two-step exists for
 * (`r-finish-confirm-message`). Read off the outbox rather than off the page: a
 * button that still says "Finish review" is not evidence that the server was
 * never asked.
 */
Then('the review has not been finished at all', async ({ page }) => {
  const fired = await page.evaluate(() =>
    (window as unknown as MockWindow).retroMock.eventCount('ReviewFinished'),
  )
  expect(fired, 'the finish fired without the reviewer answering the confirm').toBe(0)
})

/**
 * The confirm, and the two things about it the record is: it holds a final
 * message box, and that box is **optional** — said in the page's own words,
 * because a required-looking field is one the reviewer feels obliged to fill.
 *
 * The submit is asserted enabled on an empty box for the same reason: the
 * nearest in-repo composer (`ComposerBox`) disables Post until something is
 * typed, and copying that here would make the optional message mandatory.
 */
Then('the finish confirm is open, offering a final message that is optional', async ({ page }) => {
  const confirm = page.getByTestId('finish-confirm')
  await expect(confirm).toBeVisible()

  const box = confirm.getByTestId('finish-message')
  await expect(box).toBeVisible()
  await expect(box).toHaveValue('')

  // The word, wherever the page chose to put it — a label a screen reader
  // reads is the only place that counts, so this asks the accessible name.
  const named = await box.evaluate((element) => {
    const labelled = element.getAttribute('aria-label')
    if (labelled !== null) return labelled
    const id = element.getAttribute('id')
    const label = id === null ? null : document.querySelector(`label[for="${id}"]`)
    return label?.textContent ?? ''
  })
  expect(named.toLowerCase(), 'the message box never says it is optional').toContain('optional')

  await expect(confirm.getByTestId('finish-confirm-submit')).toBeEnabled()
})

/**
 * The round's last word, still in the box it was typed into after a send-time
 * refusal took the composer off the screen (`r-finish-refusal-fires-late`).
 *
 * An exact match on the field's value, because the claim is that nothing was
 * lost — a containment check would pass on a box holding half the sentence,
 * which is the failure this is about.
 */
Then('the finish confirm still holds {string}', async ({ page }, text: string) => {
  await expect(page.getByTestId('finish-confirm')).toBeVisible()
  await expect(page.getByTestId('finish-message')).toHaveValue(text)
})

Then('the finish confirm is closed', async ({ page }) => {
  await expect(page.getByTestId('finish-confirm')).toHaveCount(0)
})

/** The button is still there and still pressable — backing out cost nothing. */
Then('finishing is still offered', async ({ page }) => {
  await expect(page.getByTestId('finish-review')).toBeEnabled()
})

/**
 * The AI's side of the round. The owner asked for the message *"delivered
 * separately from the comments"*, so what proves it arrived is the round
 * carrying it — not a thread, and not anything the page renders back.
 */
Then('the round carries the final message {string}', async ({ page }, text: string) => {
  const carried = await page.evaluate(() =>
    (window as unknown as MockWindow).retroMock.finishMessage(),
  )
  expect(carried, 'the round did not carry the word the reviewer wrote').toBe(text)
})

Then('the round carries no final message', async ({ page }) => {
  const carried = await page.evaluate(() =>
    (window as unknown as MockWindow).retroMock.finishMessage(),
  )
  expect(carried, 'the round carried a message the reviewer never wrote').toBeNull()
})

/**
 * What the review's own actions offer, counted and named rather than checked
 * for the absence of the one button somebody remembers (retro 4
 * `r-one-finish-button`). Request changes left from here.
 */
Then('the review actions offer the buttons {string}', async ({ page }, buttons: string) => {
  await expect(page.getByTestId('review-actions').getByRole('button')).toHaveText(listed(buttons))
})

Then('the banner announces revision {int}', async ({ page }, revision: number) => {
  await expect(page.getByTestId('revision-banner')).toContainText(`Revision ${revision} available`)
})

Then('there is no revision banner', async ({ page }) => {
  await expect(page.getByTestId('revision-banner')).toHaveCount(0)
})

/* ── the retrospective's own identity ─────────────────────────────────────── */

/**
 * The same two strings a dashboard row carries, on the page the row leads to
 * (N1, N3). Asserted with `toHaveText` rather than `toContainText` because the
 * identity line is a format, not a set of facts that happen to be present.
 */
Then('the review header names the retro {string}', async ({ page }, name: string) => {
  await expect(page.getByTestId('retro-name')).toHaveText(name)
})

Then('the review header identifies it as {string}', async ({ page }, identity: string) => {
  await expect(page.getByTestId('retro-identity')).toHaveText(identity)
})

/** The retrospective's own state, in the dashboard row's word (G1). */
Then('the review header says the retro is {string}', async ({ page }, state: string) => {
  await expect(page.getByTestId('retro-state')).toHaveText(state)
})

/* ── the index rail ───────────────────────────────────────────────────────── */

/**
 * Every record of the revision, in order — asserted as an exact, ordered list,
 * because the whole claim of an index is that nothing is missing from it. A
 * `toContainText`-style check would pass on a rail that had quietly dropped one.
 */
Then('the record index lists {string}', async ({ page }, order: string) => {
  const rids = listed(order)
  const entries = page.getByTestId(/^rail-entry-/)
  await expect(entries).toHaveCount(rids.length)
  for (const [index, rid] of rids.entries()) {
    await expect(entries.nth(index)).toHaveAttribute('data-testid', `rail-entry-${rid}`)
  }
})

Then(
  'the record index entry for {string} reads {string} and {string}',
  async ({ page }, rid: string, num: string, title: string) => {
    const entry = railEntry(page, rid)
    await expect(entry.getByTestId('rail-num')).toHaveText(num)
    await expect(entry.getByTestId('rail-title')).toHaveText(title)
  },
)

/**
 * The state a rail entry is marking. The word is there for a screen reader
 * rather than for the eye — the eye gets the icon's shape and its ink — and it
 * is the word that is asserted, because a colour is not a thing a test can read
 * and a shape is not a thing a reviewer can be asked to memorise.
 */
Then(
  'the record index entry for {string} is {string}',
  async ({ page }, rid: string, state: string) => {
    await expect(railEntry(page, rid).getByTestId('rail-state')).toHaveText(state)
  },
)

/**
 * The filter took this record off the page, so the entry leads nowhere and says
 * so twice: to the eye by dimming, to everything else by `aria-disabled`. The
 * dimming is asked of the browser rather than of the class list, because what
 * matters is that it was actually painted faded.
 */
Then('the record index entry for {string} is dimmed and inert', async ({ page }, rid: string) => {
  const entry = railEntry(page, rid)
  await expect(entry).toHaveAttribute('aria-disabled', 'true')
  await expect(entry).toBeDisabled()
  const opacity = await entry.evaluate((element) => Number(getComputedStyle(element).opacity))
  expect(opacity, 'the entry is not dimmed').toBeLessThan(1)
})

Then('the record index entry for {string} leads to that record', async ({ page }, rid: string) => {
  const entry = railEntry(page, rid)
  await expect(entry).toHaveAttribute('aria-disabled', 'false')
  await expect(entry).toBeEnabled()
})

Then('the rail is on screen', async ({ page }) => {
  await expect(page.getByTestId('record-rail')).toBeVisible()
})

/**
 * `toHaveCount(0)` rather than `toBeHidden()`. The rail used to be CSS-hidden
 * below `wide` and hidden was all that could be asked; since session 7 it is not
 * rendered at all, and that is load-bearing rather than tidy — a hidden rail
 * behind an open sheet would be two copies of the same index in one document,
 * and `toBeHidden()` passes on both (`lib/side-panel.ts`).
 */
Then('the rail is not on screen', async ({ page }) => {
  await expect(page.getByTestId('record-rail')).toHaveCount(0)
})

When('the reviewer opens the record index', async ({ page }) => {
  await page.getByTestId('record-index').click()
})

Then('the record index affordance is offered', async ({ page }) => {
  await expect(page.getByTestId('record-index')).toBeVisible()
})

Then('the record index affordance is not offered', async ({ page }) => {
  await expect(page.getByTestId('record-index')).toHaveCount(0)
})

Then('the record index is open', async ({ page }) => {
  await expect(page.getByTestId('record-index-sheet')).toBeVisible()
})

Then('the record index is closed', async ({ page }) => {
  await expect(page.getByTestId('record-index-sheet')).toHaveCount(0)
})

/**
 * Which edge the sheet came out of — *"they should open in a left panel just
 * like comments open from the right panel"*, so this is the half of his sentence
 * that says which side, and it is the half a browser will half-do for free: an
 * `inset-y-0` sheet is full height and near the top whichever edge it is pinned
 * to. A controlled assertion (`r-uncontrolled-assertions`), hand-run with the
 * sheet moved to `right-0`; the failure output is in the lane report.
 */
Then('the record index opens from the left', async ({ page }) => {
  const sheet = await page.getByTestId('record-index-sheet').boundingBox()
  const viewport = page.viewportSize()
  expect(sheet, 'the record index is not open').not.toBeNull()
  expect(viewport, 'the scenario set no viewport').not.toBeNull()
  if (sheet === null || viewport === null) return

  const where = Math.round(sheet.x) === 0 ? 'against the left edge' : `${Math.round(sheet.x)}px in`
  expect(where, `the index sheet starts ${where} of a ${viewport.width}px page`).toBe(
    'against the left edge',
  )
})

/**
 * The index sheet's own width, under the same rule the comments sheet takes with
 * a cap of its own: `min(26rem, 100vw - 4rem)`. Asserted separately because two
 * sheets under one rule with two caps is exactly the arrangement where a shared
 * assertion would pass on one of them being wrong.
 */
Then('the record index sheet is {int} pixels wide', async ({ page }, expected: number) => {
  const box = await page.getByTestId('record-index-sheet').boundingBox()
  expect(box, 'the record index is not open').not.toBeNull()
  if (box === null) return
  const width = Math.round(box.width)
  expect(width, `the index sheet is ${width}px rather than ${expected}px`).toBe(expected)
})

/**
 * The strip this sheet leaves, mirrored: it opens from the left, so the page
 * still showing is everything past its right edge rather than everything before
 * its left one.
 *
 * A controlled assertion (`r-uncontrolled-assertions`), re-proven against main's
 * proportional 85vw; the failure output is in the lane report.
 */
Then(
  'the record index sheet leaves {int} pixels of the page uncovered',
  async ({ page }, expected: number) => {
    const box = await page.getByTestId('record-index-sheet').boundingBox()
    const viewport = page.viewportSize()
    expect(box, 'the record index is not open').not.toBeNull()
    expect(viewport, 'the scenario set no viewport').not.toBeNull()
    if (box === null || viewport === null) return

    const strip = viewport.width - Math.round(box.x + box.width)
    expect(
      strip,
      `the index sheet leaves ${strip}px of the page showing rather than ${expected}px`,
    ).toBe(expected)
  },
)

/**
 * Aimed at the backdrop's top-*right* corner — as far from a left-anchored sheet
 * as the viewport goes, so this cannot pass by landing on the sheet's own edge.
 */
When('the reviewer clicks outside the record index', async ({ page }) => {
  const viewport = page.viewportSize()
  const x = viewport === null ? 8 : viewport.width - 8
  await page.getByTestId('record-index-backdrop').click({ position: { x, y: 8 } })
})

/* ── chrome ───────────────────────────────────────────────────────────────── */

Then('the breadcrumb reads {string}', async ({ page }, trail: string) => {
  await expect(page.getByTestId('breadcrumb-crumb')).toHaveText(trail.split(' › '))
})

Then('the page title is {string}', async ({ page }, title: string) => {
  await expect(page.getByTestId('page-title')).toHaveText(title)
})

Then('the page says it cannot find that', async ({ page }) => {
  await expect(page.getByTestId('not-found')).toBeVisible()
})

Then('the page is in the {string} theme', async ({ page }, theme: string) => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark')
})

Then('the page body is not empty', async ({ page }) => {
  const body = (await page.locator('body').innerText()).trim()
  expect(body.length).toBeGreaterThan(0)
})

Then('the browser reported no console errors', async ({ consoleGuard }) => {
  expect(consoleGuard.problems).toEqual([])
})
