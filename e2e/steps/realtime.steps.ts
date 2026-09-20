import { expect } from '@playwright/test'
import { Given, Then, When } from '../fixtures'

/**
 * Two browser contexts on one review, the way the product is actually used —
 * laptop and iPad — with a CLI writing between them.
 *
 * Separate contexts rather than two tabs of one, because what is under test is
 * that each page holds its own stream and hears independently.
 */
/**
 * The human's half of round 1, from a process that is neither browser — the
 * same standing-in-for-the-server move the CLI suite makes one layer down.
 *
 * It exists because `revision create` refuses to replace a round nobody has
 * finished (`r-revision-sneaks-past-review`), and because doing it through
 * the UI here would spend a dozen steps of a scenario whose subject is the SSE
 * stream. `revise` is the verdict the refusal itself names, so what follows is
 * the designed path rather than a detour around the gate.
 */
Given('the human has asked for a rewrite and finished the round', async ({ retro }) => {
  const result = await retro.tool('finish-round', String(retro.state.retroId))
  expect(result.code, `finish-round failed: ${result.stderr}`).toBe(0)
})

Given('two reviewers have the review open', async ({ reviewers, retro }) => {
  await reviewers.open(retro.url(`/retros/${retro.state.retroId}`), 2)

  for (const index of [0, 1]) {
    await expect(reviewers.at(index).getByTestId('review-actions')).toBeVisible()
  }
})

Then('both pages announce revision {int}', async ({ reviewers }, revision: number) => {
  // No reload in this step: the banner arrives over the stream both pages
  // already had open.
  for (const index of [0, 1]) {
    await expect(reviewers.at(index).getByTestId('revision-banner')).toContainText(
      String(revision),
      { timeout: 15_000 },
    )
  }
})

Then('neither page has swapped in the new content', async ({ reviewers, retro }) => {
  // "Announce, don't swap": the reviewer keeps reading what they were reading
  // until they ask for the new draft, because a verdict has to bind to the
  // content the person actually saw.
  const first = retro.state.rids[0] ?? ''
  for (const index of [0, 1]) {
    const page = reviewers.at(index)
    // `revise` is the verdict the human left in the round they finished, and
    // it is still what these pages show: they are reading revision 1.
    await expect(page.getByTestId(`record-${first}`).getByTestId('record-state')).toContainText(
      'revise',
    )
    // The banner offers the swap rather than performing it.
    await expect(page.getByTestId('revision-banner-load')).toBeVisible()
  }
})

When('the first reviewer approves record {string}', async ({ reviewers }, rid: string) => {
  const page = reviewers.at(0)
  await page.getByTestId(`record-${rid}`).getByTestId('approved').click()
  await expect(page.getByTestId(`record-${rid}`).getByTestId('record-state')).toContainText(
    'approved',
  )
})

Then('the second reviewer sees {string} approved', async ({ reviewers }, rid: string) => {
  // Nobody told this page anything directly: the decision became an event, the
  // tailer read it from the database, and this page's stream turned it into a
  // refetch. The event is the signal; the refetched query is the truth.
  await expect(
    reviewers.at(1).getByTestId(`record-${rid}`).getByTestId('record-state'),
  ).toContainText('approved', { timeout: 15_000 })
})
