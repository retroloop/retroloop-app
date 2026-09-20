import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArchiveIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from 'lucide-react'
import { useState } from 'react'
import { ActorTag } from '@/components/actor-tag'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tag, type TagLook } from '@/components/ui/tag'
import { Textarea } from '@/components/ui/textarea'
import { useTRPC } from '@/lib/trpc'

/** One row of the flat cross-retro list, exactly as `records.listAll` sends it. */
export type RecordListRow = AppRouterOutputs['records']['listAll'][number]
/** Where a record stands: open while it is still owed, resolved once fixed, archived once out of the way. */
export type LifecycleState = RecordListRow['lifecycle']['status']

/**
 * What everything below needs of a record: the pair that addresses it, and where
 * it stands.
 *
 * Narrower than `RecordListRow` on purpose. These controls were
 * born on a row of the flat page and now serve two surfaces — that row, and the
 * record's own page, which reads `records.byId` and has no row shape anywhere
 * near it. Taking the pair and the lifecycle is what they always actually used;
 * taking a whole row was them being written where the whole row happened to be.
 *
 * `RecordListRow` satisfies this structurally, so nothing at the row's call site
 * changed. **Their testids moved with them** — `record-lifecycle`,
 * `record-resolve`, `record-archive` and the rest, where they read
 * `records-row-…` while a row was the only place they could be. A row's own
 * parts (`records-row-num`, `records-row-link`, `records-row-identity`,
 * `records-row-severity`, `records-row-requester`) kept their names, because
 * those are still a row's.
 */
export type LifecycleTarget = {
  /** Its own retrospective, never the page's — a rid is minted per retrospective. */
  readonly retroId: number
  readonly rid: string
  readonly lifecycle: RecordListRow['lifecycle']
}

/**
 * What this page has to be able to say: once the AI has fixed an issue there is a
 * native status showing the record was resolved, and an archived position beside
 * it — in the tag idiom every status in this product wears
 * (`components/ui/tag.tsx`).
 *
 * **No position is green**, and that is a decision rather than a palette
 * accident. `approved` is green, and an approved record that has since been
 * fixed is the single most common row on this page: two green pills side by side
 * saying two different things is exactly the "which of these is which"
 * `r-remove-hold` was filed over. Resolved takes blue, the tone this app already
 * gives to *something happened about this*; open takes the neutral tone every
 * not-yet state wears.
 *
 * **Archived takes amber, which is the one hue left and is chosen rather than
 * settled for.** All five tones belong to a verdict already, so this row's mark
 * is going to share a hue with something — the question is with *what*. Neutral
 * is `open`'s, one chip along on the same bar; blue is `resolved`'s, the same;
 * green is ruled out above; and red is `declined`'s, which is the worst of the
 * five, because a declined record is archived *from birth* and that pairing is
 * the most common archived row there is. Amber's only collision is `pending`,
 * and a pending record is one whose review has not closed — archiving one is
 * legal and rare. The tag idiom carries the state in the **word and the icon**
 * and never in the colour alone (`tag.tsx`), so what the hue has to do is be
 * told apart from its neighbours, which amber is.
 *
 * Every position gets a tag, `open` included. It is the same call
 * `DecisionStateTag` makes for `pending` — the state a record is in before
 * anyone acts is a state, not a blank — and it is what closes the loop with the
 * chips on the bar: press "archived", and every row on screen is wearing the
 * mark you pressed.
 */
export const LIFECYCLE_TAG: Record<LifecycleState, TagLook> = {
  open: { fill: 'bg-tone-neutral-soft text-tone-neutral', label: 'open', icon: CircleDotIcon },
  resolved: { fill: 'bg-tone-blue-soft text-tone-blue', label: 'resolved', icon: CircleCheckIcon },
  archived: { fill: 'bg-tone-amber-soft text-tone-amber', label: 'archived', icon: ArchiveIcon },
}

/**
 * The three positions in the order the page speaks them — what is still owed,
 * what is done, what is out of the way — read off the look-up above rather than
 * listed a second time. `Record<LifecycleState, …>` already refuses to compile
 * with a position missing, so a fourth one added to the wire enum has to be
 * given a look before anything can offer it.
 */
