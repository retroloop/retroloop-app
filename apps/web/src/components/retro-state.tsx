import type { AppRouterOutputs } from '@retro/api'
import { CircleCheckIcon, CircleDotIcon, LoaderIcon, SendHorizontalIcon } from 'lucide-react'
import { Tag, type TagLook } from '@/components/ui/tag'

export type RetroState = AppRouterOutputs['retros']['get']['state']

/**
 * What state a retrospective is in, in the two places one is shown: a dashboard
 * row and the review page's header. It sits beside `lib/retro-identity.ts` and
 * for the same reason — the point is that it is the *same* word and the same
 * mark in both, so a reader who clicks a row that said REVIEWING lands on a page
 * that agrees with it.
 *
 * `submitted` is the owner's session-11 add — *"There should be a status in
 * between that indicates that the human has submitted but AI hasn't closed"*.
 * It is a reading of the wire, not a state anything stores (`retro.view.ts`),
 * and it gets a look here rather than a panel anywhere: the fact he was missing
 * is one word, and this is the component that already says the word in both
 * places he would look for it.
 *
 * Blue between amber and green, and the send glyph the review bar's own Sent
 * mark carries. The colour is doing the same work it does on the lifecycle
 * chips — amber is the state that wants him, blue is the state that is moving
 * without him, green is done — and the glyph is the tie: the mark beside the
 * Finish button and the tag at the top of the page are now the same picture of
 * the same fact, which is what he could not find before.
 *
 * Because this is a `Record<RetroState, …>` and `RetroState` is read off the
 * router, a fourth state on the wire made this file fail to compile until the
 * fourth look existed. That is the tripwire that found every decision point in
 * the UI below it.
 */
const RETRO_TAG: Record<RetroState, TagLook> = {
  open: { fill: 'bg-tone-neutral-soft text-tone-neutral', label: 'open', icon: LoaderIcon },
  reviewing: {
    fill: 'bg-tone-amber-soft text-tone-amber',
    label: 'reviewing',
    icon: CircleDotIcon,
  },
  submitted: {
    fill: 'bg-tone-blue-soft text-tone-blue',
    label: 'submitted',
    icon: SendHorizontalIcon,
  },
  finished: {
    fill: 'bg-tone-green-soft text-tone-green',
    label: 'finished',
    icon: CircleCheckIcon,
  },
}

export function RetroStateTag({ state, className }: { state: RetroState; className?: string }) {
  return <Tag look={RETRO_TAG[state]} testId="retro-state" className={className} />
}
