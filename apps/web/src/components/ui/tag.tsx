import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The app's status idiom, in one place: a soft fill, a readable ink, an icon and
 * a word. State is never carried by colour alone — every tag ships the word, so
 * it is legible in a screenshot, to a screen reader, and to someone who cannot
 * tell the amber from the green.
 *
 * It became a primitive at the third caller (a record's decision, a dashboard
 * row's retrospective, and this page's header). Two copies of a class string is
 * a coincidence; three is a rule nobody wrote down, and a fourth would have
 * drifted. Nothing about how it looks changed on the way in.
 */
export type TagLook = {
  /** Soft fill and readable ink, as one pair — they are never chosen apart. */
  readonly fill: string
  readonly label: string
  readonly icon: LucideIcon
}

export function Tag({
  look,
  testId,
  className,
}: {
  look: TagLook
  testId: string
  className?: string
}) {
  const { fill, label, icon: Icon } = look
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold text-[0.625rem] uppercase tracking-[0.08em]',
        fill,
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  )
}