export const LIFECYCLE_STATES = Object.keys(LIFECYCLE_TAG) as readonly LifecycleState[]

export function LifecycleTag({ status }: { status: LifecycleState }) {
  return <Tag look={LIFECYCLE_TAG[status]} testId="record-lifecycle" />
}

/**
 * **Somebody has picked this record up** — the in-progress marker, in the same
 * tag idiom every status here wears.
 *
 * **It is not a position on either axis**, which is why it is a look of its own
 * rather than a fourth entry in `LIFECYCLE_TAG` above. A claimed record is still
 * open and still carries whatever verdict it was given; what the claim adds is
 * that someone is doing the work *now*. So it renders beside those tags and
 * only when the wire says a claim stands — never inferred from a verdict, from a
 * lifecycle position, or from how long a record has been sitting there.
 *
 * **The hue is chosen the way §LIFECYCLE_TAG chooses one — by what it collides
 * with — and it lands on amber.** The palette is five tones and every one of
 * them already belongs to something, so the question is never "which is free"
 * but "which one is this badge least likely to be read as":
 *
 * - **green is out.** `approved` is green and an approved record is by far the
 *   most common thing this badge appears beside — the queue an agent claims out
 *   of holds nothing else. Two green pills saying two different things is the
 *   confusion `r-remove-hold` was filed over.
 * - **blue is out, twice over.** `resolved` is blue, and "in progress" next to
 *   "resolved" in one hue is the single pair a reader most needs to tell apart;
 *   `ai` is blue too, and the requester tag is right beside this one.
 * - **neutral is the worst of the five here**, which is not obvious: `open` is
 *   neutral, and *every* claimable record is open — so on the record page, where
 *   both tags render, neutral would collide on every single card it appeared on.
 * - **red is `declined`'s**, and a red IN PROGRESS reads as something having
 *   gone wrong rather than as work under way.
 *
 * That leaves amber, whose owners are `pending` and `archived`. Neither is
 * common beside a claim — the queue offers approved records, and a claim is
 * refused on an archived one — and the two states amber can reach it from are
 * both odd acts somebody took deliberately: claiming a record the review has
 * not decided, or archiving one an agent is working on. The tag carries the
 * state in the **word and the icon** and never in the colour alone (`tag.tsx`),
 * so what the hue owes is to be told apart from its neighbours, which here it is.
 *
 * The icon is a dashed circle: an outline that is not closed yet, which is the
 * one thing a glyph can say that the filled circles beside it do not.
 */
export const CLAIM_TAG: TagLook = {
  fill: 'bg-tone-amber-soft text-tone-amber',
  label: 'in progress',
  icon: CircleDashedIcon,
}

export function ClaimTag() {
  return <Tag look={CLAIM_TAG} testId="record-claim" />
}

/**
 * The evidence behind a resolved record: who said so, what they cited, and
 * whatever they wanted to add.
 *
 * The references are the reason the feature exists — *"we should be able to
 * specify a commit id or github issue or something as reference so that it is
 * easy to see"* — so they are the body of this block rather than a detail behind
 * a disclosure. It is framed with the hairline every block on the review page is
 * drawn with, so it reads as the record's evidence rather than as more of the
 * row's own metadata.
 *
 * It renders **only** on a resolved record. An open one has nothing here by
 * construction: a reopen supersedes the resolve that came before it and carries
 * no references of its own, which is the rule the domain enforces rather than a
 * choice made in this file.
 */
export function ResolvedEvidence({ lifecycle }: { lifecycle: LifecycleTarget['lifecycle'] }) {
  if (lifecycle.status !== 'resolved') return null

  return (
    <div
      data-testid="record-evidence"
      className="flex flex-col gap-2 rounded-md border border-hairline bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="section-label">Resolved by</span>
        {/* Both actors write these rows — it is the one table in the system that
            takes an author — so the row says which, in the same word and the
            same mark the record's own requester wears. */}
        {lifecycle.actor === null ? null : (
          <ActorTag party={lifecycle.actor} testId="record-evidence-actor" />
        )}
      </div>

      <ul className="flex flex-col gap-1" data-testid="record-refs">
        {lifecycle.refs.map((ref) => (
          <li key={ref}>
            <Reference reference={ref} />
          </li>
        ))}
      </ul>

      {lifecycle.note === null ? null : (
        <p className="text-sm leading-relaxed" data-testid="record-note">
          {lifecycle.note}
        </p>
      )}
    </div>
  )
}

