import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ActorTag } from '@/components/actor-tag'
import { AppShell } from '@/components/chrome/app-shell'
import { NotFoundPage } from '@/components/chrome/placeholder-page'
import { RecordAttributes } from '@/components/records/record-attributes'
import { RecordLabelControl, RecordLabelTags } from '@/components/records/record-labels'
import {
  ClaimTag,
  LifecycleControl,
  LifecycleTag,
  ResolvedEvidence,
} from '@/components/records/record-lifecycle'
import { RecordRelations } from '@/components/records/record-relations'
import { RecordTimeline } from '@/components/records/record-timeline'
import { DecisionStateTag } from '@/components/review/decision-state'
import { RecordNarrative } from '@/components/review/record-card'
import { Badge } from '@/components/ui/badge'
import { APP_NAME } from '@/lib/app-name'
import { integerId } from '@/lib/ids'
import { retroIdentityLine } from '@/lib/retro-identity'
import { useTRPC } from '@/lib/trpc'

/**
 * `records_.$recordId.tsx`, with the underscore — the flat-file router's opt-out
 * from nesting.
 *
 * `records.$recordId.tsx` beside `records.tsx` would make the flat records page
 * a **parent layout** for this one: the generator nests on the shared prefix, so
 * `/records/7` would render `records.tsx` and look for an `<Outlet/>` it does
 * not have, and the reader would get the list with nothing under it. The
 * trailing underscore says the two share a URL prefix and nothing else, which is
 * true — this page is not the list with a record inside it.
 */
export const Route = createFileRoute('/records_/$recordId')({ component: RecordRoute })

function RecordRoute() {
  const { recordId: raw } = Route.useParams()
  const id = integerId(raw)
  // `/records/nope` and `/records/007` are not requests for a record, and this
  // page says so without asking the server (`lib/ids.ts`).
  if (id === undefined) return <NotFoundPage what="record" id={raw} />
  return <RecordPage id={id} />
}

/**
 * One record, on a page of its own — each record has its own dedicated page,
 * with a consistent width and overall layout, and a way to go to the retro
 * page.
 *
 * **The URL is the global number**, which is the one name a record has that is
 * not a pair. `(retroId, rid)` is what addresses a record everywhere inside the
 * product, and is not something anyone types, pastes into a message or
 * bookmarks; the page a reader sends to somebody else is `/records/7`. Every
 * write this page makes still goes by the pair, which is why `records.byId`
 * answers with it.
 *
 * **It reverses a standing rule.** Until now the review page was a record's
 * only detail view and the flat page's rows landed on it with `?record=`; that
 * used to read as a bug the first time it was used — clicking a record led to a
 * retrospective. The anchor mechanism did not go away: it is what the link
 * *out* of this page uses, so leaving here for the review lands on this record
 * rather than at the top of a round holding a dozen of them.
 *
 * **What is not here.** No comments — they are left out of this page. No
 * settings: the vocabularies are global and are managed at `/settings`, so this
 * page offers the labels a store has and never the ability to invent one. No
 * decision controls: a verdict is given inside its review, against a revision
 * the reviewer chose, and offering one here would be a second place to decide a
 * record. No revision picker and no history diff — this page is the record as
 * it stands, and one record across every revision is Tier 2. No severity or
 * involvement dials: they are the verdict's values, judged where the verdict is
 * given.
 */
