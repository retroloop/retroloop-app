/**
 * A record: one captured friction inside a revision (data-model.md §Record).
 *
 * Named `RetroRecord` rather than `Record` so it never shadows TypeScript's
 * built-in `Record<K, V>` utility type.
 *
 * Three groups, with different lifetimes:
 * - identity (`rid`, `num`) — minted at first appearance in the retrospective,
 *   stable across every later revision, never reused, never renumbered;
 * - narrative — AI-authored and immutable; it changes only by the record
 *   appearing again in a new revision;
 * - proposed defaults — the AI's suggested values for the fields the human
 *   decides. The human's values are what count; these only seed them.
 *
 * The narrative comes in **two shapes** and always exactly one of them: one to
 * three `solutions` on every record filed since the multi-solution
 * design, and one `agreedDirection` plus one `footprint` on every record filed
 * before it. Revisions are immutable, so both are read forever and only the
 * first is ever written.
 */
export type RecordType = 'issue' | 'feature'

/** Who raised a record / whom it primarily costs (v2 semantics). */
export type Party = 'human' | 'ai'

export type Severity = 1 | 2 | 3 | 4 | 5

/**
 * A ceiling, not a target — what a stored level can *be*.
 *
 * The three named values are legacy: they can no longer be chosen or proposed,
 * and early retrospectives hold two of them. They stay in this type because
 * human data is append-only — a reader that could not name them could not
 * render the history it is looking at.
 */
export type SolutionLevel = 1 | 2 | 3 | 4 | 5 | 'none' | 'upstream' | 'undecided'

/** What a new decision or proposal may be: strictly 1–5. */
export type SolutionLevelInput = 1 | 2 | 3 | 4 | 5

export type Involvement = 'autonomous' | 'pull-request' | 'interactive' | 'other' | 'undecided'

/** Both halves are required; `context` is the quote's optional surrounding. */
export type HumanWords = {
  readonly verbatim: string
  readonly cleaned: string
  readonly context: string | undefined
}

/** Five-whys: 1–5 `whys`, a non-empty `root` (the schema validates the shape, not the quality). */
export type RootCause = {
  readonly whatHappened: string
  readonly whys: readonly string[]
  readonly root: string
}

/**
 * What the AI proposes about the dials the human turns.
 *
 * **There is no `solutionLevel` here on a record with solutions**, because there
 * is nothing for one to be: the level a record proposes is the recommended
 * solution's, and `proposedLevel()` below is the one place that says so. A
 * second, authored copy could contradict the array it summarises, and a copy
 * stored on the way in would make the record no longer a revision file — which
 * is what `revision get`'s `content` promises it is (SKILL.md's recovery step).
 */
export type ProposedDefaults = {
  readonly severity: Severity
  readonly involvement: Involvement
}

/** The same, on a record filed when the level was a proposal of its own. */
export type LegacyProposedDefaults = ProposedDefaults & {
  readonly solutionLevel: SolutionLevel
}

/**
 * One way the AI proposes to solve the record: it deep-dives the friction and
 * proposes up to three of these.
 *
 * A record carries one to three of these, sorted from the lowest level to the
 * highest, with exactly one marked `recommended` — all three enforced by
 * `revision-input.schema.ts`, because the order is what "Solution 1" *means*
 * and a human picking one by position needs the positions to be stable.
 *
 * `footprint` is per-solution because the files a level-2 tune touches are not
 * the files a level-4 contract change touches — the footprint is a property of
 * the solution, which is why the record no longer has one of its own.
 */
export type Solution = {
  /** Bold-lead bullets, the markdown subset. */
  readonly bullets: string
  /** The tagged file tree, or the literal `"none"` — not markdown. */
  readonly footprint: string
  readonly level: SolutionLevelInput
  /** Exactly one solution of a record has this. */
  readonly recommended: boolean
}

/** The AI-authored fields both record shapes carry, whatever they propose. */
type SharedNarrative = {
  readonly title: string
  readonly type: RecordType
  readonly problem: string
  readonly humanWords: readonly HumanWords[]
  readonly rootCause: RootCause
  /**
   * **The evidence the AI looked at while it was diagnosing** — the log lines,
   * the timings, the commands it ran and what they answered — written as
   * markdown in the same subset every other prose field on a record uses.
   *
   * Required of every record filed from here on (`revision-input.schema.ts`) and
   * `undefined` on every record filed before it, exactly the way `solutions` is
   * absent from a record filed before solutions existed: revisions are immutable
   * and nothing backfills one. A reader that has to render a record therefore
   * asks whether it has any, and shows nothing where it has none.
   */
  readonly diagnosticData: string | undefined
  /** Free text or the literal `"none"` — never absent. */
  readonly workaround: string
  readonly requester: Party
  readonly impacts: Party
}

