import { expect, type Locator, type Page } from '@playwright/test'
import type { DataTable } from 'playwright-bdd'
import { Given, Then, When } from '../fixtures'
import { withFilterPanel } from './records.steps'

/**
 * The settings page's steps, and the label and attribute surfaces on a record.
 *
 * The same two rules the other step files obey: select by `data-testid` and
 * nothing else, and every act goes through the page — the click reaches the real
 * component, the component calls the real tRPC client, and the client reaches
 * the typed mock. There is nothing here for the AI to do, because the AI's half
 * of this feature is the definition CRUD it drives through the CLI in its own
 * process, and the refusal that governs it is proved below every adapter
 * (`packages/core/test/unit/settings.test.ts`).
 *
 * **Definitions are addressed by name here and by id in the product.** The
 * filter and the toggles key on the definition id, because a rename must not
 * drop a filter a reader has applied; a scenario names the label, because
 * `records-filter-label-3` is a number a reader of the feature file cannot
 * check. The testids carry the name for exactly that reason
 * (`records-filter.tsx` §FilterGroup).
 *
 * **Every scenario in `labels.feature` lives on one page.** The mock's world is
 * the module, so a `page.goto` starts a second, opening one — which means a
 * scenario that walked from the settings page to a record page would be
 * asserting against a world where nothing it did had happened. What crosses
 * pages is the server's property and is proved against the real router
 * (`apps/api/test/procedures.test.ts`).
 */

function settingsRow(page: Page, kind: 'label' | 'attribute', name: string): Locator {
  return page.getByTestId(`settings-${kind}-list`).locator(`[data-testid^="settings-${kind}-"]`, {
    has: page.getByTestId(`settings-${kind}-name`).and(page.getByText(name, { exact: true })),
  })
}

/* ── opening it ───────────────────────────────────────────────────────────── */

/**
 * Waits on the **nav** rather than on any one panel, because only one of the
 * four is mounted at a time and General is the one that opens. Waiting on a
 * panel would make this step quietly mean "and General is open", which is a
 * different claim and one the section scenarios make on purpose.
 */
Given('the reviewer opens the settings page', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByTestId('settings-sections')).toBeVisible()
})

/**
 * The vertical section list, built with shadcn's vertical tabs.
 *
 * It asserts the item it pressed is the selected one before returning — a nav
 * whose state the reader cannot see is a nav they cannot trust, and every act
 * after this step is addressed to whatever panel is actually mounted.
 */
export async function openSettingsSection(page: Page, section: string): Promise<void> {
  const item = page.getByTestId(`settings-tab-${section}`)
  await item.click()
  await expect(item).toHaveAttribute('aria-selected', 'true')
}

When('the reviewer opens the {string} settings section', async ({ page }, section: string) => {
  await openSettingsSection(page, section)
})

/**
 * Which section the page opens on — *"General needs to be the first
 * item in the list"*, and first also means the one that is already
 * open, because a settings page that opened on its second section would be
 * answering a different question about order.
 */
Then('the {string} settings section is selected', async ({ page }, section: string) => {
  await expect(page.getByTestId(`settings-tab-${section}`)).toHaveAttribute('aria-selected', 'true')
})

/**
 * A store whose vocabulary nobody has configured — the state every store is in
 * between the AI filing its first retrospective and a human first opening this
 * page.
 *
 * Arranged before the app boots and read once by the mock's own fixture
 * (`bareVocabulary` in `test/trpc-mock.ts`), because it cannot be performed:
 * **nothing deletes a definition**. Retiring is what this product does instead,
 * and a retired label is still on the list — so there is no sequence of acts
 * that takes a configured store back to an unconfigured one.
 */
Given('nobody has configured a vocabulary', async ({ page }) => {
  await page.addInitScript(() => {
    window.retroMockBareVocabulary = true
  })
})

/**
 * **The nav's items, in order, as literals** — which is what makes "General is
 * first" and "the count is in brackets" one assertion each rather than a
 * collection of separate claims that would all pass on a list holding them in
 * any order.
 *
 * `toHaveText` against the whole locator list is an ordered, exact-length
 * comparison, so an item inserted, dropped or moved fails here by name.
 */
