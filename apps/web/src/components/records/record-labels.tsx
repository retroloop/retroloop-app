import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, TagIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tag } from '@/components/ui/tag'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** A label as a record wears it — resolved against the vocabulary by the server. */
export type RecordLabel = AppRouterOutputs['records']['get']['labels'][number]

/**
 * What a record wears, in the tag idiom every classification in this product
 * wears (`components/ui/tag.tsx`).
 *
 * **The same pill as a state tag, with a different icon**, and that is a
 * decision rather than reuse for its own sake: a label *is* a classification, it
 * sits beside the verdict and the lifecycle on the same row, and giving it a
 * shape of its own would ask the reader to learn a second vocabulary for the
 * same job. What tells them apart is the tag glyph — every label carries one,
 * and no state does.
 *
 * **Neutral, always.** The five tones in this app all belong to a state
 * (`record-lifecycle.tsx` §LIFECYCLE_TAG argues the last one out), and a label
 * is the user's word rather than a position on any axis this product knows —
 * colouring `migrated` green or red would be the system having an opinion about
 * a name somebody typed. A retired one is dimmed instead, which is a difference
 * in *weight* rather than in hue.
 *
 * It renders nothing at all on a record nobody has labelled, which is most of
 * them: an empty tag row would be a row of whitespace on every card in every
 * review, and the absence of a label is not a state worth a mark.
 */
export function RecordLabelTags({
  labels,
  testId = 'record-labels',
}: {
  labels: readonly RecordLabel[]
  testId?: string
}) {
  if (labels.length === 0) return null

  return (
    <>
      {labels.map((label) => (
        <Tag
          key={label.id}
          testId={testId}
          look={{
            fill: 'bg-tone-neutral-soft text-tone-neutral',
            label: label.name,
            icon: TagIcon,
          }}
          // A retired label goes on rendering where it was applied — that is
          // what retiring means — and the page says which, so a reader who
          // cannot find it on the add menu knows why (`label.model.ts`).
          className={label.retired ? 'opacity-60' : undefined}
        />
      ))}
    </>
  )
}

/**
 * The human's half: **one control**, and it is a checklist rather than an add
 * button beside a remove button on every tag.
 *
 * A label is on or off, so the question a reader has is "which of these does
 * this record wear" — which is one list with ticks, not two affordances that
 * have to be read together. It is the `FilterGroup` shape the records bar
 * already uses (`records-filter.tsx`), for the same reason: a row of toggles is
 * the smallest thing that expresses a set.
 *
 * **What is on the list is what the server would accept.** An offerable label is
 * offered; a **retired** one appears only when this record already wears it, so
 * it can be taken off and never put back — which is exactly the asymmetry the
 * domain enforces, and a control the server would refuse is a control that
 * should not be on screen (`record-lifecycle.tsx` says the same about the
 * lifecycle acts).
 *
 * **It works on a finished retrospective**, which is the whole point: the second
 * archetype of use labels records *after* the review closes, so there is no
 * read-only branch here and the server deliberately does not refuse the write
 * either.
 */
export function RecordLabelControl({
  retroId,
  rid,
  labels,
}: {
  retroId: number
  rid: string
  labels: readonly RecordLabel[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const vocabulary = useQuery(trpc.labels.list.queryOptions({}))

  const set = useMutation(
    trpc.labels.set.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() }),
    }),
  )

  const worn = new Set(labels.map((label) => label.id))
  /**
   * Offerable, plus whatever this record already wears. The union is the point:
   * a retired label the record carries has to be on the list or there is no way
   * to remove it, and a retired label it does not carry must not be, or the page
   * offers a write the server refuses.
   */
  const offered = (vocabulary.data ?? []).filter(
    (definition) => definition.retiredAt === null || worn.has(definition.id),
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="record-label-control">
          Labels
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" data-testid="record-label-panel" className="w-56">
        {offered.length === 0 ? (
          /**
           * A store nobody has configured has no labels, and this is where a
           * reader meets that — so the line says where they are made rather than
           * only that there are none. It is not a link: the settings page is one
           * crumb away in the chrome, and a second route out of a popover is a
           * control this page does not need.
           */
          <p className="text-muted-foreground text-sm" data-testid="record-label-none">
            No labels yet. Create them on the settings page.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="section-label pb-1 text-muted-foreground">Labels</legend>
            {offered.map((definition) => {
              const on = worn.has(definition.id)
              return (
                <button
                  key={definition.id}
                  type="button"
                  aria-pressed={on}
                  disabled={set.isPending}
                  data-testid={`record-label-toggle-${definition.id}`}
                  onClick={() =>
                    set.mutate({
                      // The record's own retrospective, never the page's — a rid
                      // is minted per retrospective, so `(retroId, rid)` is the
                      // identity everywhere.
                      retroId,
                      rid,
                      labelId: definition.id,
                      applied: !on,
                    })
                  }
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  {/* The tick is a glyph and the pressed state is on the
                      element — a reader who cannot see the fill still hears
                      "pressed", which is the same rule the filter chips obey. */}
                  <CheckIcon
                    aria-hidden
                    className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="flex-1">{definition.name}</span>
                  {definition.retiredAt === null ? null : (
                    <span className="meta-mono" data-testid="record-label-toggle-retired">
                      retired
                    </span>
                  )}
                </button>
              )
            })}
          </fieldset>
        )}
      </PopoverContent>
    </Popover>
  )
}
