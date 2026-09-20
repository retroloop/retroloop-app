import type { AppRouterOutputs } from '@retro/api'
import { BotIcon, UserIcon } from 'lucide-react'
import { Tag, type TagLook } from '@/components/ui/tag'

/** Human or AI, as the wire spells it. The two enums are the same two words. */
export type Party = AppRouterOutputs['records']['get']['record']['requester']

/**
 * Which of the two writes in this product, as one word and one mark. Without it
 * there is no distinction on screen between a record the human reported and one
 * the AI requested.
 *
 * `requester` had been on every record since the first schema and nothing ever
 * rendered it, so a reviewer could not tell their own complaint from one the AI
 * filed about itself. It reads as a word rather than a colour, in the tag idiom
 * every other status shares (`components/ui/tag.tsx`).
 *
 * It sits here rather than inside the record card, beside `retro-state.tsx` and
 * for the same reason that one does: it is the *same* word and the same mark
 * wherever an actor is named, and there are two such places since the records
 * page — who raised a record, and who marked it resolved. Those are one fact
 * asked twice, and a reader should not have to learn two vocabularies for it.
 */
export const ACTOR_TAG: Record<Party, TagLook> = {
  human: { fill: 'bg-tone-neutral-soft text-tone-neutral', label: 'HUMAN', icon: UserIcon },
  ai: { fill: 'bg-tone-blue-soft text-tone-blue', label: 'AI', icon: BotIcon },
}

export function ActorTag({ party, testId }: { party: Party; testId: string }) {
  return <Tag look={ACTOR_TAG[party]} testId={testId} />
}
