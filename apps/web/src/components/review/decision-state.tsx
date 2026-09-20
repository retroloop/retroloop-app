import type { AppRouterOutputs } from '@retro/api'
import {
  CircleArrowLeftIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CirclePauseIcon,
} from 'lucide-react'
import { Tag, type TagLook } from '@/components/ui/tag'

export type DecisionState = AppRouterOutputs['records']['get']['decision']['state']

/**
 * How each verdict looks, in the tag idiom every status in the product shares
 * (`components/ui/tag.tsx`). The `ink` is the same hue without the fill, for the
 * one place a whole tag will not fit: the index rail's mark beside a record.
 * Even there the state ships its own icon *shape*, so the mark is not a coloured
 * dot the reader has to decode from colour alone.
 */
export const DECISION_TAG: Record<DecisionState, TagLook & { ink: string }> = {
  pending: {
    fill: 'bg-tone-amber-soft text-tone-amber',
    ink: 'text-tone-amber',
    label: 'pending',
    icon: CircleDotIcon,
  },
  approved: {
    fill: 'bg-tone-green-soft text-tone-green',
    ink: 'text-tone-green',
    label: 'approved',
    icon: CircleCheckIcon,
  },
  declined: {
    fill: 'bg-tone-red-soft text-tone-red',
    ink: 'text-tone-red',
    label: 'declined',
    icon: CircleMinusIcon,
  },
  /**
   * The third verdict (`r-verdict-revise`): the record goes back to the AI to
   * be rewritten. Its arrow points the way the record travels, because this is
   * the one state that says something has to happen next.
   */
  revise: {
    fill: 'bg-tone-blue-soft text-tone-blue',
    ink: 'text-tone-blue',
    label: 'revise',
    icon: CircleArrowLeftIcon,
  },
  /**
   * Frozen history (`r-hold-semantics`), and it wears the neutral tone rather
   * than the blue it had: `revise` is a verdict a reviewer can give *now* and
   * this one is a verdict nobody can give again, so the live one takes the hue.
   * Two identical fills on one filter bar is exactly the "which of these is
   * which" the record above was filed about.
   */
  hold: {
    fill: 'bg-tone-neutral-soft text-tone-neutral',
    ink: 'text-tone-neutral',
    label: 'hold',
    icon: CirclePauseIcon,
  },
}

/**
 * The states in the order the product speaks them, read off the look-up
 * above rather than listed a second time: `Record<DecisionState, …>` already
 * refuses to compile with a state missing, so a state added to the router's
 * enum has to be given a look before anything can offer it.
 */
export const DECISION_STATES = Object.keys(DECISION_TAG) as readonly DecisionState[]

export function DecisionStateTag({
  state,
  className,
}: {
  state: DecisionState
  className?: string
}) {
  return <Tag look={DECISION_TAG[state]} testId="record-state" className={className} />
}
