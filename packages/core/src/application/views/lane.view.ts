import {
  type RetroRecord,
  recommendedSolution,
  type SolutionLevel,
} from '#domain/models/record.model'
import type { EffectiveDecision } from '#domain/services/record-state.service'

/**
 * **The fix, as the side that is about to do it needs to read it**: which of the
 * record's proposals is in play, what level of change it is, one line naming it,
 * the whole of it, and the files it touches as a list rather than as a paragraph.
 *
 * It is a projection and not a new fact — every field here is derived from the
 * record and the verdict in effect, and nothing is stored. It lives beside the
 * lane use case rather than inside it because both derivations are pure string
 * work over a record that may be in either of the two shapes this product reads
 * (`record.model.ts`), and string work with a "first bold lead, else first line"
 * rule in it is exactly the kind of thing that wants its own tests.
 */
export type LaneSolutionView = {
  /** 1-based, the number the reader sees in "Solution 2". Always 1 on a legacy record. */
  readonly index: number
  readonly level: SolutionLevel
  /** One line naming the fix — the bold lead if the bullets carry one. */
  readonly title: string
  /** The whole proposal, as authored: the solution's bullets, or the legacy direction. */
  readonly body: string
  /** The files it touches, one per entry, `[]` where it touches none. */
  readonly footprint: readonly string[]
}

/**
 * The solution in effect on a record, whichever shape it was filed in.
 *
 * **On a record with solutions** the index is the human's pick once they have
 * made one and the AI's recommendation until then — which is what
 * `effectiveDecision` already resolves, so this reads that rather than the
 * decision row, and cannot show a proposal the review page does not.
 *
 * **On a legacy record** there is one direction and one footprint for the whole
 * record, so the row is that: index 1, the level the draft authored, and the
 * direction as both title (its first line) and body. Those records are not an
 * edge — the owner's first five retrospectives are full of them, and a lane that
 * skipped them would skip his history.
 */
export function laneSolution(record: RetroRecord, decision: EffectiveDecision): LaneSolutionView {
  if (record.solutions === undefined) {
    return {
      index: 1,
      level: decision.solutionLevel,
      title: firstLine(record.agreedDirection),
      body: record.agreedDirection,
      footprint: laneFootprint(record.footprint),
    }
  }

  const recommended = recommendedSolution(record.solutions)
  const picked = decision.selectedSolution ?? recommended
  /**
   * A pick the array cannot answer for cannot come from the write path — the
   * decision schema validates the index against the record. The fallback is for
   * a row an older binary wrote, and it falls to the recommendation rather than
   * to nothing: the reader is on their way to do the work, and an empty block
   * would tell them less than the AI's own suggestion does.
   */
  const index = record.solutions[picked - 1] === undefined ? recommended : picked
  const solution = record.solutions[index - 1]
  if (solution === undefined) {
    // Unreachable: `recommendedSolution` falls back to 1, and the schema refuses
    // a record with no solutions at all. Saying so beats a row whose fix is blank.
    throw new Error(`record ${record.rid} carries no solution ${index}`)
  }

  return {
    index,
    level: solution.level,
    title: leadOf(solution.bullets),
    body: solution.bullets,
    footprint: laneFootprint(solution.footprint),
  }
}

/**
 * The files a solution touches, one per entry.
 *
 * The stored form is D5's tagged tree — free text, one path per line, usually
 * bulleted — or the literal `none`. A consumer that wanted to *do* anything with
 * it (open the files, check whether two records touch the same one, count them)
 * would otherwise each write this split, and would each get the bullets and the
 * literal slightly differently.
 *
 * **`none` is an empty list rather than a list holding the word**, because that
 * is what it means: a caller filtering the literal out at every call site is a
 * caller doing this function's job. A path that is genuinely called `none.ts` is
 * not the literal — the comparison is against the whole text, trimmed.
 */
export function laneFootprint(footprint: string): readonly string[] {
  const whole = footprint.trim()
  if (whole.length === 0 || whole === 'none') return []

  return whole
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}

/**
 * The bold lead of a bullet block, which is the one line that names the fix.
 *
 * Bold-lead bullets are D5's form 1 — *"**Write the holder PID.** Check liveness
 * before waiting"* — so the lead is the sentence the author wrote to be read
 * first. A block that carries none falls back to its first line: this is a
 * heading for a list, and a heading that said nothing would leave a queue of
 * rows all labelled the same way.
 */
function leadOf(bullets: string): string {
  const bold = /\*\*(.+?)\*\*/s.exec(bullets)
  return bold?.[1]?.trim() ?? firstLine(bullets)
}

/** The first line with anything on it, with a bullet marker taken off. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line
      .trim()
      .replace(/^[-*]\s+/, '')
      .trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}
