import { z } from 'zod'
import { RECORD_SECTIONS } from '#domain/models/record.model'
import { RECORD_LIFECYCLE_STATES } from '#domain/models/record-lifecycle.model'
import { RETROSPECTIVE_STATES } from '#domain/models/retrospective.model'
import { RELATION_DIRECTIONS } from '#domain/services/record-relation.service'

/**
 * The enums of data-model.md, once. Every adapter validates against these — the
 * CLI's flags, the server's `.input()`, and the revision file the AI authors.
 */
export const actorSchema = z.literal(['ai', 'human'])
export const recordTypeSchema = z.literal(['issue', 'feature'])
export const partySchema = z.literal(['human', 'ai'])
export const noteKindSchema = z.literal(['human-cost', 'ai-cost'])
/**
 * Every state a stored decision can be in — the **read** shape, all five.
 *
 * `revise` is the third verdict (`r-verdict-revise`): a reviewer either approves,
 * declines, or asks for a revision. It moves a record out of pending like the
 * other two, and it is an instruction to the drafting AI rather than an outcome:
 * a record carrying one must be addressed in the next revision.
 *
 * `hold` is history. `r-hold-semantics` took it off the verdict axis entirely,
 * because a hold is not a review status of a retrospective item, and it lives on
 * as a lifecycle flag instead (`hold.model.ts`). Human data is append-only and is
 * never rewritten, so every read path keeps admitting a stored `hold`, forever:
 * the wire views, the export, record history, the decisions table's own CHECK.
 * Nothing may *write* one; that is `decisionVerdictSchema` below.
 *
 * This is the same shape of narrowing solution level got, and for the same
 * reason.
 */
export const decisionStateSchema = z.literal(['pending', 'approved', 'declined', 'revise', 'hold'])

/**
 * What a human may submit from here on: pending, approved, declined or revise
 * (`r-hold-semantics`, `r-verdict-revise`). Every write path takes this, so
 * `hold` offered to one is a validation error rather than a new row nobody
 * could have picked from the UI.
 *
 * `pending` stays, and is not an oversight: a reviewer explicitly moving a
 * record back to undecided is an act, and the whole product turns on nothing
 * being inferred from silence. It is also the shape an undo takes — re-clicking
 * the selected verdict submits `pending`, which is one more append rather than
 * a row anybody edits.
 */
export const decisionVerdictSchema = z.literal(['pending', 'approved', 'declined', 'revise'])
export const recordSectionSchema = z.literal([...RECORD_SECTIONS])

/**
 * Which way a relation points, **from the side of the record being read** — the
 * shape the rule that a relation reads from both sides takes on a wire.
 *
 * It is not a stored column and never becomes one: the row is directed as
 * authored and is never mirrored, so this is computed per reader
 * (`record-relation.service.ts` §relationFrom). Spread from
 * `RELATION_DIRECTIONS` for `retroDisplayStateSchema`'s reason — a direction
 * added to the domain arrives here on its own rather than in a second list
 * nobody diffs.
 */
export const relationDirectionSchema = z.literal([...RELATION_DIRECTIONS])

/**
 * What a reader is told a retrospective is in: the three states it is stored in,
 * and `submitted`, which is only ever **derived** (`retro.view.ts`).
 *
 * Spread from `RETROSPECTIVE_STATES` rather than typed out, because this enum
 * used to live on the wire — `views.schema.ts` restated the three literals under
 * a header claiming the enums came from here, and a fourth state would have been
 * two edits with no compiler between them. Now a state added to the domain
 * arrives here on its own, and the wire imports what it validates.
 *
 * `submitted` is the one value with no row behind it anywhere: `reviewing` plus
 * a finished latest round, computed by the read models and never stored, never
 * migrated, never written by anyone. It is on this list and not in
 * `RETROSPECTIVE_STATES` for exactly that reason — a store must never hold it.
 */
export const retroDisplayStateSchema = z.literal([...RETROSPECTIVE_STATES, 'submitted'])

/**
 * Where a record stands on the lifecycle axis: `open` until somebody resolved
 * it, and `archived` once it is out of the way.
 *
 * **Derived, never stored** — it is the reading of the entry in force, of the
 * absence of one, and, in that absence, of the verdict beside it: a declined
 * record is archived from birth with no row anywhere. What gets *written* is
 * `recordLifecycleStatusSchema`'s four acts; this is where they leave the
 * record, and it is one position shorter because both `reopened` and
 * `unarchived` land on `open` (`docs/design/lifecycle.md`).
 */
export const recordLifecycleStateSchema = z.literal([...RECORD_LIFECYCLE_STATES])

/** 1–5, v2 rubric; recurrence folds in, there is no separate field (D1). */
export const severitySchema = z.literal([1, 2, 3, 4, 5])

/**
 * A ceiling, not a target (D1) — the **read** shape, all eight values.
 *
 * `none`, `upstream` and `undecided` are history: they were cut from what
 * anyone may choose, and stored retrospectives already hold two of them. Human
 * data is append-only and is never rewritten, so every read path — the wire
 * views, the export, record history, the database's own CHECK — keeps admitting
 * them, forever. Nothing may *write* one; that is `solutionLevelInputSchema`
 * below.
 */
export const solutionLevelSchema = z.union([
  z.literal([1, 2, 3, 4, 5]),
  z.literal(['none', 'upstream', 'undecided']),
])

/**
 * What may be chosen or proposed from here on: strictly levels 1–5; the list of
 * solutions was cut to L1–L5 and nothing else.
 *
 * Every write path takes this — the human's decision and the AI's proposed
 * default alike — so a legacy value offered to either is a validation error
 * rather than a new row nobody could have picked from the UI.
 */
export const solutionLevelInputSchema = z.literal([1, 2, 3, 4, 5])

export const involvementSchema = z.literal([
  'autonomous',
  'pull-request',
  'interactive',
  'other',
  'undecided',
])

/** `r-<words>` — the stable record slug (data-model.md §Record). */
export const ridSchema = z
  .string()
  .regex(/^r-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'rid must look like r-some-words (lowercase, hyphenated)')
