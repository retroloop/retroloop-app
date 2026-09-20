import type { AppRouterOutputs } from '@retro/api'
import { useMutation } from '@tanstack/react-query'
import { CheckIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Prose } from '@/components/review/prose'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTRPC } from '@/lib/trpc'

/**
 * One comment thread as the panel renders it, and the composer every comment on
 * the page is typed into. Both are here rather than in `review-thread.tsx`
 * because that file is about *where* the comments mount and this one is about
 * what a comment looks like — the fork between the rail and the sheet is
 * presentation and nothing else.
 *
 * There is exactly one caller. A record's comments used to be
 * rendered under the section they answered, by a `CommentThreads` component that
 * lived here; the side panel replaced that, so the human sees every comment in
 * one place rather than scattered through the retrospective body. A record
 * thread and a review thread are now the same card in the same column,
 * and the record thread carries a line saying where it hangs.
 */
export type Thread = AppRouterOutputs['threads']['list'][number]
type Message = Thread['messages'][number]

/** What a posted message makes stale. Held by the panel, which owns the query. */
export type Invalidate = () => Promise<void>

/**
 * Where a record thread hangs, already resolved into the words to print: the
 * panel does the lookup because it is the one holding the revision's records,
 * and a card that went looking for them would be a card that needs the list.
 */
export type ThreadAnchor = {
  readonly rid: string
  /** The record's number in the whole ledger — the same one its card and the rail print. */
  readonly globalId: number
  readonly title: string
  /** The section's display title, from the one map (`lib/enum-labels.ts`). */
  readonly section: string
  readonly sectionKey: string
}

/**
 * One thread: its opening message, its replies behind a count, and what the
 * human may do to it.
 *
 * **Collapsed by default, one level deep.** The panel nests one level and shows
 * only top-level comments with a reply count; a click opens the replies.
 * A panel that showed every message of every thread
 * is the reading column's problem moved sideways — the point of a column of
 * threads is that you can see how many conversations are open, which a wall of
 * messages hides. There is no third level to worry about: the model has threads
 * and messages and nothing else (data-model.md §Comment threads).
 */
