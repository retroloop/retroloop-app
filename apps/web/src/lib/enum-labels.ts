import type { AppRouterInputs, AppRouterOutputs } from '@retro/api'

/**
 * The decision enums. Solution level and involvement are written as
 * **"what — why"**; severity leads with the number and carries a short
 * description behind it — `SEV1 — highest — halts everything` — and the block
 * above `SEVERITIES` says how it arrived at that shape.
 *
 * The "what — why" strings are **canonical**: `docs/design/data-model.md` §Enum
 * option labels carries them verbatim from v2's `ticket-schemas.md`, and the
 * standing rule is that the explanatory half is never dropped for brevity — a
 * two-line wrap is acceptable, a truncation is not. A UI may subset the values;
 * it may never contradict a label or its meaning. Change them here only when
 * that file changes.
 *
 * Solution level is the one enum that comes in two lists, and the split is the
 * subsetting rule above being used rather than an exception to it: `none`,
 * `upstream` and `undecided` were cut from what anyone may choose, and retro 1
 * holds two of them. So the offered list is five and the readable list is
 * eight — with the cut values keeping the labels they always had, because what
 * they meant when they were chosen has not changed.
 *
 * Every option is `name` + `rest`, and the label is their concatenation. The
 * split is not decoration: solution level renders as a radio list with the level
 * *name* bold and its definition after it, so the boundary has to be data rather
 * than something the renderer guesses at.
 *
 * Severity runs **1 highest, 5 lowest**, and its rows are anchors rather than
 * thresholds — frequency folds into the judgment, which is why there is no
 * separate recurrence field. Solution level is a **ceiling, not a target**, and
 * is chosen before involvement.
 */

type Decision = AppRouterOutputs['records']['get']['decision']

export type Severity = Decision['severity']
/** Every level a stored decision can hold, the three legacy ones included. */
export type SolutionLevel = Decision['solutionLevel']
/** The five a reviewer may choose — the router's own input enum. */
export type SolutionLevelInput = NonNullable<
  AppRouterInputs['decisions']['record']['solutionLevel']
>
export type Involvement = Decision['involvement']

export type Option<TValue> = {
  readonly value: TValue
  /** The part that renders bold in a radio list: the anchor, the level, the mode. */
  readonly name: string
  /** The rest of the canonical label, separator included, so the two rejoin exactly. */
  readonly rest: string
}

/**
 * **Severity is written the other way round from the two below it** — the
 * number leads, the explanation follows — and it took two iterations to land
 * there.
 *
 * It is the one enum addressed *by number* — "sev 4", "a sev 1" — and
 * generalising the "what — why" rule to all three enums buried that number
 * under a sentence that had to be read past on every decision. The labels
 * became `SEV1` … `SEV5` and nothing else.
 *
 * A follow-up refines it, after one real review of the compact-only select: the
 * labels for SEV1, SEV2, SEV3 etc. needed a descriptive part too, reading as
 * SEV1 - Some description, and the label clarifies that SEV1 is the highest
 * severity. That correction had overshot — the fix for verbose labels deleted
 * the information instead of demoting it — so the description comes back
 * **behind** the number, short, and SEV1 says outright that it is the top of
 * the scale. The direction is nobody's intuition: comparable products disagree
 * about which end is worst.
 *
 * `rest` is the **lead of that severity's rubric row**, and nothing invented:
 * the rows are the canonical rubric of `docs/design/data-model.md` §Enum option
 * labels — what a severity *means*, and what an AI proposing one is judging
 * against — and the label carries the first clause of each.
 *
 * 1. halts everything — the tool unusable, no progress possible; no workaround
 * 2. blocks a major flow — progress only through a costly manual workaround
 * 3. degrades the work — turns, tokens or time lost every time it is hit
 * 4. minor friction — an extra step, a cosmetic wart; cheap workaround
 * 5. nice-to-have — not time-critical, an improvement idea more than a problem
 */
export const SEVERITIES: readonly Option<Severity>[] = [
  { value: 1, name: 'SEV1', rest: ' — highest — halts everything' },
  { value: 2, name: 'SEV2', rest: ' — blocks a major flow' },
  { value: 3, name: 'SEV3', rest: ' — degrades the work' },
  { value: 4, name: 'SEV4', rest: ' — minor friction' },
  { value: 5, name: 'SEV5', rest: ' — nice-to-have' },
]