Then('the settings sections read, in order:', async ({ page }, table: DataTable) => {
  await expect(page.getByTestId('settings-nav').getByRole('tab')).toHaveText(
    table.raw().map(([label]) => String(label)),
  )
})

/**
 * What one section says is behind it, before the reader presses it — asserted as
 * the whole literal, `Labels (3)`, because that is exactly the rule: the
 * count needs to be in brackets like
 * 'Labels (1)' instead of 'Labels 1'. A step that read the number on its own
 * would pass on the bare form this replaced, which is the one state this
 * assertion exists to catch.
 *
 * Both counts in one step, because the claim is that each section counts **its
 * own** vocabulary: the create in the scenario moves one of them and must not
 * move the other, so a nav that counted the label list twice fails here.
 */
Then('the settings sections read:', async ({ page }, table: DataTable) => {
  for (const [section, label] of table.raw()) {
    await expect(
      page.getByTestId(`settings-tab-${String(section)}`),
      `the ${String(section)} nav item`,
    ).toHaveText(String(label))
  }
})

/**
 * **The nav is a column, not a strip** — read two ways, because
 * `r-checks-without-discrimination` asks what else would pass each one and the
 * answer for either alone is "quite a lot".
 *
 * `aria-orientation` is what Radix sets from the `orientation` prop and what
 * drives the up/down arrow-key contract a reader without a mouse depends on — but
 * a page styled into a row would still carry it, so on its own it proves the
 * keyboard and not the layout. The geometry is the other half: the nav's items
 * stack (each below the last, all sharing a left edge) and the whole nav sits to
 * the **left** of the panel it switches, which is the design rule in
 * pixels — a left vertical nav of sections with the content on the right.
 * On its own that would pass a
 * CSS column whose arrow keys still went sideways.
 *
 * **This is a position assertion, so it is hand-run with the behaviour deleted**
 * (`r-uncontrolled-assertions`) — flexbox stacks children for free in more than
 * one configuration, which is exactly how a toothless layout assertion ships
 * green. The plant and its failure output are recorded with the suite's own evidence.
 */
Then('the settings nav is vertical', async ({ page }) => {
  await expect(page.getByTestId('settings-nav')).toHaveAttribute('aria-orientation', 'vertical')

  const items = await page.getByTestId('settings-nav').getByRole('tab').all()
  const boxes = await Promise.all(items.map((item) => item.boundingBox()))
  expect(boxes.length, 'the nav has no items to be vertical about').toBe(4)

  for (const [index, box] of boxes.entries()) {
    const previous = boxes[index - 1]
    if (previous === undefined || previous === null) continue
    expect(box, `nav item ${index} has no box`).not.toBeNull()
    expect(
      box?.y ?? 0,
      `nav item ${index} does not sit below the one before it`,
    ).toBeGreaterThanOrEqual(previous.y + previous.height)
    expect(box?.x ?? 0, `nav item ${index} does not share the left edge of the one before it`).toBe(
      previous.x,
    )
  }

  const nav = await page.getByTestId('settings-nav').boundingBox()
  const panel = await page.getByTestId('settings-ai-config-write').boundingBox()
  expect(nav, 'the nav has no box').not.toBeNull()
  expect(panel, 'the open panel has no box').not.toBeNull()
  expect(
    (nav?.x ?? 0) + (nav?.width ?? 0),
    'the nav does not sit to the left of the panel it switches',
  ).toBeLessThanOrEqual(panel?.x ?? 0)
})

Then('the {string} settings panel is showing', async ({ page }, panel: string) => {
  await expect(page.getByTestId(`settings-${panel}`)).toBeVisible()
})

/**
 * `toHaveCount(0)` and not `not.toBeVisible()`: the claim is that the other
 * panels are **not mounted**, which is what makes these sub-tabs rather than
 * three sections with two of them hidden. A CSS-hidden panel would satisfy
 * invisibility and still put every one of its controls in the accessibility tree.
 */
Then('the {string} settings panel is not showing', async ({ page }, panel: string) => {
  await expect(page.getByTestId(`settings-${panel}`)).toHaveCount(0)
})

/* ── the vocabularies ─────────────────────────────────────────────────────── */

Then('the labels read:', async ({ page }, table: DataTable) => {
  await expect(page.getByTestId('settings-label-name')).toHaveText(
    table.raw().map(([name]) => String(name)),
  )
})

