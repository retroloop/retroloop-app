import { expect, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import { Given, Then, When } from '../fixtures'
import { chooseDarkMode, openSettingsSection } from './labels.steps'

/**
 * The global chrome's own steps: the one navigation dropdown, and the theme every
 * other feature reads its colours in.
 *
 * It is a file of its own because the chrome stopped being two components and a
 * pair of loose links. Global navigation is now one menu the shell renders on
 * every route (`chrome/app-menu.tsx`), so the acts that cross pages — open the
 * menu, follow an item, go and change the theme and come back — belong together
 * rather than scattered across the step files of the pages they happen to start
 * on.
 *
 * The house rules hold here: address by `data-testid`, and every act goes through
 * the page. The one deliberate exception is the counted sweep below, which is an
 * *absence* assertion and is argued where it is written.
 */

/* ── the one menu ─────────────────────────────────────────────────────────── */

/**
 * Opened, and not returned until its content is actually on screen: Radix mounts
 * the menu in a portal after the press, so a step that returned on the click
 * would hand the next one a menu that is still arriving.
 */
export async function openAppMenu(page: Page): Promise<void> {
  await page.getByTestId('app-menu').click()
  await expect(page.getByTestId('app-menu-items')).toBeVisible()
}

When('the reviewer opens the app menu', async ({ page }) => {
  await openAppMenu(page)
})

/**
 * Following an item, and the step is not over when the item is clicked — it is
 * over when the menu has finished leaving.
 *
 * **This is the close-wait the header's theme menu used to carry**, moved here with
 * the menu it belongs to (`review.steps.ts` §chooses the theme, retired with the
 * toggle). It arrived carrying an account of its own hazard — a closing Radix layer
 * holding `body` at `pointer-events: none` for the length of its exit and taking
 * the next press as an outside one — and a follow-up measurement found that
 * account **wrong on this library version**. It is corrected here rather than
 * repeated, because a step comment is read as instruction.
 *
 * **What actually happens on `radix-ui` 1.6.7.** The exit releases `body`
 * *before* the content unmounts, not after: under a two-second main-thread hold the
 * press lands at t=0, `body` comes back at t≈2.0s and the item leaves the document
 * at t≈4.0s, and the same ordering held under CPU throttling at ×20 and ×50 and on
 * a healthy renderer (0ms → 33ms). So of the two conditions below, `toHaveCount(0)`
 * strictly dominates and the poll under it has never once waited.
 *
 * **And the swallowed press cannot happen to this suite at all.** Playwright's
 * `click()` does not return until the page has reacted to it, so the close is over
 * before the harness can act again: with this wait deleted outright, the close
 * completed at t=2040ms and the first reading that could be taken after it landed
 * at t=2181ms. Forcing a press past Playwright's own actionability rescue does not
 * change it — a starved page serves the harness's presses out of the same windows
 * it runs its own commits in.
 *
 * **So why the wait is still here, and what does certify it.** Both conditions
 * stay: which of the two comes last is Radix's to change, and a wait that holds
 * only by accident of ordering is one nobody would notice losing. What is
 * provable is the *budget* — that this walk survives a renderer running fifty
 * times slower — and that is what `chrome.feature` §the app menu opens, closes
 * and arrives asserts, red with every budget in it cut to a healthy page's
 * 300ms — 10 green, 10 red with the budgets cut, 10 green again.
 */
export async function followAppMenuItem(page: Page, label: string): Promise<void> {
  const item = page.getByTestId(`app-menu-${label.toLowerCase()}`)
  await item.click()

  await expect(item).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      message: 'the closing app menu is still holding the page',
    })
    .not.toBe('none')
}

When('the reviewer follows {string} in the app menu', async ({ page }, label: string) => {
  await followAppMenuItem(page, label)
})

