import { z } from 'zod'
import {
  involvementSchema,
  partySchema,
  recordTypeSchema,
  ridSchema,
  severitySchema,
  solutionLevelInputSchema,
} from '#application/schemas/enums.schema'
import { parseOrThrow } from '#application/schemas/parse'

/**
 * The contract the AI authors a revision against — `retro schema revision`.
 *
 * **It enforces exactly the mechanical half of D5 and nothing else**: shape,
 * enums in range, required fields present, the verbatim/cleaned quote twin, a
 * five-whys chain of 1–5 links with a root, a workaround that is present (free
 * text or the literal `"none"`), and identity that cannot collide inside one
 * revision.
 *
 * The instructed half stays out on purpose — bold-lead bullet phrasing, the
 * "computable cost" wording, whether a root cause is systemic rather than
 * behavioural, the footprint tree's layout, quote-context judgment. A validator
 * for those would be theater: it would pass garbage that satisfies a regex and
 * fail good writing that does not.
 *
 * Two mechanical D5 rules are *not* here because a single revision cannot see
 * them — no `rid` reuse across revisions, no renumbering, `num` dense per
 * retrospective. They need the retrospective's history, so `CreateRevisionUseCase`
 * checks them and raises the same `ValidationError`.
 */
const nonEmpty = (what: string) => z.string().trim().min(1, `${what} must not be empty`)

export const humanWordsSchema = z.strictObject({
  /** The human's words as spoken. */
  verbatim: nonEmpty('verbatim'),
  /** The same words with dictation garbles fixed — both halves required (D5). */
  cleaned: nonEmpty('cleaned'),
  context: z.string().optional(),
})

export const rootCauseSchema = z.strictObject({
  whatHappened: nonEmpty('whatHappened'),
  whys: z
    .array(nonEmpty('why'))
    .min(1, 'the five-whys chain needs at least one why')
    .max(5, 'the five-whys chain holds at most five whys'),
  root: nonEmpty('root'),
})

/**
 * One proposed solution, in the multi-solution design.
 *
 * Presence is mechanical here as everywhere: that `bullets` leads each bullet
 * with a few bold words, and that `footprint` is a tagged tree rather than a
 * paragraph, are instructed in SKILL.md and unvalidated for the same reason the
 * footprint's layout always was — a regex for those would pass garbage and fail
 * good writing.
 */
export const solutionSchema = z.strictObject({
  bullets: nonEmpty('bullets'),
  /** The tagged tree, or the literal `"none"` — its layout is instructed only (D5). */
  footprint: nonEmpty('footprint'),
  level: solutionLevelInputSchema,
  recommended: z.boolean(),
})

/**
 * The three rules a set of solutions obeys, and why each is mechanical rather
 * than instructed.
 *
 * - **One to three.** The AI deep-dives and proposes up to three solutions; in
 *   some places only one or two make sense, when it is a quick fix. One is a
 *   real answer; a fourth is not.
 * - **Sorted from the lowest level to the highest.** The order is not
 *   presentation — "Solution 2" is a *position*, and the human's selection is
 *   stored as one, so a draft that arrives out of order would rename the thing
 *   the reviewer picked. Ties keep the order they were given.
 * - **Exactly one recommended.** The reviewer gets one indication of which
 *   solution the AI recommends — none leaves the reviewer without the default
 *   tab, and two is the AI declining to make the call it was asked for.
 */
export const solutionsSchema = z
  .array(solutionSchema)
  .min(1, 'a record proposes at least one solution')
  .max(3, 'a record proposes at most three solutions')
  .superRefine((solutions, ctx) => {
    const recommended = solutions.filter((solution) => solution.recommended).length
    if (recommended !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `exactly one solution is the recommended one; ${recommended} are marked`,
      })
    }

    solutions.forEach((solution, index) => {
      const previous = solutions[index - 1]
      if (previous !== undefined && previous.level > solution.level) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'level'],
          message: `solutions run from the lowest level to the highest; L${solution.level} follows L${previous.level}`,
        })
      }
    })
  })