/** The type travels with the name, because it is the half a rename cannot change. */
Then('the attributes read:', async ({ page }, table: DataTable) => {
  const rows = table.raw()
  await expect(page.getByTestId('settings-attribute-name')).toHaveText(
    rows.map(([name]) => String(name)),
  )
  await expect(page.getByTestId('settings-attribute-type')).toHaveText(
    rows.map(([, type]) => String(type)),
  )
})

Then('the label {string} is marked retired', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-retired')).toBeVisible()
})

Then('the label {string} is not marked retired', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-retired')).toHaveCount(
    0,
  )
})

/** Retiring has nothing left to do, so the control is gone rather than disabled. */
Then('the label {string} offers no way to retire it', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-retire')).toHaveCount(0)
})

Then('the label {string} offers a way to retire it', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-retire')).toBeEnabled()
})

/**
 * The two controls are one slot with two occupants (retro-11
 * `r-retire-burns-a-word`), so both directions are asserted by **presence and
 * absence**: an offerable row must not offer Un-retire, and a retired one must.
 * `toHaveCount(0)` rather than invisibility, for the reason the panel steps give
 * — a hidden control is still in the accessibility tree and still pressable by
 * anything that is not a mouse.
 */
Then('the label {string} offers a way to un-retire it', async ({ page }, name: string) => {
  await expect(
    settingsRow(page, 'label', name).getByTestId('settings-label-unretire'),
  ).toBeEnabled()
})

Then('the label {string} offers no way to un-retire it', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-unretire')).toHaveCount(
    0,
  )
})

Then('the attribute {string} is marked retired', async ({ page }, name: string) => {
  await expect(
    settingsRow(page, 'attribute', name).getByTestId('settings-attribute-retired'),
  ).toBeVisible()
})

Then('the attribute {string} is not marked retired', async ({ page }, name: string) => {
  await expect(
    settingsRow(page, 'attribute', name).getByTestId('settings-attribute-retired'),
  ).toHaveCount(0)
})

/** A typo in a retired label is as worth fixing as one in an offerable label. */
Then('the label {string} can still be renamed', async ({ page }, name: string) => {
  await expect(settingsRow(page, 'label', name).getByTestId('settings-label-rename')).toBeEnabled()
})

When('the reviewer creates the label {string}', async ({ page }, name: string) => {
  await page.getByTestId('settings-label-new-name').fill(name)
  await page.getByTestId('settings-label-new-submit').click()
})

When(
  'the reviewer creates the attribute {string} of type {string}',
  async ({ page }, name: string, type: string) => {
    await page.getByTestId('settings-attribute-new-name').fill(name)
    await page.getByTestId('settings-attribute-new-type').click()
    await page.getByTestId(`settings-type-${type}`).click()
    await page.getByTestId('settings-attribute-new-submit').click()
  },
)

When(
  'the reviewer renames the label {string} to {string}',
  async ({ page }, name: string, next: string) => {
    await settingsRow(page, 'label', name).getByTestId('settings-label-rename').click()
    const panel = page.getByTestId('settings-label-rename-panel')
    await expect(panel).toBeVisible()
    await panel.getByTestId('settings-label-rename-name').fill(next)
    await panel.getByRole('button', { name: 'Save' }).click()
    await expect(panel).toHaveCount(0)
  },
)

When('the reviewer retires the label {string}', async ({ page }, name: string) => {
  await settingsRow(page, 'label', name).getByTestId('settings-label-retire').click()
})

/** One press, the same shape as the retire it undoes — which is the whole fix. */
When('the reviewer un-retires the label {string}', async ({ page }, name: string) => {
  await settingsRow(page, 'label', name).getByTestId('settings-label-unretire').click()
})

When('the reviewer un-retires the attribute {string}', async ({ page }, name: string) => {
  await settingsRow(page, 'attribute', name).getByTestId('settings-attribute-unretire').click()
})

/**
 * The server's own sentence, not one this page invented — the name rules are the
 * domain's and are deliberately not restated here, so what the page owes the
 * reader is what came back (`vocabulary.tsx`).
 */
Then('the settings page refuses with {string}', async ({ page }, fragment: string) => {
  await expect(page.getByTestId('settings-label-refusal')).toContainText(fragment)
})

