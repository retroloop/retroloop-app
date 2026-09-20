import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { DecisionState } from '@/components/review/decision-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  INVOLVEMENTS,
  labelOf,
  type Option,
  optionFor,
  READABLE_SOLUTION_LEVELS,
  SEVERITIES,
  SOLUTION_LEVELS,
  type SolutionLevelInput,
} from '@/lib/enum-labels'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'

type Decision = AppRouterOutputs['records']['get']['decision']

/**
 * The level the radio list can show as chosen — the five it offers, or nothing.
 *
 * A record decided while `upstream`, `none` and `undecided` were still offered
 * can hold one of them, and none of those is on the list any more. Rather than
 * pre-select something the human did not pick, the list starts with nothing
 * selected and the verdict leaves `solutionLevel` out, which keeps whatever
 * stands. The reviewer changes that ceiling by choosing one of the five, which
 * is the only way to change it.
 */
function offerable(level: Decision['solutionLevel']): SolutionLevelInput | undefined {
  return optionFor(SOLUTION_LEVELS, level as SolutionLevelInput)?.value
}

/**
 * The verdicts on offer — the three that exist (`r-verdict-revise`): approve,
 * decline, or request a revision. Any of the three moves a record out of
 * `pending`.
 *
 * `hold` is not one of them since `r-hold-semantics`: holding is not a review
 * status of a record. It became a flag beside the verdict, and `r-remove-hold`
 * removed that too, because the same thing is said by marking a record as only
 * to be done with the human in the loop. Which is `involvement`, three controls
 * down.
 *
 * The type still says `Exclude<DecisionState, …>` rather than a hand-written
 * union, because a record decided before the split can still *read* `hold` —
 * this list is what may be pressed, not what may be shown.
 */
type Verdict = Exclude<DecisionState, 'pending' | 'hold'>

const VERDICTS: readonly { state: Verdict; label: string }[] = [
  { state: 'approved', label: 'Approve' },
  { state: 'declined', label: 'Decline' },
  { state: 'revise', label: 'Revise' },
]

/**
 * How the chosen verdict looks: its state's own tone as a soft fill, its ink,
 * a border in the same hue, and a heavier word — the same four channels the
 * record's state tag uses, so the button and the tag say the same thing.
 *
 * **Every one of them is repeated under `dark:` and `hover:`, and that is not
 * redundancy.** These classes sit on top of the Button's `outline` variant,
 * which carries `dark:bg-input/30`, `dark:border-input`, `dark:hover:bg-input/50`,
 * `hover:bg-muted` and `hover:text-foreground`. tailwind-merge only drops a
 * class that another one *with the same modifier* would conflict with, so a
 * bare `bg-tone-green-soft` and a `dark:bg-input/30` both survive — and the
 * variant's wins under `.dark`, which compiles a specificity step higher
 * (`&:is(.dark *)`, styles.css). Shipped that way, the dark theme kept the ink
 * and the weight and lost the fill and the border, and hovering took the ink
 * too: a decided button and an undecided one a font-weight apart, which is the
 * complaint `r-verdict-revise` was filed on, reproduced in the other theme.
 * The scenarios assert this in both themes and under the pointer.
 */
const PRESSED: Record<Verdict, string> = {
  approved:
    'bg-tone-green-soft hover:bg-tone-green-soft dark:bg-tone-green-soft dark:hover:bg-tone-green-soft text-tone-green hover:text-tone-green border-tone-green dark:border-tone-green font-semibold',
  declined:
    'bg-tone-red-soft hover:bg-tone-red-soft dark:bg-tone-red-soft dark:hover:bg-tone-red-soft text-tone-red hover:text-tone-red border-tone-red dark:border-tone-red font-semibold',
  revise:
    'bg-tone-blue-soft hover:bg-tone-blue-soft dark:bg-tone-blue-soft dark:hover:bg-tone-blue-soft text-tone-blue hover:text-tone-blue border-tone-blue dark:border-tone-blue font-semibold',
}

/**
 * The human's three values and their verdict, committed together.
 *
 * **Editing a value is not a decision.** The controls hold what the reviewer has
 * chosen and nothing else happens; the verdict button is the single moment
 * anything is written, and it writes the values that were on screen when it was
 * pressed. That is what "explicit approve only" means here — no autosave, no
 * debounce, and no state that a moment of silence could settle. The router
 * agrees: `decisions.record` has no default `state`.
 *
 * The order is severity, then solution level, then involvement, because a
 * ceiling is chosen before how the human wants to be involved in reaching it
 * (data-model.md §Enum option labels).
 *
 * Declining is a verdict, not a deletion (architecture.md §Actor model): the
 * record stays, and it records that the human said no.
 *
 * A hold control sat above all of it and outside `readOnly` for a while,
 * because it was not on this axis at all — and it was the one thing a finished
 * review still took. `r-remove-hold` removed it, so `readOnly` now governs
 * everything on this card without exception.
 */