/**
 * What the AI proposes about the two dials the human turns.
 *
 * **`solutionLevel` is not here any more.** A record proposes levels one per
 * solution now, and the level it *recommends* is the recommended solution's —
 * read through `proposedLevel()` rather than authored twice, because two
 * authored copies of one judgment is a draft that can contradict itself.
 *
 * `involvement` is untouched: `undecided` remains a real answer there, "the
 * solving side asks first".
 */
export const proposedDefaultsSchema = z.strictObject({
  severity: severitySchema,
  involvement: involvementSchema.default('undecided'),
})

/**
 * **`agreedDirection` and `footprint` are not here any more.** They were the
 * record's one narrative direction and the one tree of files it touched, and
 * both are per-solution now. A draft that still sends either is rejected by
 * `strictObject` as an unrecognized key, which is the write path narrowing;
 * every revision already written keeps them, because a read path never narrows
 * (data-model.md §Hold, *"narrow the write path, never the read path"*).
 */
export const recordInputSchema = z.strictObject({
  rid: ridSchema,
  num: z.int().positive(),
  title: nonEmpty('title'),
  type: recordTypeSchema,
  problem: nonEmpty('problem'),
  humanWords: z.array(humanWordsSchema),
  rootCause: rootCauseSchema,
  /**
   * The evidence behind the diagnosis, as markdown — **required, and with no
   * `"none"` escape hatch.**
   *
   * That is the one place it parts from `workaround` below, which admits the
   * literal `"none"`: a record with no workaround is a true state of the world —
   * there was nothing the human could have done — whereas a record filed with
   * nothing looked at is a record that should not have been filed. Presence is
   * all that is checked, as everywhere in this file: what counts as evidence is
   * instructed in SKILL.md, and a regex for it would pass a paragraph of
   * assertion and fail a pasted log.
   */
  diagnosticData: nonEmpty('diagnosticData'),
  /** Free text or the literal `"none"` — never absent (D5). */
  workaround: nonEmpty('workaround'),
  solutions: solutionsSchema,
  requester: partySchema,
  impacts: partySchema,
  defaults: proposedDefaultsSchema,
})

/**
 * The retrospective's name, as the AI proposes it.
 *
 * A flat list of retros needs something to read: "Retro #1, Retro #2" is the bare
 * ticket number this product avoids everywhere else. It is optional
 * because a retrospective without one still works — the reader falls back to
 * "Retro #n — <cwd basename>" — and capped at 80 characters because it is a name
 * on a row, not a summary. The latest revision's title is the retro's title.
 */
export const revisionTitleSchema = z
  .string()
  .trim()
  .min(1, 'title must not be empty')
  .max(80, 'title must be at most 80 characters')

export const revisionInputSchema = z
  .strictObject({
    title: revisionTitleSchema.optional(),
    records: z.array(recordInputSchema),
  })
  .superRefine((revision, ctx) => {
    const seenRids = new Set<string>()
    const seenNums = new Map<number, string>()

    revision.records.forEach((record, index) => {
      if (seenRids.has(record.rid)) {
        ctx.addIssue({
          code: 'custom',
          path: ['records', index, 'rid'],
          message: `rid ${record.rid} appears twice in this revision`,
        })
      }
      seenRids.add(record.rid)

      const owner = seenNums.get(record.num)
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['records', index, 'num'],
          message: `num ${record.num} is already used by ${owner} in this revision`,
        })
      }
      seenNums.set(record.num, record.rid)
    })
  })

export type HumanWordsInput = z.infer<typeof humanWordsSchema>
export type SolutionInput = z.infer<typeof solutionSchema>
export type RecordInput = z.infer<typeof recordInputSchema>
export type RevisionInput = z.infer<typeof revisionInputSchema>

/** Throws `ValidationError` with every issue attached. */
export function parseRevisionInput(input: unknown): RevisionInput {
  return parseOrThrow(revisionInputSchema, input, 'revision')
}