Then('the settings page says there are no labels yet', async ({ page }) => {
  await expect(page.getByTestId('settings-labels-empty')).toBeVisible()
})

Then('the settings page says there are no attributes yet', async ({ page }) => {
  await expect(page.getByTestId('settings-attributes-empty')).toBeVisible()
})

Then('the settings page says {string}', async ({ page }, sentence: string) => {
  await expect(page.getByTestId('settings-ai-toggle-state')).toHaveText(sentence)
})

/**
 * **The selected section, against every unselected one, channel by channel**
 * (`r-theme-blind-assertions`) — the highlight is what his reference shows and
 * what "selected item highlighted" means in pixels.
 *
 * Three channels tell them apart in `ui/tabs.tsx` — fill, ink and border — and
 * each is read on its own rather than joined into one string, because any single
 * surviving channel satisfies a whole-string inequality: a dark theme that
 * bleached the fill would still pass a joined assertion on the strength of the
 * ink, and the failure could not name the property that went missing.
 *
 * It compares live rows rather than one row against a literal colour. A literal
 * would be a second copy of the palette, free to disagree with `styles.css` and
 * needing an edit per theme; rows in the same nav under the same theme differ
 * **only** by selection, which is exactly the claim.
 *
 * **Which row is the selected one is read off the page, not assumed.** It used to
 * name General and Labels, which tied the assertion to the section the page
 * happens to open on — and the theme is now set from *inside* the Appearance
 * section (`chrome.steps.ts` §has set dark mode), so the selected row is
 * whichever one the scenario walked to. Reading it makes the step say what it
 * always meant, and comparing against **every** other row rather than one is the
 * stronger claim: a nav where a second row also wore the selected look would
 * have passed the old comparison.
 *
 * Transitions are killed before the colours are sampled, so what is read is where
 * they ended rather than where they were passing through — the same treatment the
 * lifecycle chips get (`records.steps.ts`).
 */
Then('the selected settings section stands out from the others', async ({ page }) => {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  const items = page.getByTestId('settings-nav').getByRole('tab')
  await expect(items).not.toHaveCount(0)

  await expect(async () => {
    const looks = await items.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        return {
          name: node.textContent ?? '',
          selected: node.getAttribute('aria-selected') === 'true',
          fill: style.backgroundColor,
          ink: style.color,
          border: style.borderTopColor,
        }
      }),
    )

    const on = looks.filter((look) => look.selected)
    const off = looks.filter((look) => !look.selected)
    expect(on.length, 'exactly one settings section should be selected').toBe(1)
    expect(off.length, 'every settings section is selected').toBeGreaterThan(0)

    const selected = on[0]
    if (selected === undefined) throw new Error('unreachable')
    for (const unselected of off) {
      expect(
        selected.fill,
        `the selected section has the same fill as "${unselected.name}"`,
      ).not.toBe(unselected.fill)
      expect(
        selected.ink,
        `the selected section has the same ink as "${unselected.name}"`,
      ).not.toBe(unselected.ink)
      expect(
        selected.border,
        `the selected section has the same border colour as "${unselected.name}"`,
      ).not.toBe(unselected.border)
    }
  }).toPass()
})

/* ── Appearance ───────────────────────────────────────────────────────────── */

/**
 * What the Dark Mode control is currently set to — read off the **trigger's own
 * text**, which is the thing a reader sees, rather than off the provider's state
 * or `localStorage`. A control that had drifted from the theme actually applied
 * would satisfy an assertion made against the state behind it and fail this one,
 * which is the direction that matters: the whole of his ask is that the setting
 * be visible in one named place.
 */
Then('the dark mode setting reads {string}', async ({ page }, option: string) => {
  await expect(page.getByTestId('settings-theme')).toHaveText(option)
})

/**
 * Choosing through the Select, and the step is not over when the option is
 * clicked — it is over when the listbox has finished leaving.
 *
 * Same two conditions the app menu's own step waits on, and the account of why —
 * including what a follow-up measurement checked and could
 * not reproduce on `radix-ui` 1.6.7 — is written once, there
 * (`chrome.steps.ts` §followAppMenuItem), not copied here.
 */