export function ThreadCard({
  thread,
  anchor,
  readOnly,
  invalidate,
  onJump,
}: {
  thread: Thread
  /** `null` for a thread about the review itself — there is nowhere to point. */
  anchor: ThreadAnchor | null
  readOnly: boolean
  invalidate: Invalidate
  onJump: (rid: string) => void
}) {
  const [showReplies, setShowReplies] = useState(false)
  const [showSettled, setShowSettled] = useState(false)
  const [replying, setReplying] = useState(false)

  const [opener, ...replies] = thread.messages

  /**
   * A settled thread is one dimmed line: resolved comments appear
   * collapsed. Dimmed **and** marked: the fade says "dealt with" at a
   * glance and the word says it to anyone being read to, because a state told
   * only by opacity is a state a screen reader cannot report.
   *
   * It opens on a click like any other collapsed thing here, which is what keeps
   * "resolved" from meaning "gone": a thread is history and settling one is
   * a note about it, not a deletion.
   */
  if (thread.resolved && !showSettled) {
    return (
      <div
        data-testid="thread"
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline bg-surface px-3 py-2.5 text-muted-foreground opacity-60"
      >
        {/* The anchor stays. What collapses is the *conversation* — a settled
            thread that also stopped saying which record it is on would be a line
            the reader has to open to identify, in the one panel whose whole job
            is that a comment says where it hangs. */}
        {anchor === null ? null : <AnchorLine anchor={anchor} onJump={onJump} />}
        <button
          type="button"
          data-testid="thread-settled"
          aria-expanded={false}
          onClick={() => setShowSettled(true)}
          className="flex w-full items-baseline gap-2 rounded-sm text-left"
        >
          <CheckIcon aria-hidden className="size-3 shrink-0 translate-y-0.5" />
          <span className="section-label shrink-0" data-testid="thread-settled-mark">
            Resolved
          </span>
          {/* The opener alone, and truncated: enough to recognise the thread by,
              which is all a settled one is on screen for. */}
          <span className="min-w-0 truncate text-xs" data-testid="thread-settled-opener">
            {opener?.text ?? ''}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      // `min-w-0`: the anchor line's title does not wrap, and a flex item that
      // will not shrink below its content is a rail that pushes the page
      // sideways: nothing on this page scrolls sideways.
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline bg-surface px-3 py-2.5"
      data-testid="thread"
    >
      {anchor === null ? null : <AnchorLine anchor={anchor} onJump={onJump} />}

      {thread.resolved ? (
        <button
          type="button"
          data-testid="thread-settled"
          aria-expanded={true}
          onClick={() => setShowSettled(false)}
          className="flex w-fit items-center gap-1.5 rounded-sm text-muted-foreground"
        >
          <CheckIcon aria-hidden className="size-3 shrink-0" />
          <span className="section-label" data-testid="thread-settled-mark">
            Resolved
          </span>
        </button>
      ) : null}

      {opener === undefined ? null : <ThreadMessage message={opener} />}

      {replies.length === 0 ? null : (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-muted-foreground"
            data-testid="thread-replies"
            aria-expanded={showReplies}
            onClick={() => setShowReplies((shown) => !shown)}
          >
            {replies.length === 1 ? '1 reply' : `${replies.length} replies`}
          </Button>

          {showReplies ? (
            // The one level of nesting the model has, drawn as one: a rule down
            // the left and an indent, so a reply is visibly under its opener
            // rather than merely after it.
            <div
              className="flex flex-col gap-2 border-hairline border-l pl-3"
              data-testid="thread-reply-list"
            >
              {replies.map((message) => (
                <ThreadMessage key={message.id} message={message} />
              ))}
            </div>
          ) : null}
        </>
      )}

      {readOnly ? null : (
        <ThreadControls
          thread={thread}
          invalidate={invalidate}
          replying={replying}
          setReplying={setReplying}
        />
      )}
    </div>
  )
}

/**
 * Where a record thread hangs, and the way back to it — the panel's answer to
 * the question the section heading used to answer for free.
 *
 * **One pattern, in one order** (`r-thread-header-format`): the number, then
 * a separator, then the section, then a separator, then the title. It used to
 * be two fixed lines — the number and title on one, the section under them — and
 * that shape did not survive the first read of a list of section threads.
 * The section is the discriminator between threads on the same record, so it
 * belongs beside the number and before the title; the title is the part that
 * varies in length, so it is last and it is the part that gives way.
 *
 * **Two lines and no more, cut only when it would need a third.**
 * `line-clamp-2` is exactly that and nothing else: a header that fits on
 * one line is one line, one that needs two takes two, and one that would run past
 * two ends in an ellipsis. Unclamped, a long title pushes every thread below it
 * down the panel; fully truncated, the reader loses the scent of which record
 * this is.
 *
 * A button, because it goes somewhere: the same `jumpTo` the record rail's
 * entries use (`record-filter.tsx`), so a comment and an index entry put the
 * reviewer down in exactly the same place.
 */
function AnchorLine({ anchor, onJump }: { anchor: ThreadAnchor; onJump: (rid: string) => void }) {
  return (
    <button
      type="button"
      data-testid={`thread-anchor-${anchor.rid}-${anchor.sectionKey}`}
      onClick={() => onJump(anchor.rid)}
      className="flex w-full min-w-0 rounded-sm text-left hover:text-primary"
    >
      <span className="meta-mono line-clamp-2 min-w-0" data-testid="anchor-line">
        #{anchor.globalId} · {anchor.section} · {anchor.title}
      </span>
    </button>
  )
}

/**
 * One message: who wrote it, which revision it belongs to, and what it says.
 *
 * A comment shows the revision number it is associated with, while the comments
 * themselves show across all revisions — and
 * both halves are here: the panel never filters by revision, and every message
 * says which one it was written against, so a thread that ran across two rounds
 * reads as one conversation with its history legible.
 *
 * `revision` is always a number on the wire, stored at write or derived from the
 * revision timestamps for messages older than the column (`thread.view.ts`), so
 * this line never has a hole in it.
 *
 * **No relative time, deliberately.** An earlier meta line read
 * `human · rev 1 · 1d` and the third field is not carried over: nothing on this
 * page shows a timestamp, minimalism holds it back until something asks for it,
 * and "1d" is the kind of thing that has to be recomputed on a tick to stay true.
 */
function ThreadMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="thread-message">
      <div className="flex items-baseline gap-1.5">
        <span className="section-label" data-testid="thread-message-actor">
          {message.actor}
        </span>
        <span aria-hidden className="text-muted-foreground text-xs">
          ·
        </span>
        <span className="meta-mono tabular-nums" data-testid="thread-message-revision">
          rev {message.revision}
        </span>
      </div>
      {/* A comment is prose someone just wrote, so it is read the same way
          a record's sections are — one renderer, one subset (prose.tsx). */}
      <Prose text={message.text} testId="thread-message-text" />
    </div>
  )
}