export function DecisionControls({
  retroId,
  rid,
  revision,
  decision,
  readOnly,
  hasSolutions,
  selectedSolution,
}: {
  retroId: number
  rid: string
  revision: number
  decision: Decision
  readOnly: boolean
  /**
   * Whether the record proposes solutions — which is whether the solution level
   * is still a dial of its own.
   *
   * On a record that does, the ceiling comes with the solution the human picks
   * (`RecordDecisionUseCase`), and the server refuses a level sent alongside it.
   * So the radio list does not render and the verdict does not carry a level.
   *
   * The read-only line goes with it. It stayed on both shapes for a while,
   * while a finished review had no other way to say which ceiling was approved;
   * the ✓ on the tab strip says it now, in the tab's own title (`L2`) and again
   * in full underneath it, and a second copy in the decision block is the same
   * answer twice on one card.
   */
  hasSolutions: boolean
  /**
   * Which solution the reviewer picked, 1-based, or `null` — either because the
   * record proposes none to pick between, or because none has been picked yet.
   *
   * One `null` for both, because the verdict does the same thing with them: it
   * says nothing about the selection, and the server answers with the rule it
   * has for silence (nothing to select, or the previous pick, or the AI's
   * recommendation). It is the caller's business which of the two it is —
   * `record-card.tsx` is the only thing that can produce a number here, and it
   * produces one only from the record's own array.
   */
  selectedSolution: number | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [severity, setSeverity] = useState(decision.severity)
  const [solutionLevel, setSolutionLevel] = useState(offerable(decision.solutionLevel))
  const [involvement, setInvolvement] = useState(decision.involvement)
  const [reviewerNote, setReviewerNote] = useState(decision.reviewerNote ?? '')

  const record = useMutation(
    trpc.decisions.record.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() }),
    }),
  )

  if (readOnly) {
    return (
      <div className="flex flex-col gap-4">
        <StaticValue
          testid="severity"
          label="Severity"
          text={labelOf(SEVERITIES, decision.severity)}
        />
        {hasSolutions ? null : <StaticLevel value={decision.solutionLevel} />}
        <StaticValue
          testid="involvement"
          label="Involvement"
          text={labelOf(INVOLVEMENTS, decision.involvement)}
        />
        {decision.reviewerNote === null ? null : (
          <div className="flex flex-col gap-1.5">
            <h4 className="section-label">Reviewer note</h4>
            <p className="text-sm leading-relaxed" data-testid="reviewer-note">
              {decision.reviewerNote}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <EnumSelect
        testid="severity"
        label="Severity"
        options={SEVERITIES}
        value={severity}
        onChange={setSeverity}
      />

      {hasSolutions ? null : <LevelRadioList value={solutionLevel} onChange={setSolutionLevel} />}

      <EnumSelect
        testid="involvement"
        label="Involvement"
        options={INVOLVEMENTS}
        value={involvement}
        onChange={setInvolvement}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-${rid}`} className="section-label">
          Reviewer note
        </Label>
        <Textarea
          id={`note-${rid}`}
          rows={2}
          value={reviewerNote}
          data-testid="reviewer-note"
          placeholder="Anything the record does not already say"
          onChange={(event) => setReviewerNote(event.target.value)}
        />
      </div>

      {/* Named as a row, because what is *on* the row is the claim: hold left
          it in `r-hold-semantics`, and a scenario that could only check for the
          absence of a button it thought of would not catch it coming back. */}
      <div className="flex flex-wrap gap-2" data-testid="verdicts">
        {VERDICTS.map(({ state, label }) => {
          const chosen = decision.state === state
          return (
            <Button
              key={state}
              size="sm"
              variant="outline"
              /**
               * There has to be a clear indication of what is already selected,
               * because a decided button and an undecided one were a shade
               * apart. The visible half is `PRESSED` above; `aria-pressed` says
               * the same thing to a screen reader, which cannot see a fill at
               * all.
               */
              aria-pressed={chosen}
              className={cn(chosen && PRESSED[state])}
              data-testid={state}
              disabled={record.isPending}
              onClick={() =>
                record.mutate({
                  retroId,
                  rid,
                  // The revision the page was showing, not the newest one: a
                  // verdict binds to the content the human actually read.
                  revision,
                  /**
                   * Pressing the verdict that is already selected undoes it: the
                   * record goes back to `pending` (`r-verdict-revise`): pressing
                   * the same verdict twice undoes it. That is a new decision
                   * version, not an edit — the verdict being undone stays in
                   * the history where the human left it.
                   */
                  state: chosen ? 'pending' : state,
                  severity,
                  involvement,
                  // Omitted on a record whose level comes from its selected
                  // solution — the server refuses one there — and on a record
                  // holding a level the list no longer offers that the reviewer
                  // has not replaced, where the server keeps what stands rather
                  // than being sent a value it would refuse.
                  ...(hasSolutions || solutionLevel === undefined ? {} : { solutionLevel }),
                  // The other half of the same rule, from the other side: the
                  // level of a record that proposes solutions is whichever one
                  // was picked, so the pick is what the verdict carries. Left out
                  // while it is null — a record with nothing to select, or a
                  // reviewer who has selected nothing — because the server's
                  // answer to silence is a rule (previous, else the AI's
                  // recommendation) and not something to guess at from here.
                  ...(selectedSolution === null ? {} : { selectedSolution }),
                  ...(reviewerNote.trim().length > 0 ? { reviewerNote: reviewerNote.trim() } : {}),
                })
              }
            >
              {label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Solution level as a radio list — bold level name, then its definition
 * (data-model.md). A dropdown would hide four ceilings behind the fifth, and the
 * ceiling is the choice the whole record turns on.
 *
 * Five rows, not eight: `none`, `upstream` and `undecided` are no longer
 * choices. An empty `value` is a record still carrying one of them — nothing is
 * selected until the reviewer picks a level that exists.
 */
function LevelRadioList({
  value,
  onChange,
}: {
  value: SolutionLevelInput | undefined
  onChange: (value: SolutionLevelInput) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="section-label">Solution level</h4>
      <RadioGroup
        data-testid="solution-level"
        value={value === undefined ? '' : String(value)}
        onValueChange={(next) => {
          const chosen = SOLUTION_LEVELS.find((option) => String(option.value) === next)
          if (chosen !== undefined) onChange(chosen.value)
        }}
      >
        {SOLUTION_LEVELS.map((option) => (
          // Two testids because they are two things: the row of words a reviewer
          // reads, and the control they press. Asserting the label list needs the
          // first; asserting what is selected needs the second.
          <Label
            key={String(option.value)}
            data-testid="solution-level-option"
            className="items-start gap-2.5 font-normal text-sm leading-relaxed"
          >
            <RadioGroupItem
              value={String(option.value)}
              data-testid={`solution-level-${option.value}`}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">{option.name}</span>
              {option.rest}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  )
}

/**
 * The level as a decided record holds it, which may be one of the three that
 * were cut. Reading is where those stay alive: an early retrospective's
 * `upstream` and `none` render with the labels they were chosen under, forever.
 */
function StaticLevel({ value }: { value: Decision['solutionLevel'] }) {
  const option = optionFor(READABLE_SOLUTION_LEVELS, value)
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="section-label">Solution level</h4>
      <p className="text-sm leading-relaxed" data-testid="solution-level">
        {option === undefined ? (
          String(value)
        ) : (
          <>
            <span className="font-semibold">{option.name}</span>
            {option.rest}
          </>
        )}
      </p>
    </div>
  )
}

function StaticValue({ testid, label, text }: { testid: string; label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="section-label">{label}</h4>
      <p className="text-sm leading-relaxed" data-testid={testid}>
        {text}
      </p>
    </div>
  )
}

/**
 * A dropdown whose options are allowed to be as long as they are.
 *
 * shadcn's trigger is a single fixed-height line that clamps its value, which
 * would quietly drop the half of every label that says *why* — and the standing
 * rule is that the explanation never goes, with a two-line wrap as the acceptable
 * cost. So the trigger grows and both it and the options wrap.
 */
function EnumSelect<TValue extends string | number>({
  testid,
  label,
  options,
  value,
  onChange,
}: {
  testid: string
  label: string
  options: readonly Option<TValue>[]
  value: TValue
  onChange: (value: TValue) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="section-label">{label}</h4>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const chosen = options.find((option) => String(option.value) === next)
          if (chosen !== undefined) onChange(chosen.value)
        }}
      >
        <SelectTrigger
          data-testid={testid}
          className="h-auto min-h-8 w-full items-start whitespace-normal text-left leading-relaxed *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:block *:data-[slot=select-value]:whitespace-normal"
        >
          <SelectValue aria-label={label} />
        </SelectTrigger>
        <SelectContent className="max-w-[min(40rem,calc(100vw-2rem))]">
          {options.map((option) => (
            <SelectItem
              key={String(option.value)}
              value={String(option.value)}
              data-testid={`${testid}-${option.value}`}
              className="items-start whitespace-normal leading-relaxed"
            >
              {/* Plain text: the bold name marks a *level* in the radio list, and
                  spending the same emphasis here would stop it meaning that. */}
              <span>{`${option.name}${option.rest}`}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