function RecordPage({ id }: { id: number }) {
  const trpc = useTRPC()
  /**
   * **`refetchOnWindowFocus` is turned back on for this one query**, against the
   * app-wide default and for the reason the flat records page turns it on:
   * `events.onRetro` is scoped to one retrospective, and while this page *is*
   * about one, subscribing would mean holding a live stream open for a single
   * record's two axes. What the page does instead is what its own list does —
   * it invalidates after its own writes, and it asks again when the reader
   * comes back to the tab, which is exactly when the AI has been working the
   * fix queue in its own process.
   */
  const record = useQuery({
    ...trpc.records.byId.queryOptions({ id }),
    refetchOnWindowFocus: true,
  })

  const crumbs = [
    { label: APP_NAME, to: '/' as const },
    { label: 'Records', to: '/records' as const },
    { label: `#${id}` },
  ]

  /**
   * A number nothing was minted for, and a record a later draft withdrew, are
   * one answer from the server and one page here: there is no record with that
   * number *now*, which is what the reader needs to know either way.
   */
  if (record.isError) return <NotFoundPage what="record" id={String(id)} />
  if (record.data === undefined) return <AppShell crumbs={crumbs} />

  const page = record.data

  return (
    <AppShell crumbs={crumbs}>
      {/**
       * `wide:max-w-[48rem]` — the review page's own reading column, and the
       * same measure for the same reason: the page grew to 1536px at `wide` for
       * three columns, and prose handed all of it runs to a line length a UI
       * review already called a defect once. It sits at the left rather than
       * centred, because the whole of the width rule is that content starts
       * where content starts — the breadcrumb above it does, the dashboard's
       * rows do, and a column centred under a left-aligned trail would be this
       * page disagreeing with every other one.
       *
       * Below `wide` the column is the page, as everywhere else; above it the
       * room a rail would use stays empty, because this page has no rails.
       */}
      <div className="flex min-w-0 flex-col gap-5 wide:max-w-[48rem]">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* The number in the whole ledger — the same one the row that
                was clicked showed, and the one in the URL that can be sent. */}
            <span className="meta-mono" data-testid="record-num">
              #{page.globalId}
            </span>
            <Badge variant="outline" data-testid="record-type">
              {page.record.type}
            </Badge>
            {/* Both axes, because this is the one page that carries both about
                one record: the verdict the review settled, and where the record
                stands since. */}
            <DecisionStateTag state={page.decision.state} />
            <LifecycleTag status={page.lifecycle.status} />
            {/**
             * And whether anybody is on it right now — a third thing that is
             * true about the record, beside the two axes rather than on either
             * of them: a claimed record is still open and still carries the
             * verdict the review gave it.
             *
             * This page is where a reader comes to ask where a record stands, so
             * it is the one surface outside the review that says so. The flat
             * records page deliberately does not: it is a place to find a record,
             * and a marker that changed under the reader while an agent worked
             * the queue would earn nothing there.
             */}
            {page.claim === null ? null : <ClaimTag />}
            <ActorTag party={page.record.requester} testId="record-requester" />
          </div>

          <h1
            className="font-semibold text-lg leading-snug tracking-tight"
            data-testid="record-title"
          >
            {page.record.title}
          </h1>

          {/**
           * **The way to the retro** — the record page offers a way to go to
           * the retro page.
           *
           * It is the identity line itself rather than a button beside it: the
           * line already says which retrospective the record came from, in the
           * same words the dashboard row and the records row say it
           * (`lib/retro-identity.ts`), and a control repeating that in other
           * words would be two things pointing at one place. `?record=` is the
           * anchor the flat page's rows used to carry, so arriving lands on this
           * record inside its review rather than at the top of it
           * (`retros.$retroId.tsx`).
           */}
          <Link
            to="/retros/$retroId"
            params={{ retroId: String(page.retroId) }}
            search={{ record: page.record.rid }}
            data-testid="record-retro-link"
            className="meta-mono break-words hover:underline"
          >
            {retroIdentityLine(page)}
          </Link>
        </header>

        {/**
         * **What the record wears and what it carries** — a pair, and the
         * surface the migrate story actually happens on: on completion of the
         * retro, records may move into GitHub right away, wearing a label that
         * says 'migrated'.
         *
         * Both work on a **closed** retrospective, like the lifecycle controls
         * below them and for the same reason — that is when this gets used.
         *
         * The labels live in their own row rather than up in the header's tag
         * strip, which is where the review card and the records row put them.
         * The difference is that this is the page where they are *edited*: the
         * control belongs beside the tags it changes, and a control in the
         * header would sit among the two state tags it has nothing to do with.
         */}
        <div className="flex flex-wrap items-center gap-2" data-testid="record-label-row">
          <RecordLabelTags labels={page.labels} />
          <RecordLabelControl retroId={page.retroId} rid={page.record.rid} labels={page.labels} />
        </div>

        <RecordAttributes
          retroId={page.retroId}
          rid={page.record.rid}
          attributes={page.attributes}
        />

        {/**
         * **What this record was said to have to do with other records**, in
         * the band that already answers *data about this record*: between what
         * it carries and the evidence behind its resolve.
         *
         * It is here rather than beside the timeline because a relation is not
         * something that happened to this record — it is a second record, with a
         * name and a link, and a reader following one is going somewhere. The
         * timeline stays three kinds and no fourth.
         */}
        <RecordRelations globalId={page.globalId} relations={page.relations} />

        <ResolvedEvidence lifecycle={page.lifecycle} />

        {/* The acts this record's state permits, and no others — the same
            controls the row offers, addressed to the same `(retroId, rid)`.
            They work on a closed retrospective by design, which is the whole
            ask: even after a retro has been closed, metadata can still be
            attached to its records. */}
        <div className="flex flex-wrap items-center gap-1" data-testid="record-actions">
          <LifecycleControl
            row={{ retroId: page.retroId, rid: page.record.rid, lifecycle: page.lifecycle }}
          />
        </div>

        {/* The record itself, rendered by the component the review card renders
            it with. Read-only: the tick shows which solution the verdict
            carries, and there is no Select and no comment button, because
            neither is something you do from here. */}
        <RecordNarrative record={page.record} picked={page.decision.selectedSolution} readOnly />

        <RecordTimeline timeline={page.timeline} />
      </div>
    </AppShell>
  )
}