export async function chooseDarkMode(page: Page, option: string): Promise<void> {
  const chosen = page.getByTestId(`settings-theme-${option.toLowerCase()}`)
  await page.getByTestId('settings-theme').click()
  await chosen.click()

  await expect(chosen).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      message: 'the closing dark mode listbox is still holding the page',
    })
    .not.toBe('none')
}

When('the reviewer sets dark mode to {string}', async ({ page }, option: string) => {
  await chooseDarkMode(page, option)
})

/* ── the toggle ───────────────────────────────────────────────────────────── */

/**
 * `aria-checked`, not the fill: this is a `role="switch"`, and what a reader
 * without the colour hears is the attribute. The fill is asserted separately, in
 * both themes, by the outline below.
 */
Then('the AI config switch is off', async ({ page }) => {
  await expect(page.getByTestId('settings-ai-toggle')).toHaveAttribute('aria-checked', 'false')
})

Then('the AI config switch is on', async ({ page }) => {
  await expect(page.getByTestId('settings-ai-toggle')).toHaveAttribute('aria-checked', 'true')
})

When('the reviewer turns the AI config switch on', async ({ page }) => {
  await page.getByTestId('settings-ai-toggle').click()
  await expect(page.getByTestId('settings-ai-toggle')).toHaveAttribute('aria-checked', 'true')
})

When('the reviewer turns the AI config switch off', async ({ page }) => {
  await page.getByTestId('settings-ai-toggle').click()
  await expect(page.getByTestId('settings-ai-toggle')).toHaveAttribute('aria-checked', 'false')
})

/**
 * **Per channel, in both themes** (`r-theme-blind-assertions`).
 *
 * The switch carries its state in two channels — the track's fill and the
 * thumb's position — and they are read separately rather than joined: any single
 * surviving channel satisfies a whole-string inequality, so a joined assertion
 * would pass a switch whose dark theme suppressed the fill and moved only the
 * thumb, and could not say which property carried the difference.
 *
 * **The thumb is read as a position on screen rather than as a style, and that
 * is a finding rather than a preference.** The first version of this read
 * `getComputedStyle(thumb).transform` and got `none` in both states in both
 * themes — because Tailwind v4 compiles `translate-x-*` to the standalone
 * `translate` property, not to `transform`. A style-name assertion is only as
 * true as the property the framework happens to emit; a bounding box is the
 * thing a reader actually sees, and it cannot go stale when the utility changes
 * shape underneath it.
 *
 * Both readings are **polled**, because the switch transitions: a value read the
 * instant after the click is whatever frame the compositor was on. The poll is
 * what waits, and it fails by timing out on a switch that never moved — which is
 * the state this assertion exists to catch.
 */
Then('the AI config switch stands out when it is on', async ({ page }) => {
  const toggle = page.getByTestId('settings-ai-toggle')
  const thumb = toggle.locator('[data-slot="switch-thumb"]')

  const track = async () => toggle.evaluate((node) => getComputedStyle(node).backgroundColor)
  const knob = async () => (await thumb.boundingBox())?.x ?? 0

  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const offTrack = await track()
  const offKnob = await knob()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  await expect
    .poll(track, { message: 'the switch track is the same colour on and off' })
    .not.toBe(offTrack)
  await expect
    .poll(knob, { message: 'the switch thumb sits in the same place on and off' })
    .not.toBe(offKnob)
})

/* ── labels on a record ───────────────────────────────────────────────────── */

Then('the record page wears the labels:', async ({ page }, table: DataTable) => {
  await expect(page.getByTestId('record-label-row').getByTestId('record-labels')).toHaveText(
    table.raw().map(([name]) => String(name)),
    // The tag prints the name uppercased, which is the idiom every tag in this
    // app wears; the feature file names the label as the human typed it.
    { ignoreCase: true },
  )
})

Then('the record page wears no labels', async ({ page }) => {
  await expect(page.getByTestId('record-label-row').getByTestId('record-labels')).toHaveCount(0)
})

Then('the label {string} on the record page is marked retired', async ({ page }, name: string) => {
  await withLabelMenu(page, async () => {
    await expect(labelToggle(page, name).getByTestId('record-label-toggle-retired')).toBeVisible()
  })
})