/** The five a reviewer is offered. Order and wording are canonical. */
export const SOLUTION_LEVELS: readonly Option<SolutionLevelInput>[] = [
  {
    value: 1,
    name: 'Level 1 — words only',
    rest: ': guidance text; nothing executes it, nothing conforms to it',
  },
  {
    value: 2,
    name: 'Level 2 — tune existing',
    rest: ': behavior change inside artifacts that already exist',
  },
  {
    value: 3,
    name: 'Level 3 — add surface',
    rest: ': something new that everything existing can safely ignore',
  },
  {
    value: 4,
    name: 'Level 4 — change contracts',
    rest: ': others must conform; consumers updated and old data shimmed in the same change',
  },
  {
    value: 5,
    name: 'Level 5 — open-ended',
    rest: ': emergent, autonomous, or not cleanly undoable',
  },
]

/**
 * The three later cut from selection — never offered, always readable.
 *
 * Retro 1 holds two of them, and human data is append-only: a page that could
 * not name `upstream` would render the record it is showing as a bare word, or
 * as nothing. These labels are the same canonical strings they always were, and
 * they stay here for as long as a decision anywhere carries one.
 */
export const LEGACY_SOLUTION_LEVELS: readonly Option<SolutionLevel>[] = [
  { value: 'none', name: 'None', rest: ' — approve building nothing' },
  { value: 'upstream', name: 'Upstream', rest: ' — file elsewhere; nothing built here' },
  {
    value: 'undecided',
    name: 'Undecided',
    rest: ' — no level approved yet; the solving side asks',
  },
]

/** Everything a stored level can be, for the read-only rendering. */
export const READABLE_SOLUTION_LEVELS: readonly Option<SolutionLevel>[] = [
  ...SOLUTION_LEVELS,
  ...LEGACY_SOLUTION_LEVELS,
]

export const INVOLVEMENTS: readonly Option<Involvement>[] = [
  { value: 'autonomous', name: 'No involvement', rest: ' — fully autonomous' },
  { value: 'pull-request', name: 'Pull request', rest: ' — human reviews before merge' },
  { value: 'interactive', name: 'Interactive session', rest: ' — human works the fix live' },
  { value: 'other', name: 'Other', rest: ' — the note says what' },
  { value: 'undecided', name: 'Undecided', rest: ' — the solving side asks first' },
]

/**
 * The section a comment can be filed under, as the router names it. It is
 * `RECORD_SECTIONS` at one remove: `threadSchema.section` is
 * `recordSectionSchema`, which is `z.literal([...RECORD_SECTIONS])`, so this
 * union cannot drift from the domain's list without the compiler saying so.
 */
export type RecordSection = NonNullable<AppRouterOutputs['threads']['list'][number]['section']>

/**
 * What a section is **called on screen**, in one place because two surfaces now
 * name the same thing.
 *
 * They did not use to. The card wrote its own headings at the `Section` call
 * sites and nothing else needed them, because a comment was rendered inside the
 * section it answered — the reader could see which section they were in. Then
 * every comment moved to the side panel, so a human can see all comments in one
 * place, and a thread that has left its section has to say which section it
 * left. Two copies of "Agreed direction" is one copy too many.
 *
 * Keyed by `RecordSection`, so the compiler refuses a map missing one of the
 * router's sections or inventing one it does not have; `test/section-titles.spec.ts`
 * writes the key set down where a reviewer can read it.
 *
 * `title` has no heading on the card — a record's title is its `<h2>`, not one
 * of its sections — but it is a section a comment can be filed under, so the
 * panel needs a word for it.
 *
 * `direction` and `footprint` keep their words for the same reason `solutions`
 * gained one: a record filed before the multi-solution design still renders
 * those two sections, and a thread filed on one still has to say which section
 * it left.
 */
export const SECTION_TITLES: Readonly<Record<RecordSection, string>> = {
  title: 'Title',
  problem: 'Problem',
  human_words: 'Human words',
  root_cause: 'Root cause',
  workaround: 'Workaround',
  direction: 'Agreed direction',
  footprint: 'Footprint',
  solutions: 'Solutions',
  defaults: 'Decision',
}

export function optionFor<TValue>(
  options: readonly Option<TValue>[],
  value: TValue,
): Option<TValue> | undefined {
  return options.find((candidate) => candidate.value === value)
}

/** The whole canonical string, both halves, never abbreviated. */
export function labelOf<TValue>(options: readonly Option<TValue>[], value: TValue): string {
  const option = optionFor(options, value)
  return option === undefined ? String(value) : `${option.name}${option.rest}`
}
