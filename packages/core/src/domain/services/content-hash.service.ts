import { createHash } from 'node:crypto'
import {
  RECORD_SECTIONS,
  type RecordSection,
  type RetroRecord,
  type Solution,
} from '#domain/models/record.model'

/** What `canonicalJson` accepts: anything a record is made of. */
export type JsonLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonLike[]
  | { readonly [key: string]: JsonLike }

/**
 * Deterministic JSON: object keys sorted, `undefined` members omitted so an absent
 * field and an explicitly-undefined one hash alike. Two structurally equal records
 * always produce the same string, whatever order their fields were built in.
 */
export function canonicalJson(value: JsonLike): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value as { readonly [key: string]: JsonLike })
    .filter((entry): entry is [string, JsonLike] => entry[1] !== undefined)
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
  return `{${entries.join(',')}}`
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The solutions array as content: every field of it, in the order it was given. */
function solutionsContent(solutions: readonly Solution[] | undefined): JsonLike {
  return solutions?.map((solution) => ({
    bullets: solution.bullets,
    footprint: solution.footprint,
    level: solution.level,
    recommended: solution.recommended,
  }))
}

/**
 * The content a decision binds to (D2): identity + narrative, deliberately **not**
 * the AI's proposed defaults — those only seed the human's own values, so the AI
 * re-proposing a different severity must not invalidate a human decision.
 *
 * **The solutions array is narrative, and it is in here.** That is a departure
 * from how the AI's *proposed level* has always been treated, and the reason is
 * that the human's answer to a solutions record is an **index into this array**.
 * A level is self-describing — "the human approved a level 2" survives the AI
 * re-proposing a 4 — but "the human picked solution 2" says nothing at all once
 * solution 2 is a different proposal. So any change to any solution resets the
 * record to pending and the reviewer picks again, against what is now in front
 * of them. `severity` and `involvement` are unaffected and stay out.
 *
 * **A legacy record hashes to exactly the bytes it always did.** `canonicalJson`
 * drops undefined members, so `solutions` simply is not a key on a record that
 * has no solutions, and `agreedDirection`/`footprint` are not keys on a record
 * that has no direction. Every decided record in the owner's five retrospectives
 * keeps its decision across the upgrade — `legacy-record-shape.test.ts` locks the
 * hash of a real one against the constant it had before this change.
 */
export function recordContent(record: RetroRecord): JsonLike {
  return {
    rid: record.rid,
    num: record.num,
    title: record.title,
    type: record.type,
    problem: record.problem,
    humanWords: record.humanWords.map((words) => ({
      verbatim: words.verbatim,
      cleaned: words.cleaned,
      context: words.context,
    })),
    rootCause: {
      whatHappened: record.rootCause.whatHappened,
      whys: [...record.rootCause.whys],
      root: record.rootCause.root,
    },
    workaround: record.workaround,
    agreedDirection: record.agreedDirection,
    footprint: record.footprint,
    solutions: solutionsContent(record.solutions),
    requester: record.requester,
    impacts: record.impacts,
  }
}

/** Carry-over key: unchanged content keeps its decision, changed content goes pending. */
export function hashRecordContent(record: RetroRecord): string {
  return sha256(canonicalJson(recordContent(record)))
}

/**
 * The record content behind each comment-anchor section (D8), used to highlight
 * what changed between two appearances of a record (KC-0012).
 *
 * The section enum has no slot for `type`, `requester` and `impacts`, so they ride
 * with the part of the record they qualify: `type` with the headline, `requester`
 * and `impacts` with the problem statement. Without that they could change without
 * any section lighting up.
 */
export function recordSectionContent(record: RetroRecord, section: RecordSection): JsonLike {
  switch (section) {
    case 'title':
      return { title: record.title, type: record.type }
    case 'problem':
      return { problem: record.problem, requester: record.requester, impacts: record.impacts }
    case 'human_words':
      return record.humanWords.map((words) => ({ ...words }))
    case 'root_cause':
      return { ...record.rootCause, whys: [...record.rootCause.whys] }
    case 'workaround':
      return record.workaround
    // The two legacy anchors answer for a record that has them and for nothing
    // else: on a solutions record both are `undefined`, which canonicalises to
    // `null` — so a legacy record redrafted into the new shape lights up
    // `direction`, `footprint` and `solutions` all three, which is what changed.
    case 'direction':
      return record.agreedDirection
    case 'footprint':
      return record.footprint
    case 'solutions':
      return solutionsContent(record.solutions)
    case 'defaults':
      return { ...record.defaults }
  }
}

/** The sections whose content differs between two appearances of the same record. */
export function changedSections(before: RetroRecord, after: RetroRecord): readonly RecordSection[] {
  return RECORD_SECTIONS.filter(
    (section) =>
      canonicalJson(recordSectionContent(before, section)) !==
      canonicalJson(recordSectionContent(after, section)),
  )
}