/**
 * What the menu offers is what the server would accept: an offerable label, plus
 * any retired one this record already wears so it can be taken off. A control
 * the server would refuse is a control that should not be on screen.
 */
Then('the record page offers the label {string}', async ({ page }, name: string) => {
  await withLabelMenu(page, async () => {
    await expect(labelToggle(page, name)).toBeVisible()
  })
})

Then('the record page does not offer the label {string}', async ({ page }, name: string) => {
  await withLabelMenu(page, async () => {
    await expect(labelToggle(page, name)).toHaveCount(0)
  })
})

Then('the label menu says there are no labels yet', async ({ page }) => {
  await withLabelMenu(page, async () => {
    await expect(page.getByTestId('record-label-none')).toBeVisible()
  })
})

/**
 * **The act is over when the row says so**, not when the menu's own toggle
 * flips — and that is the domain showing through rather than a convenience.
 *
 * Taking a **retired** label off also takes it off the menu, because a retired
 * label is offered only while the record wears it: the toggle is *gone* rather
 * than unpressed, so a step that asserted `aria-pressed=false` inside the panel
 * would fail on exactly the case the asymmetry exists for. The tag row is the
 * observable a reader has either way.
 */
When('the reviewer gives the record the label {string}', async ({ page }, name: string) => {
  await withLabelMenu(page, async () => {
    await labelToggle(page, name).click()
  })
  await expect(page.getByTestId('record-label-row')).toContainText(name, { ignoreCase: true })
})

When('the reviewer takes the label {string} off the record', async ({ page }, name: string) => {
  await withLabelMenu(page, async () => {
    await labelToggle(page, name).click()
  })
  await expect(page.getByTestId('record-label-row')).not.toContainText(name, { ignoreCase: true })
})

/**
 * One row of the label menu, found by the name the reader typed.
 *
 * The toggle's testid carries the definition **id**, because that is what the
 * write sends — so this reaches it through the row's own text rather than
 * guessing the number. It is the one place in these steps where a locator is not
 * a bare testid, and it is scoped inside the panel's testid, so nothing outside
 * the menu can satisfy it.
 */
function labelToggle(page: Page, name: string): Locator {
  return page
    .getByTestId('record-label-panel')
    .locator('[data-testid^="record-label-toggle-"]')
    .filter({ hasText: name })
}

/**
 * Open the label menu, do something in it, and leave it closed — the shape
 * `withFilterPanel` has, and closed the same way and for the same Radix reason:
 * Escape has one meaning where a second click on the trigger races the dismiss
 * layer, and the step is over on the same two conditions the rest of these close-
 * waits use (`chrome.steps.ts` §followAppMenuItem, which carries the measured
 * account for all of them).
 */
async function withLabelMenu(page: Page, act: () => Promise<void>): Promise<void> {
  await page.getByTestId('record-label-control').click()
  await expect(page.getByTestId('record-label-panel')).toBeVisible()

  await act()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('record-label-panel')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      message: 'the closing label menu is still holding the page',
    })
    .not.toBe('none')
}

/* ── the review card and the records row, which only read ─────────────────── */

Then(
  'record {string} on the review wears the labels:',
  async ({ page }, rid: string, table: DataTable) => {
    await expect(page.getByTestId(`record-${rid}`).getByTestId('record-labels')).toHaveText(
      table.raw().map(([name]) => String(name)),
      { ignoreCase: true },
    )
  },
)

/** A verdict is what the review page is for; labelling is what the record page is for. */
Then('the review page offers no way to label a record', async ({ page }) => {
  await expect(page.getByTestId('record-label-control')).toHaveCount(0)
})

Then(
  'record {string} of retro {int} wears the labels:',
  async ({ page }, rid: string, retroId: number, table: DataTable) => {
    await expect(
      page.getByTestId(`records-row-${retroId}-${rid}`).getByTestId('records-row-label'),
    ).toHaveText(
      table.raw().map(([name]) => String(name)),
      { ignoreCase: true },
    )
  },
)

Then(
  'record {string} of retro {int} wears no labels',
  async ({ page }, rid: string, retroId: number) => {
    await expect(
      page.getByTestId(`records-row-${retroId}-${rid}`).getByTestId('records-row-label'),
    ).toHaveCount(0)
  },
)