/**
 * **A renderer running a fiftieth of its own speed**, produced through Chromium's
 * own emulation rather than by loading the machine — deterministic in the same way
 * `review.feature`'s main-thread hold is, and for the same reason: the window is
 * made here, so it is the same window on a busy laptop and an idle one.
 *
 * **Why this engine and not the hold loop, which is measured and already in the
 * suite.** They starve different things. The hold loop quantises the page into
 * whole periods and lets nothing else run inside one, so the close commits
 * *atomically* between two of the harness's own acts and no state of it is ever
 * observable: with the close-wait deleted outright and again with it cut to 300ms,
 * the certification scenario stayed green at 8.4s — the same 8.4s as with the wait
 * — because Playwright's acknowledgement of the click that starts the close cannot
 * come back until the window that finishes it. Throttling scales instead of
 * quantising: React's commit and Radix's exit are hundreds of throttled tasks and
 * a reading is one, so the harness can look while the close is still going. That
 * asymmetry is the whole of the mechanism, and it is why a wait can be certified
 * here and not there.
 *
 * `newCDPSession` is Chromium-only, which this project is; nothing is intercepted,
 * routed or answered, so R-MOCK-LOCK is untouched.
 */
When('the renderer runs {int} times slower', async ({ page }, rate: number) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
})

/**
 * **Arrived** — the end state a starved menu press is on the way to, and what the
 * certification scenario is red without.
 *
 * It is deliberately not a reading of what `followAppMenuItem` left behind, and
 * that is a measurement rather than a preference. Such a reading cannot be made to
 * fail: Playwright's own `click()` does not return until the page has reacted to
 * it, so the close is already over by the time anything can look — with the wait
 * deleted outright, the close completed at t=2040ms and the first reading after it
 * could not be taken until t=2181ms. An assertion that provably cannot fail is not
 * an assertion (`r-uncontrolled-assertions`, `r-checks-without-discrimination`), so
 * it is not written. What carries the scenario instead is the budget every wait it
 * walks through has to survive, and the plant is those budgets cut to a healthy
 * page's — the stall-edge defect: pass or fail is decided by where a stall's
 * edge falls relative to the deadline.
 */
Then('the reviewer has arrived at the records page', async ({ page }) => {
  await expect(page).toHaveURL(/\/records$/)
  await expect(page.getByTestId('records-list')).toBeVisible()
})

/**
 * **What the menu offers and where each item actually points**, as one ordered,
 * exact-length comparison against `<a>` elements.
 *
 * Three claims in one table, and each of them is the record's: the menu holds
 * *these* items in *this* order — an item added, dropped or moved fails here by
 * name — and every one of them is a **real link**, which is what makes
 * open-in-new-tab work. The locator is `a` rather than the menu-item role for
 * exactly that reason: a menu of `onSelect` handlers would look identical on
 * screen, satisfy any assertion made about its text, and refuse every middle
 * click. Reading `href` is what tells the two apart.
 */
Then('the app menu points at:', async ({ page }, table: DataTable) => {
  const wanted = table.raw().map(([label, href]) => ({ label: String(label), href: String(href) }))
  const items = page.getByTestId('app-menu-items').locator('a')

  await expect(items).toHaveText(wanted.map((item) => item.label))
  for (const [index, item] of wanted.entries()) {
    await expect(items.nth(index)).toHaveAttribute('href', item.href)
  }
})

/**
 * **The counted sweep the loose links are gone by** — every anchor in the header,
 * not the two testids that used to be there.
 *
 * A pair of `toHaveCount(0)` assertions against `records-link` and `settings-link`
 * would pass on a header that had grown three new links under different names,
 * which is the failure this record exists to prevent: what is required is that
 * the top menu carries *no loose items*, not that two particular ones were
 * renamed. So the sweep counts what a reader would count, and the only anchor
 * left in the chrome is the brand — the way home, which was never a menu item.
 *
 * Selecting by tag is the exception to this suite's testid rule and it is the
 * point: an absence assertion addressed by testid can only see the absences it
 * was told to look for.
 */
