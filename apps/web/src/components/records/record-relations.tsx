import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ActorTag } from '@/components/actor-tag'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTRPC } from '@/lib/trpc'

/** One relation as this record sees it — the other record, the words, and which way it points. */
export type RecordRelation = AppRouterOutputs['records']['byId']['relations'][number]

/**
 * What somebody said this record has to do with other records. Both actors can
 * relate records, each relation carries how-they-relate words, and the relation
 * reads from both sides, so that the AI can find past records easily and build
 * holistic solutions.
 *
 * **Both directions in one list, and the line is a sentence.** The stored row is
 * directed as authored and is never mirrored, so the two records' pages read the
 * same row and differ only in which end is which — which is exactly what the
 * line renders: `this record · supersedes → #12 Title` on the page it was
 * written from, and `#12 Title · supersedes → this record` on the other. Two
 * headed groups would be two lists of one line each on nearly every record, and
 * an arrow with no named ends would be a legend the reader has to hold.
 *
 * **This page and no other**, on `RecordAttributes`' reasoning one step further
 * out. A label is a classification worth a tag wherever a record is listed; a
 * relation is a *second record*, with a name, a link and words about why the two
 * are together, and a list that drew every row's relations would be drawing half
 * the store twice. So the flat page does not carry them and the review card does
 * not either.
 *
 * **It works on a closed retrospective**, more so than anything beside it: the
 * record at the far end is normally in a retrospective that closed sessions ago,
 * which is what *"find past records"* means. There is no read-only branch here
 * for the same reason there is none on the lifecycle controls — the server
 * deliberately does not refuse this write, and a page that greyed the control
 * out would be inventing a rule the domain does not have.
 *
 * **The timeline says nothing about relations**, deliberately. Its contract is
 * three kinds and no fourth (`record-timeline.tsx`), the record's history is
 * about what happened *to* it, and a relation is a statement about two records
 * that a reader of either one can already see here. A retrospective can add it
 * back if it turns out to be wanted.
 */
