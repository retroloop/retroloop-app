import { expect } from '@playwright/test'
import { test as base, createBdd } from 'playwright-bdd'

/**
 * Collects everything the browser complained about, and refuses to let a
 * scenario pass while it complained about anything.
 *
 * The standing check in testing.md is "zero console errors, zero pageerrors on
 * every route". Asserting it here rather than in one scenario is what makes it
 * standing: a React warning introduced anywhere fails the suite where it was
 * introduced, not in whichever scenario happened to remember to look.
 */
export type ConsoleGuard = {
  readonly problems: string[]
}

/**
 * Whether the page is in the middle of a scroll, watched from before it loads.
 *
 * **It has to be installed here, and that is the finding rather than a
 * preference.** `scrollAtRest` used to attach its own `scrollend` listener when
 * a wait began, and on a renderer that has almost stopped painting that is a
 * race it loses every time: the main thread is held for whole seconds, the
 * landing scroll starts and ends inside one of those blocks, the queued
 * `scrollend` dispatches the moment the block ends, and the listener the wait
 * was trying to attach gets there afterwards. Measured: the wait resolved in 2ms
 * on a `scrollend` belonging to the *previous* scroll, and then never saw the
 * one it was waiting for.
 *
 * A watcher installed before the page loads cannot be late. It records the
 * state rather than the event — the wait asks "is a scroll in flight" instead of
 * "did one just end" — so a scroll that began and ended while nobody was looking
 * leaves the page at rest, which is the truth the wait needs.
 *
 * `scroll` on `window` is the document's own scrolling and nothing else: scroll
 * events do not bubble, so a panel scrolling inside the page never reaches here.
 */
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const state = { scrolling: false }
      ;(window as Window & { retroScroll?: { scrolling: boolean } }).retroScroll = state
      window.addEventListener(
        'scroll',
        () => {
          state.scrolling = true
        },
        { passive: true },
      )
      window.addEventListener(
        'scrollend',
        () => {
          state.scrolling = false
        },
        { passive: true },
      )
    })
    await use(page)
  },
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
      await use({ problems })
      expect(problems, 'the browser reported problems during this scenario').toEqual([])
    },
    { auto: true },
  ],
})

export const { Given, When, Then } = createBdd(test)