Then('the top menu carries no loose navigation links', async ({ page }) => {
  const links = page.locator('header a')
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveAttribute('data-testid', 'app-brand')
})

/**
 * The theme toggle left the header entirely rather than moving into the dropdown
 * — the design is explicit that it goes *under Settings* — so both halves of
 * the old control are asserted gone: the trigger, and the options it used to
 * open.
 */
Then('the top menu carries no theme control', async ({ page }) => {
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0)
  await expect(page.getByTestId('theme-option-dark')).toHaveCount(0)
})

/**
 * The app menu's position is stated as "in the top right", so the position
 * is asserted rather than assumed.
 *
 * A position assertion is shown to fail before it is trusted
 * (`r-uncontrolled-assertions`): a browser lays a flex row out left to right for
 * free, and an assertion that merely found the trigger somewhere in the header
 * would ship green on a menu sitting beside the brand.
 *
 * Two halves, because "top right" is two claims: the trigger is past the brand
 * (right of what the header opens with), and its right edge is flush with the
 * measure the page itself ends at — the header's inner row and `<main>` share
 * that measure and its padding (`app-shell.tsx`), so a control that had drifted
 * inward would land short of it. The tolerance is the gutter, not a margin for
 * error: `sm:px-6` is 24px and the assertion allows 40.
 */
Then('the app menu sits at the right end of the top menu', async ({ page }) => {
  // Measured, so the elements have to be on screen first: the dashboard renders
  // no chrome at all until both its queries answer.
  await expect(page.getByTestId('app-menu')).toBeVisible()
  const trigger = await page.getByTestId('app-menu').boundingBox()
  const brand = await page.getByTestId('app-brand').boundingBox()
  const measure = await page.getByTestId('page-measure').boundingBox()
  expect(trigger, 'the app menu is not on screen').not.toBeNull()
  expect(brand, 'the brand is not on screen').not.toBeNull()
  expect(measure, 'the page body is not on screen').not.toBeNull()
  if (trigger === null || brand === null || measure === null) return

  expect(trigger.x, 'the app menu is not past the brand').toBeGreaterThan(brand.x + brand.width)
  expect(
    trigger.x + trigger.width,
    'the app menu is short of the measure the page ends at',
  ).toBeGreaterThan(measure.x + measure.width - 40)
})

/* ── the theme, through the only control that sets it ─────────────────────── */

/**
 * **The theme a scenario needs, set the way a reader would set it now that the
 * header toggle is gone**: through the menu, into Settings › Appearance › Dark
 * Mode, and back to the page under test.
 *
 * It is a walk rather than a reach into storage because the rule it serves is
 * that theme-visible states are asserted through the app's own control
 * (testing.md), and since `r-menu-dropdown` the app has exactly one — the
 * `Select` in `settings/appearance.tsx`, driven here by the same helper the
 * settings page's own scenarios use, close-wait included.
 *
 * **Client-side, and back by the browser's own button.** The mock's world is the
 * module (`labels.steps.ts` §the settings page), so a `page.goto` on the way
 * there or back would start a second world and hand the rest of the scenario a
 * store where nothing it had done had happened. Following the menu is a router
 * navigation and `goBack` is its history pop: one document, one world, and the
 * page comes back in the theme that was chosen.
 *
 * The perfect tense is the difference from `the reviewer sets dark mode to …`,
 * which is the act itself, on the settings page, and stays there.
 */
Given('the reviewer has set dark mode to {string}', async ({ page }, option: string) => {
  const cameFrom = page.url()

  await openAppMenu(page)
  await followAppMenuItem(page, 'Settings')
  await openSettingsSection(page, 'appearance')
  await chooseDarkMode(page, option)

  const wanted = option.toLowerCase()
  if (wanted !== 'system') {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')), {
        message: 'the theme the settings control was set to is not the one applied',
      })
      .toBe(wanted === 'dark')
  }

  await page.goBack()
  await expect(page).toHaveURL(cameFrom)
})
