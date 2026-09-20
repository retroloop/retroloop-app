import { expect, test } from '@playwright/test'
import { type RecordSection, SECTION_TITLES } from '../src/lib/enum-labels'

/**
 * The section vocabulary, written down where a reviewer can read it — the same
 * shape as the procedure-set meta-test beside it, and for the same reason: the
 * map is what the record card's headings and the comments panel's anchor lines
 * are both built from, so a section that grew a second name would show one word
 * on the card and another in the panel.
 *
 * `RecordSection` is computed from `AppRouter`, which takes it from
 * `recordSectionSchema`, which is `z.literal([...RECORD_SECTIONS])` — so this
 * list is not a second opinion about the domain's sections, it is the domain's
 * own answer. A section added to `RECORD_SECTIONS` fails the compile here and in
 * `SECTION_TITLES` before this test ever runs.
 *
 * Nine, and the word and the list are checked against each other by the reader
 * alone — so when one moves, move the other. `direction` and `footprint` are two
 * of the nine and are not dead: a record filed before the multi-solution design
 * renders both, and the threads already filed on them keep their anchor forever.
 */
const EXPECTED_SECTIONS = [
  'title',
  'problem',
  'human_words',
  'root_cause',
  'workaround',
  'direction',
  'footprint',
  'solutions',
  'defaults',
] as const satisfies readonly RecordSection[]

/** Empty exactly while the list above names every section a comment can hang on. */
type Uncovered = Exclude<RecordSection, (typeof EXPECTED_SECTIONS)[number]>

test('every section a comment can be filed under has one display title', () => {
  // A section added to the domain and not to this list makes `Uncovered` a real
  // union, and `Uncovered[]` stops being assignable to `never[]`.
  const uncovered: never[] = [] as Uncovered[]
  expect(uncovered).toEqual([])

  // And the map that actually ships has those keys and no others.
  expect(Object.keys(SECTION_TITLES).sort()).toEqual([...EXPECTED_SECTIONS].sort())

  // Every one of them says something: a section whose title were the empty
  // string would render an anchor line with a hole in it.
  for (const section of EXPECTED_SECTIONS) {
    expect(SECTION_TITLES[section].length, `${section} has no display title`).toBeGreaterThan(0)
  }
})