/**
 * The shape every revision written before the solutions change carries: one
 * narrative direction and one footprint for the whole record.
 *
 * Nothing may author it any more — the write path takes `solutions` and nothing
 * else — and it is not deprecated either, because the revisions that hold it are
 * immutable and existing retrospectives are full of them. A reader that
 * could not name this shape could not render the history it is looking at, which
 * is the same rule the legacy solution levels obey.
 */
export type LegacyNarrative = SharedNarrative & {
  readonly agreedDirection: string
  readonly footprint: string
  readonly solutions?: undefined
}

/** What a revision written from here on carries: one to three proposed solutions. */
export type SolutionsNarrative = SharedNarrative & {
  readonly solutions: readonly Solution[]
  readonly agreedDirection?: undefined
  readonly footprint?: undefined
}

/**
 * The AI-authored half of a record. This — together with the identity fields —
 * is what the decision carry-over hash is taken over: a decision binds to
 * the narrative it was made against, not to the AI's proposed defaults.
 *
 * **A record has exactly one of the two shapes**, and the union says so rather
 * than leaving four fields all optional: the absent halves are typed
 * `?: undefined`, so `record.solutions === undefined` narrows to the legacy
 * branch and every reader that assumed a `string` fails to compile until it has
 * said which shape it is reading.
 */
export type RecordNarrative = LegacyNarrative | SolutionsNarrative

export type RecordIdentity = {
  /** Stable slug, `r-<words>`; minted once per retrospective, never reused. */
  readonly rid: string
  /** Display number, dense per retrospective, never renumbered. */
  readonly num: number
}

/** A record as every revision before the solutions change stored it. */
export type LegacyRecord = RecordIdentity &
  LegacyNarrative & {
    readonly defaults: LegacyProposedDefaults
  }

/** A record as every revision written from here on stores it. */
export type SolutionsRecord = RecordIdentity &
  SolutionsNarrative & {
    readonly defaults: ProposedDefaults
  }

/**
 * A record, in whichever of the two shapes it was written in.
 *
 * The union is the whole compatibility story in one type: a reader that says
 * `record.agreedDirection` gets `string | undefined` and has to decide what it
 * means by that, and a reader that narrows on `record.solutions` gets the branch
 * it narrowed to with every field required.
 */
export type RetroRecord = LegacyRecord | SolutionsRecord

/**
 * The narrative sections a comment thread can anchor to.
 *
 * `solutions` is one anchor for the whole block rather than one per solution: a
 * comment that is about the second proposal says so in its own words, and an
 * enum grown per array element is an enum that has to be migrated every time the
 * array can hold one more.
 *
 * `direction` and `footprint` stay, forever, and are not dead entries. Existing
 * stores carry threads anchored to both, human comments are append-only,
 * and the export contract requires a component for every thread — so a value
 * removed here would make documents already written unrepresentable. Nothing
 * anchors a *new* thread to them, because a record with `solutions` has no such
 * section to point at.
 */
export const RECORD_SECTIONS = [
  'title',
  'problem',
  'human_words',
  'root_cause',
  'workaround',
  'direction',
  'footprint',
  'solutions',
  'defaults',
] as const

export type RecordSection = (typeof RECORD_SECTIONS)[number]

/**
 * Which solution the AI recommends, **1-based** — the number the reader sees in
 * "Solution 2", not an array index.
 *
 * The schema guarantees exactly one flag, so the fallback is for a blob no write
 * path produced: a record read back with no recommendation falls to the first
 * solution, which is the lowest-level one, rather than leaving a reader with
 * nothing to open.
 */
export function recommendedSolution(solutions: readonly Solution[]): number {
  const index = solutions.findIndex((solution) => solution.recommended)
  return index === -1 ? 1 : index + 1
}

/**
 * The level a set of solutions proposes: the recommended one's.
 *
 * Same fallback reasoning as above — an empty array cannot come from the write
 * path, and a reader still needs a level to render.
 */
export function proposedSolutionLevel(solutions: readonly Solution[]): SolutionLevelInput {
  return solutions[recommendedSolution(solutions) - 1]?.level ?? 1
}

/**
 * **The level a record proposes**, whichever shape it was filed in — the one
 * function every reader of "what did the AI suggest as the ceiling" goes
 * through.
 *
 * On the old shape it is the field the draft authored. On the new one it is the
 * recommended solution's level, which is the same judgment expressed once
 * instead of twice. Consumers keep the type they always had, so the wire's
 * `proposed.solutionLevel`, the pending view and the enum labels typed off them
 * are untouched by the shape change.
 */
export function proposedLevel(record: RetroRecord): SolutionLevel {
  return record.solutions === undefined
    ? record.defaults.solutionLevel
    : proposedSolutionLevel(record.solutions)
}
