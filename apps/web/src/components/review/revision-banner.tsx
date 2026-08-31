import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * **Announce, don't swap** (KC-0005). The AI has filed a newer revision while the
 * reviewer was reading this one. The page says so and stays exactly where it
 * was: content that moved on its own would mean a verdict could land on a
 * paragraph the reviewer never saw, which is the one thing the carry-over rule
 * cannot repair.
 *
 * It moves when the human says so, and not before.
 */
export function RevisionBanner({ revision, onLoad }: { revision: number; onLoad: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-tone-blue/30 bg-tone-blue-soft px-4 py-3"
      data-testid="revision-banner"
    >
      <p className="flex-1 text-sm text-tone-blue">Revision {revision} available</p>
      <Button size="sm" variant="outline" data-testid="revision-banner-load" onClick={onLoad}>
        Load revision {revision}
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  )
}
