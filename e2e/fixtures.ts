import { type BrowserContext, expect, type Page } from '@playwright/test'
import { test as base, createBdd } from 'playwright-bdd'
import { createWorld, type RetroWorld } from './support/world'

/**
 * Extra reviewers, each in its own browser context.
 *
 * A fixture rather than module state so the contexts close even when a scenario
 * fails half-way: a leaked context holds an open SSE stream, and the next
 * scenario would be racing a page nobody is watching.
 */
export type Reviewers = {
  open(url: string, count: number): Promise<void>
  at(index: number): Page
}

/**
 * Suite 5's fixtures: one throwaway stage per scenario, and the standing
 * zero-console-error check.
 *
 * The stage is per-scenario rather than per-suite because the scenarios need
 * different starting states — one of them seeds an *older schema* before the
 * server has ever run, which a shared server could not offer.
 */
export const test = base.extend<{
  retro: RetroWorld
  reviewers: Reviewers
  consoleGuard: string[]
}>({
  // Playwright reads a fixture's dependencies off its destructured parameter, so
  // "depends on nothing" has to be spelled as an empty pattern.
  // biome-ignore lint/correctness/noEmptyPattern: the parameter shape is the API.
  retro: async ({}, use) => {
    const world = createWorld()
    await use(world)
    await world.stop()
  },

  reviewers: async ({ browser }, use) => {
    const contexts: BrowserContext[] = []
    const pages: Page[] = []

    await use({
      async open(url, count) {
        for (let index = 0; index < count; index += 1) {
          const context = await browser.newContext()
          const page = await context.newPage()
          await page.goto(url)
          contexts.push(context)
          pages.push(page)
        }
      },
      at(index) {
        const page = pages[index]
        if (page === undefined) throw new Error(`no reviewer at index ${index}`)
        return page
      },
    })

    for (const context of contexts) await context.close()
  },

  /**
   * The standing check: zero console errors, zero pageerrors (testing.md).
   *
   * **It depends on `retro` on purpose, and the dependency is load-bearing even
   * though it goes unused in the body.** Playwright tears fixtures down in
   * reverse setup order, so naming `retro` here puts this one last to set up and
   * therefore first to tear down — which means the assertion runs while the
   * server is still alive. Without it, an auto fixture is set up first and torn
   * down last: the stage would already have been stopped, and every scenario
   * would fail on the `ERR_INCOMPLETE_CHUNKED_ENCODING` that killing a server
   * under an open SSE stream produces. That is the harness ending the world, not
   * the app misbehaving, and a guard that reported it would be reporting itself.
   */
  consoleGuard: [
    async ({ page, retro }, use) => {
      void retro
      const problems: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
      await use(problems)
      expect(problems, 'the browser reported problems during this scenario').toEqual([])
    },
    { auto: true },
  ],
})

export const { Given, When, Then } = createBdd(test)