/* ── attribute values on a record ─────────────────────────────────────────── */

function valueRow(page: Page, name: string): Locator {
  return page.getByTestId('record-attribute-list').locator('[data-testid^="record-attribute-"]', {
    has: page.getByTestId('record-attribute-name').and(page.getByText(name, { exact: true })),
  })
}

Then('the record carries the values:', async ({ page }, table: DataTable) => {
  const rows = table.raw()
  await expect(page.getByTestId('record-attribute-name')).toHaveText(
    rows.map(([name]) => String(name)),
  )
  await expect(page.getByTestId('record-attribute-type')).toHaveText(
    rows.map(([, type]) => String(type)),
  )
  await expect(page.getByTestId('record-attribute-value')).toHaveText(
    rows.map(([, , value]) => String(value)),
  )
})

Then('the record carries no values', async ({ page }) => {
  await expect(page.getByTestId('record-attribute-list')).toHaveCount(0)
})

/**
 * A `url` value is a link and everything else is the text it is — the same one
 * question the resolve's references are asked, through the same component, which
 * is what makes the two answer alike by construction.
 */
Then('the value {string} links to {string}', async ({ page }, name: string, href: string) => {
  await expect(valueRow(page, name).getByTestId('record-ref')).toHaveAttribute('href', href)
})

Then('the value {string} is not a link', async ({ page }, name: string) => {
  await expect(valueRow(page, name).getByTestId('record-ref')).toHaveCount(0)
})

Then('the value {string} is marked retired', async ({ page }, name: string) => {
  await expect(valueRow(page, name).getByTestId('record-attribute-retired')).toBeVisible()
})

When('the reviewer sets {string} to {string}', async ({ page }, name: string, value: string) => {
  await page.getByTestId('record-attribute-set').click()
  const panel = page.getByTestId('record-attribute-panel')
  await expect(panel).toBeVisible()

  await panel.getByTestId('record-attribute-pick').click()
  await page.locator('[data-testid^="record-attribute-option-"]').filter({ hasText: name }).click()
  await panel.getByTestId('record-attribute-value-input').fill(value)
  await panel.getByTestId('record-attribute-save').click()
})

When('the reviewer clears the value {string}', async ({ page }, name: string) => {
  await valueRow(page, name).getByTestId('record-attribute-clear').click()
})

/**
 * The type's own rule is the domain's, so the page sends what was typed and
 * shows the sentence that came back. Without this line a refused write would do
 * nothing visible at all, which is the branch this assertion exists for.
 */
Then('the value panel refuses with {string}', async ({ page }, fragment: string) => {
  await expect(page.getByTestId('record-attribute-refusal')).toContainText(fragment)
})

Then('the record page offers the attribute {string}', async ({ page }, name: string) => {
  await withValuePanel(page, async () => {
    await page.getByTestId('record-attribute-pick').click()
    await expect(
      page.locator('[data-testid^="record-attribute-option-"]').filter({ hasText: name }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

Then('the record page does not offer the attribute {string}', async ({ page }, name: string) => {
  await withValuePanel(page, async () => {
    await page.getByTestId('record-attribute-pick').click()
    await expect(
      page.locator('[data-testid^="record-attribute-option-"]').filter({ hasText: name }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

async function withValuePanel(page: Page, act: () => Promise<void>): Promise<void> {
  await page.getByTestId('record-attribute-set').click()
  await expect(page.getByTestId('record-attribute-panel')).toBeVisible()

  await act()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('record-attribute-panel')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents), {
      message: 'the closing value panel is still holding the page',
    })
    .not.toBe('none')
}

/* ── the label filter ─────────────────────────────────────────────────────── */

When('the reviewer filters to the label {string}', async ({ page }, name: string) => {
  await withFilterPanel(page, async () => {
    const option = page.getByTestId(`records-filter-label-${name}`)
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  })
})

/**
 * A label nobody has applied is not a question anyone can ask on this page, so
 * the whole group is absent rather than empty — the same call the review bar
 * makes about the verdict nobody can give any more.
 */
Then('the filters do not offer a label group', async ({ page }) => {
  await withFilterPanel(page, async () => {
    await expect(page.getByTestId('records-filter-label-group')).toHaveCount(0)
  })
})