/**
 * What a human may do to a thread they are reading, and the whole of it.
 *
 * Settling is **human only, at the schema level** (`r-resolvable-comments`:
 * *"a human-only resolved flag per comment (or per thread), visible state on the
 * review page, AI forbidden at the schema level like every human field"*), and
 * this control is the visible half — the enforcement is `ForbiddenActorError` in
 * the use case, which no button can talk its way past.
 *
 * A settled thread offers **only** the way back. Reopening is another act, not
 * an undo, and a settled thread that still took replies would be a thread the
 * human said they were done with that keeps growing.
 */
function ThreadControls({
  thread,
  invalidate,
  replying,
  setReplying,
}: {
  thread: Thread
  invalidate: Invalidate
  replying: boolean
  setReplying: (replying: boolean) => void
}) {
  const trpc = useTRPC()
  const settle = useMutation(
    trpc.threads.resolve.mutationOptions({ onSuccess: () => invalidate() }),
  )

  if (thread.resolved) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
        data-testid="thread-reopen"
        disabled={settle.isPending}
        onClick={() => settle.mutate({ threadId: thread.id, resolved: false })}
      >
        Reopen
      </Button>
    )
  }

  if (replying) {
    return (
      <ReplyComposer
        threadId={thread.id}
        invalidate={invalidate}
        onDone={() => setReplying(false)}
      />
    )
  }

  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
        data-testid="thread-reply"
        onClick={() => setReplying(true)}
      >
        Reply
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
        data-testid="thread-resolve"
        disabled={settle.isPending}
        onClick={() => settle.mutate({ threadId: thread.id, resolved: true })}
      >
        Resolve
      </Button>
    </div>
  )
}

function ReplyComposer({
  threadId,
  invalidate,
  onDone,
}: {
  threadId: number
  invalidate: Invalidate
  onDone: () => void
}) {
  const trpc = useTRPC()
  const reply = useMutation(
    trpc.threads.reply.mutationOptions({
      onSuccess: () => {
        onDone()
        return invalidate()
      },
    }),
  )

  return (
    <ComposerBox
      testid="thread-reply-submit"
      placeholder="Reply"
      pending={reply.isPending}
      onCancel={onDone}
      onPost={(text) => reply.mutate({ threadId, text })}
    />
  )
}

/**
 * The two-field composer every comment on the page is typed into — the panel's
 * one standing composer and the reply box inside a thread.
 *
 * `onCancel` is optional because one of the two callers has nothing to cancel:
 * the panel's composer stands open from the moment the page does
 * (`r-review-actions-pinned`), so a Cancel button there would close a box the
 * reviewer never opened. A reply is opened by a click and Cancel is how that
 * click is taken back.
 *
 * `aimedAt` is a counter rather than a boolean: the reviewer can press Comment
 * on one section, change their mind, and press it on another, and a boolean
 * would only move the keyboard the first time. Zero means nobody aimed it — the
 * page opening does not steal the keyboard from the records.
 */
export function ComposerBox({
  testid,
  placeholder,
  pending,
  aimedAt = 0,
  onPost,
  onCancel,
}: {
  testid: string
  placeholder: string
  pending: boolean
  aimedAt?: number
  onPost: (text: string) => void
  onCancel?: () => void
}): ReactNode {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (aimedAt === 0) return
    box.current?.focus()
  }, [aimedAt])

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={box}
        rows={2}
        value={text}
        placeholder={placeholder}
        data-testid={`${testid}-text`}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid={testid}
          disabled={text.trim().length === 0 || pending}
          onClick={() => onPost(text)}
        >
          Post
        </Button>
        {onCancel === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