/**
 * One reference, linked when it is one.
 *
 * A reference is free text by design — a commit id, a GitHub issue, or anything
 * else — so this asks the only question that has an unambiguous answer —
 * does it name a web address? — and answers the rest by printing what was typed.
 * A commit SHA renders as the SHA: there is nowhere for this page to send a
 * reader with one, and a link that guessed at a host would be a link that
 * eventually guesses wrong. No GitHub integration is implied by any of this and
 * none is coming in round one (the deferred list).
 *
 * `noreferrer` rides with `noopener` because the stage is served from localhost
 * and its URL is nobody's business.
 */
export function Reference({ reference }: { reference: string }) {
  const linkable = reference.startsWith('https://') || reference.startsWith('http://')

  if (!linkable) {
    return (
      <span className="meta-mono break-all" data-testid="record-ref">
        {reference}
      </span>
    )
  }

  return (
    <a
      href={reference}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="record-ref"
      className="meta-mono break-all text-tone-blue underline underline-offset-2"
    >
      {reference}
    </a>
  )
}

/**
 * The human's half of the lifecycle: the acts this record's state permits, and
 * no others.
 *
 * **Explicit only, and never inferred.** Nothing here reads a verdict, a
 * revision or the passage of time as evidence that a record was fixed — the
 * human presses a control, or the record stays where it is (CLAUDE.md: nothing
 * is ever inferred from silence). A **declined** record shows Unarchive without
 * anyone having archived it, and that is not an exception: the page is reading
 * the verdict that was given, which is the one thing that put the record there.
 *
 * **It works on a closed retrospective**, which is the whole point: even after a
 * retrospective has been closed, metadata can be attached to a record so that
 * its lifecycle can be managed. So there is no `readOnly` here and no
 * finished-review branch — the server deliberately does not refuse this write
 * either, and a page that greyed the control out would be inventing a rule the
 * domain does not have.
 *
 * **What each state offers is the domain's transition table, not a layout
 * choice** (`LIFECYCLE_ACT_FROM` in core). Open offers Resolve and Archive;
 * resolved offers Reopen and Archive; archived offers Unarchive alone, because
 * an archived record is out of the way and bringing it back is the act that
 * comes first. A control the server would refuse is a control that should not be
 * on screen.
 *
 * Resolving is the only act with a composer, and the asymmetry is the domain's:
 * a resolve cites at least one reference and nothing else cites any.
 */
export function LifecycleControl({ row }: { row: LifecycleTarget }) {
  if (row.lifecycle.status === 'archived') {
    return <OnePress row={row} status="unarchived" label="Unarchive" testId="record-unarchive" />
  }

  return (
    <>
      {row.lifecycle.status === 'resolved' ? (
        <OnePress row={row} status="reopened" label="Reopen" testId="record-reopen" />
      ) : (
        <Resolve row={row} />
      )}
      <OnePress row={row} status="archived" label="Archive" testId="record-archive" />
    </>
  )
}

/**
 * Marking a record fixed: the references, and a note if there is more to say.
 *
 * **One reference per line**, which is the smallest control that expresses "one
 * or more" — a repeating field with its own add and remove buttons would be
 * three controls where the reader wants to paste two SHAs. The line above the
 * box says so, because a convention nobody states is a convention nobody knows.
 *
 * The submit is disabled until at least one line has something on it. That is
 * the same guard `ComposerBox` puts on Post, and it is deliberately the *only*
 * place this refusal is expressed on screen: the server refuses a resolve with
 * no references and the page simply never sends one, so there is no error branch
 * here for a scenario to be unable to reach (`r-untested-rendered-branch`).
 */