export function RecordRelations({
  globalId,
  relations,
}: {
  globalId: number
  relations: readonly RecordRelation[]
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="record-relations">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-label">Relations</h2>
        <Relate globalId={globalId} />
      </div>

      {relations.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5" data-testid="record-relation-list">
          {relations.map((relation) => (
            <li key={`${relation.direction} ${relation.globalId}`}>
              <RelationRow globalId={globalId} relation={relation} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One relation, read as a sentence with both ends named.
 *
 * The words sit between the two records and the arrow points at the second, so
 * the line says which record the statement is *about* without the reader knowing
 * anything about how the row is stored. `this record` is plain text rather than
 * a link, because it is the page you are on.
 *
 * **The author is on the line**, which nothing else on this page does for a
 * one-line row. It earns it here: this and the lifecycle are the only two things
 * in the product either actor writes, so "the AI spotted a repeat of this" and
 * "the human grouped these two" are different facts and neither is derivable from
 * anything else on screen (`record-relation.model.ts`).
 */
function RelationRow({ globalId, relation }: { globalId: number; relation: RecordRelation }) {
  const outgoing = relation.direction === 'outgoing'
  const other = (
    <Link
      to="/records/$recordId"
      params={{ recordId: String(relation.globalId) }}
      data-testid="record-relation-link"
      className="min-w-0 break-words text-sm hover:underline"
    >
      <span className="meta-mono">#{relation.globalId}</span> {relation.title}
    </Link>
  )
  const here = (
    <span className="text-muted-foreground text-sm" data-testid="record-relation-here">
      this record
    </span>
  )

  return (
    <div
      /**
       * The direction is **in the testid**, beside the number, on the idiom a
       * row of the flat page already uses (`records-row-<retroId>-<rid>`): what
       * identifies a relation from this page's side is which other record it
       * names and which way it points, and the same two records can hold a
       * relation each way round.
       */
      data-testid={`record-relation-${relation.direction}-${relation.globalId}`}
      className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2"
    >
      {outgoing ? here : other}
      <span className="meta-mono" data-testid="record-relation-how">
        {relation.how} →
      </span>
      {outgoing ? other : here}
      <ActorTag party={relation.actor} testId="record-relation-actor" />
      <Unrelate globalId={globalId} relation={relation} />
    </div>
  )
}

/**
 * Taking a relation off — one press, no composer.
 *
 * It sends the **stored** pair rather than "this record and that one": the row
 * is directed as authored, so un-relating an incoming relation is a write about
 * `(the other record, this one)` and sending it the other way round would be a
 * pair that does not stand. `direction` is what the page already holds to know
 * that, which is why the wire carries no separate `fromId`/`toId` here.
 *
 * No confirm, because nothing here is terminal: un-relating appends a version
 * carrying the words of the relation it takes off, and a mis-press costs one
 * more press.
 */
function Unrelate({ globalId, relation }: { globalId: number; relation: RecordRelation }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const unrelate = useMutation(
    trpc.records.relate.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() }),
    }),
  )

  const outgoing = relation.direction === 'outgoing'

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={unrelate.isPending}
      data-testid="record-relation-unrelate"
      onClick={() =>
        unrelate.mutate({
          fromId: outgoing ? globalId : relation.globalId,
          toId: outgoing ? relation.globalId : globalId,
          related: false,
        })
      }
    >
      Un-relate
    </Button>
  )
}

/**
 * Relating this record to another: which record, and how.
 *
 * **By the number**, because that is what a relation names — `(retroId, rid)` is
 * the address of one record and this write names two (`record-relation.model.ts`).
 * It is also the number the reader is looking at: it is in this page's own URL,
 * on every row of `/records`, and first on every line of `record list`.
 *
 * **Always authored from this record**, so there is no direction picker. The
 * relation reads from both sides — the other record's page shows the same row as
 * `incoming` — so a control offering to write it backwards would be offering a
 * second way to say one thing.
 *
 * The refusals are the server's, verbatim. A record related to itself, a number
 * nothing was minted for, a record a later draft withdrew and a pair that already
 * stands are four sentences the domain already writes, and a page that restated
 * any of them would be a second copy free to disagree with the CLI's. What the
 * page owes the reader is the sentence that came back.
 */
function Relate({ globalId }: { globalId: number }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [toId, setToId] = useState('')
  const [how, setHow] = useState('')

  const relate = useMutation(
    trpc.records.relate.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        setToId('')
        setHow('')
        void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() })
      },
    }),
  )

  const number = Number(toId)
  const named = Number.isInteger(number) && number > 0

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        setToId('')
        setHow('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="record-relate">
          Relate a record
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" data-testid="record-relate-panel" className="w-72">
        <Input
          value={toId}
          inputMode="numeric"
          aria-label="Record number"
          placeholder="#"
          data-testid="record-relate-id"
          onChange={(event) => setToId(event.target.value.replace(/[^0-9]/g, ''))}
        />

        {/* The words are half the act — *"each relation carries how-they-relate
            words"* — so this is a field and not an option. The placeholder is an
            example rather than a vocabulary: the domain has none, deliberately,
            because a shape that insisted on knowing which kind a relation was
            would refuse the fourth kind. */}
        <Input
          value={how}
          aria-label="How they relate"
          placeholder="supersedes, duplicates, caused by…"
          data-testid="record-relate-how"
          onChange={(event) => setHow(event.target.value)}
        />

        {relate.error === null ? null : (
          <p className="text-destructive text-sm" data-testid="record-relate-refusal">
            {relate.error.message}
          </p>
        )}

        <div className="flex gap-2">
          {/**
           * Disabled until there is a number and something to say about it, and
           * on nothing else. Whether *that* number names a record is the store's
           * question, and the answer comes back as a sentence the reader can
           * read — a page that guessed would be guessing about a store it has
           * one record of (`r-untested-rendered-branch`).
           */}
          <Button
            size="sm"
            data-testid="record-relate-save"
            disabled={!named || how.trim().length === 0 || relate.isPending}
            onClick={() => relate.mutate({ fromId: globalId, toId: number, related: true, how })}
          >
            Relate
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