function Resolve({ row }: { row: LifecycleTarget }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [refs, setRefs] = useState('')
  const [note, setNote] = useState('')

  const resolve = useMutation(
    trpc.records.setLifecycle.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        setRefs('')
        setNote('')
        /**
         * The page's own write is the one thing it is certain went stale:
         * `events.onRetro` is scoped to a single retrospective and a flat
         * cross-retro page has nothing single to subscribe to, so there is no
         * live scope here to lean on and none was invented. What the page does
         * instead is ask again after acting, and again when the reader comes
         * back to the tab (`routes/records.tsx`).
         */
        void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() })
      },
    }),
  )

  const cited = citations(refs)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="record-resolve">
          Mark resolved
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" data-testid="record-resolve-panel" className="w-80">
        <label className="section-label" htmlFor={`refs-${row.retroId}-${row.rid}`}>
          References — one per line
        </label>
        <Textarea
          id={`refs-${row.retroId}-${row.rid}`}
          rows={2}
          value={refs}
          placeholder={'a1b2c3d\nhttps://github.com/owner/repo/pull/42'}
          data-testid="record-resolve-refs"
          onChange={(event) => setRefs(event.target.value)}
        />

        <label className="section-label" htmlFor={`note-${row.retroId}-${row.rid}`}>
          Note — optional
        </label>
        <Textarea
          id={`note-${row.retroId}-${row.rid}`}
          rows={2}
          value={note}
          data-testid="record-resolve-note"
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="flex gap-2">
          <Button
            size="sm"
            data-testid="record-resolve-submit"
            disabled={cited.length === 0 || resolve.isPending}
            onClick={() =>
              resolve.mutate({
                /**
                 * The row's own retrospective, never the page's — a rid is
                 * minted per retrospective, so `(retroId, rid)` is the identity
                 * everywhere. This page is the only
                 * surface in the product holding rows from several retros at
                 * once, which makes it the only one that can get this wrong.
                 */
                retroId: row.retroId,
                rid: row.rid,
                status: 'resolved',
                refs: cited,
                // Verbatim, and omitted entirely when there is nothing in it:
                // prose is the writer's and nothing reinterprets it, while a
                // note of spaces is not a note (the server writes no row for
                // one either).
                ...(note.trim().length === 0 ? {} : { note }),
              })
            }
          >
            Resolve
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The three acts that need nothing filled in: reopening, archiving, unarchiving.
 *
 * There is nothing to fill in because the domain refuses references on all three
 * — references belong to the resolve they were cited for — and a `note` is
 * offered by the domain and not asked for here, because nothing on this page
 * renders one except beside a resolve's evidence. A field the page cannot show
 * back is a field that should not be collected.
 *
 * There is no confirm on any of them, because none is terminal the way finishing
 * a review is: every act appends a version, the history keeps all of them, and a
 * mis-press costs one more press. Archiving in particular is not a delete —
 * *"we still want to maintain its discussion"* — which is why it needs no more
 * ceremony than a reopen. `decline is a state, not a deletion` is the same idea
 * one table over.
 *
 * One component rather than three, at the third caller: the repo's own rule for
 * lifting markup is that two copies are a coincidence and three are a rule
 * (`components/ui/tag.tsx`).
 */
function OnePress({
  row,
  status,
  label,
  testId,
}: {
  row: LifecycleTarget
  status: 'reopened' | 'archived' | 'unarchived'
  label: string
  testId: string
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const act = useMutation(
    trpc.records.setLifecycle.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() }),
    }),
  )

  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid={testId}
      disabled={act.isPending}
      // The row's own retrospective, never the page's — a rid is minted per
      // retrospective, so `(retroId, rid)` is the identity everywhere.
      onClick={() => act.mutate({ retroId: row.retroId, rid: row.rid, status })}
    >
      {label}
    </Button>
  )
}

/**
 * What the box actually cites: one reference per line, blank lines dropped.
 *
 * Trimmed here as well as on the server, and that is not a second copy of a
 * rule — it is the same rule asked a different question. The server trims
 * because a reference is a token pasted out of a terminal and the whitespace
 * around it is not part of it; this trims so the page can tell whether the
 * reader has typed a reference yet.
 */
function citations(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
