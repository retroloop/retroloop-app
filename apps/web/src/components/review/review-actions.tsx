import type { AppRouter, AppRouterOutputs } from '@retro/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TRPCClientErrorLike } from '@trpc/client'
import { CheckCircle2Icon, SendHorizontalIcon } from 'lucide-react'
import { type Ref, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useTRPC } from '@/lib/trpc'

type RecordList = AppRouterOutputs['records']['list']

/**
 * **One act, and nothing else** (`r-one-finish-button`). There were two buttons
 * here — Finish review and Request changes, one per event the system could
 * raise — and the second went the first time a round forced a choice between
 * them. With both on screen, a reviewer who had requested a lot of changes in
 * the comments could still press Finish review, and the press would claim the
 * wrong event: which event the round raises has to be clear from the content of
 * the comments rather than from a redundant button that can be pressed wrong.
 *
 * So Finish says one thing — *I am done with this round* — and the AI reads the
 * round to know what it was. What it is not is the end of the retrospective:
 * that arrives from the AI's own side, over the event stream, as a review that
 * has gone read-only.
 *
 * It fires **once per round** (`r-request-changes-multi-press`): the button
 * stays where it was, spent — disabled, still named — with a mark beside it
 * saying the round is with the AI, and the server absorbs a duplicate anyway.
 * It stays rather than leaving because a control that vanishes takes the layout
 * and the answer to *"did that work?"* with it. Nothing on this page ever
 * finishes a review because time passed, because every comment was answered, or
 * because the reviewer scrolled to the bottom.
 *
 * **It moved into the sticky bar and lost its box.** It was a bordered panel at
 * the end of the reading column holding a pending count, the action, and the
 * refusal. The box went and the action moved up beside the filters — filters on
 * the left, the Finish button on the right. Two things went with the box:
 *
 *   - **the pending count.** The pending chip on the same bar carries it live,
 *     and a second copy on the same strip would be a number to keep in agreement
 *     with the one beside it;
 *   - **the refusal's permanent place.** It has no room on a one-line bar, so it
 *     is a popover on the button that was refused — which is also where the
 *     reviewer is looking when it happens.
 *
 * What replaced the box's third job: once a review is finished the button is
 * replaced by an icon and text saying the retrospective has been submitted.
 *
 * **The press became two presses** (`r-finish-confirm-message`), as a guard
 * against finishing by accident. Pressing Finish is two steps: if the round is
 * actually valid and can be closed, a text box opens where the human enters their
 * final message before closing, and that message is delivered separately from the
 * comments. So the first press arms and the second answers, and between them
 * sits the round's last word — optional, and blank is the same as absent,
 * because nothing on this page is ever inferred from an empty field.
 *
 * The refusal and the confirm share the one popover on the one button, because
 * they are the same conversation: the confirm is what asks the server and the
 * refusal is what the server says back. They can never be open at once, which is
 * why the state below is one value rather than two booleans that could disagree.
 *
 * **The gate moved to the first press** (`r-finish-refusal-fires-late`): a
 * refusal has to show on the first press rather than the second, or the human's
 * composed input is at risk of being lost. The gate predates the two-step and
 * had stayed attached to the send, so the redesign silently reordered check and
 * composition — the reviewer wrote their last word on the round and only then
 * learned the round could not finish.
 *
 * Everything the refusal needs is on the page before the first press, so the
 * first press is where it is asked, and on a round that cannot finish the
 * composer never opens at all. The server's check stays exactly where it was, as
 * the backstop for the one case the page cannot see: a verdict taken back
 * somewhere else between the composer opening and the send. When *that* fires,
 * the composed text is kept rather than discarded — so the input that was at
 * risk is safe on both paths, by never being written on one and by never being
 * thrown away on the other.
 */
export function ReviewActions({
  retroId,
  list,
  finished,
  roundFinished,
  readOnly,
  ref,
}: {
  retroId: number
  list: RecordList
  finished: boolean
  /**
   * Whether the human has finished **the revision on screen**, as the store has
   * it (`revisionMeta.finishedAt`, via `retros.get`).
   *
   * Distinct from `finished` beside it, which is the retrospective's own
   * terminal state — the AI's close. Between the two there is a real gap the
   * page has to render: the round is with the AI, and the retro is still
   * `reviewing`.
   */
  roundFinished: boolean
  readOnly: boolean
  /**
   * The filter's landing target for a reviewer who has just decided the last
   * record in it (`record-filter.tsx`, `r-departure-keyboard-focus`). There is
   * nowhere else on the page to put them: every record they were filtering for
   * is gone, and this is what is left to do. Since the bar is sticky the landing
   * is a focus move and nothing else — the target was never off screen.
   */
  ref?: Ref<HTMLElement>
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  /** Where the keyboard goes back to when the refusal is dismissed. */
  const button = useRef<HTMLButtonElement>(null)
  /**
   * What the one popover is saying, if anything — and it carries the refusal's
   * rids rather than leaving them to be re-derived while it renders.
   *
   * **That is the whole reason this is one value.** Deriving `open` from the
   * mutation's error meant the popover could compute *closed* for the render
   * between "the reviewer answered the confirm" and "the error reached the
   * query cache", and a close that reaches Radix sends the state back to idle —
   * so the refusal that should have replaced the confirm never appeared at all.
   * Instrumented rather than guessed at: the stage did reach `refused`, the rids
   * were there, and something had already put it back. Reading the rids where
   * the error is *handled* removes the ordering from the question entirely.
   *
   * Dismissible in both positions, so being on screen is not the same question
   * as the mutation having failed: a reviewer who has read the refusal and
   * pressed Escape has an error on the mutation and nothing to look at.
   */
  type Stage =
    | { readonly at: 'idle' }
    | { readonly at: 'confirming' }
    | { readonly at: 'refused'; readonly pending: readonly string[] }
  const [stage, setStage] = useState<Stage>({ at: 'idle' })
  /** The round's last word, until the confirm is answered or abandoned. */
  const [message, setMessage] = useState('')
  const messageId = useId()

  /**
   * The popover is never closed on the way to the answer, only when the answer
   * arrives — so the confirm the reviewer just answered turns into the answer,
   * on the control they are already looking at.
   *
   * A retry needs no clearing here: arming again is what sets `confirming`, and
   * that is what takes the refusal off the screen. An error carrying no rids —
   * a conflict rather than the gate — has nothing to show, so it closes instead
   * of opening an empty popover nobody can act on.
   */
  const finish = useMutation(
    trpc.review.finish.mutationOptions({
      onError: (error) => {
        /**
         * **The composed message is not touched here, and that is the point**
         * (`r-finish-refusal-fires-late`): a refusal that lands after the message
         * is written risks losing the human's input. A refusal at send time can
         * only happen on a round the page believed was finishable, so there is by
         * definition something written in the composer when it fires. It stays
         * written — the reviewer presses Finish again and their last word on the
         * round is still there. Only a finish that actually landed clears it, below.
         */
        const refused = pendingRidsOf(error)
        setStage(refused === undefined ? { at: 'idle' } : { at: 'refused', pending: refused })
      },
      onSuccess: () => {
        setStage({ at: 'idle' })
        setMessage('')
        return queryClient.invalidateQueries({ queryKey: trpc.retros.pathKey() })
      },
    }),
  )
  /**
   * Whether *this* round has been finished — a round is a revision, so when the
   * AI files the next one the button has to come back.
   *
   * **The store answers it now, and that is the fix** (`r-finish-button-reenables`):
   * a finished review that said "sent" offered the Finish button again after a
   * page refresh. It used to be `finish.isSuccess` alone — in-memory state a
   * fresh page could not recover — so a refresh offered the button again for a
   * revision the store had already recorded as finished. The press had landed:
   * the monitor had the `ReviewFinished` for exactly that revision while the
   * refreshed page was still offering to send it. It was a read-side gap, and
   * the fact simply was not on the wire; `revisionMeta.finishedAt` carries it
   * now.
   *
   * The mutation's own answer stays as the second half, and only as that: it
   * covers the frames between the server saying yes and the invalidated
   * `retros.get` coming back, where the store-derived half is still false and a
   * button that re-enabled for one paint would be the same lie in miniature.
   */
  const sent = roundFinished || (finish.isSuccess && finish.data.revision === list.revision)
  /**
   * What the finish gate would refuse over, from what the page already holds.
   *
   * The same question the server answers, asked of the list the reviewer is
   * looking at — which is why the first press can answer it at all. The two can
   * disagree, and the send-time check below is what that disagreement is for:
   * this one is a stale read by construction, and the server's is the one that
   * decides.
   */
  const undecided = list.records
    .filter((record) => record.state === 'pending')
    .map((record) => record.rid)

  return (
    <section
      ref={ref}
      // Reachable by `.focus()`, never by tabbing — the tab order stays the
      // controls inside it.
      tabIndex={-1}
      className="ml-auto flex items-center gap-2.5 outline-none"
      data-testid="review-actions"
    >
      {finished ? (
        /**
         * The shape is the point: an icon *and* a word, never a colour on its
         * own, so the state survives a reader who cannot tell the tones apart
         * and a theme that redefines them.
         */
        <p
          className="inline-flex items-center gap-1.5 text-muted-foreground text-sm"
          data-testid="review-finished"
        >
          <CheckCircle2Icon aria-hidden className="size-4" />
          Retro submitted
        </p>
      ) : readOnly ? (
        <p className="text-muted-foreground text-sm" data-testid="review-read-only">
          Revision {list.revision} is not the latest, so it is read-only.
        </p>
      ) : (
        <>
          {sent ? (
            /**
             * The acknowledgment the press had none of, in the room a bar has:
             * the icon and the word say it landed, and the sentence that says
             * what happens next — the thing the second button used to say — is
             * carried where a bar can afford it, on the element's own accessible
             * name and its tooltip.
             */
            <span
              className="inline-flex items-center gap-1.5 text-muted-foreground text-sm"
              data-testid="finish-acknowledged"
              title={WITH_THE_AI}
            >
              <SendHorizontalIcon aria-hidden className="size-4" />
              Sent
              <span className="sr-only"> — {WITH_THE_AI}</span>
            </span>
          ) : null}

          <Popover
            open={stage.at !== 'idle'}
            onOpenChange={(open) => {
              if (!open) setStage({ at: 'idle' })
            }}
          >
            <PopoverAnchor asChild>
              <Button
                ref={button}
                data-testid="finish-review"
                disabled={finish.isPending || sent}
                /**
                 * **The gate runs here, on the first press**
                 * (`r-finish-refusal-fires-late`). A refusal that arrives after
                 * the finishing message has been typed is a refusal that can
                 * cost the human their input, so it shows on the first press
                 * rather than the second.
                 *
                 * The two-step finish was added for the finishing message and
                 * the gate predates it, so the redesign quietly reordered check
                 * and composition: the composer opened, the reviewer wrote their
                 * last word on the round, and *then* the page said the round
                 * could not finish. Everything the refusal needs was known
                 * before the first press — the popover already named the records
                 * — so the composer is simply unreachable on a round that cannot
                 * finish, and there is no composed text to put at risk.
                 *
                 * It is the same refusal, from the same list, in the same
                 * popover; what changed is only when it is asked.
                 */
                onClick={() =>
                  setStage(
                    undecided.length > 0
                      ? { at: 'refused', pending: undecided }
                      : { at: 'confirming' },
                  )
                }
              >
                Finish review
              </Button>
            </PopoverAnchor>

            {stage.at === 'confirming' ? (
              /**
               * Step two, and the round's last word on the way through it. The
               * message is **optional and says so**: the nearest composer on
               * this page disables its Post until something is typed, and
               * copying that here would quietly make an optional field
               * mandatory. So the submit is live on an empty box, and an empty
               * box sends nothing — the core use case trims and writes no row,
               * which is where that rule lives so the CLI obeys it too.
               */
              <PopoverContent
                align="end"
                sideOffset={8}
                data-testid="finish-confirm"
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  button.current?.focus()
                }}
              >
                <p className="font-medium">Finish this round?</p>
                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground text-xs" htmlFor={messageId}>
                    Final message (optional)
                  </label>
                  <Textarea
                    id={messageId}
                    rows={3}
                    value={message}
                    data-testid="finish-message"
                    placeholder="Goes to the AI with the round, not as a comment."
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    data-testid="finish-confirm-submit"
                    disabled={finish.isPending}
                    onClick={() =>
                      finish.mutate({
                        retroId,
                        // Blank is absent: an empty box is not a message, and
                        // the key is left off rather than sent empty.
                        finishMessage: message.trim() === '' ? undefined : message.trim(),
                      })
                    }
                  >
                    Finish review
                  </Button>
                </div>
              </PopoverContent>
            ) : null}

            {stage.at !== 'refused' ? null : (
              /**
               * The finish gate refused. Saying only "no" would leave the
               * reviewer to find the undecided records themselves, so the server
               * sends the rids (`PRECONDITION_FAILED`, payload per trpc.md) and
               * the page names them — on the control that was refused, because
               * that is where the reviewer is looking, and dismissibly, because
               * a bar has no room to keep it.
               */
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-80 gap-1.5 border border-tone-red/30 bg-tone-red-soft text-tone-red ring-0"
                data-testid="finish-refusal"
                /**
                 * A refusal does not close because focus moved, and saying so
                 * is load-bearing rather than defensive.
                 *
                 * The refusal replaces the confirm *in place*, so the confirm
                 * unmounts in the same commit — and the confirm's own
                 * `onCloseAutoFocus` puts the keyboard back on the button as it
                 * goes. That focus lands outside the refusal that has just
                 * mounted, which Radix reads as the reviewer leaving it and
                 * dismisses it on the spot: the refusal appeared and vanished
                 * in one frame, and the page looked like the finish had
                 * silently done nothing. Measured, not guessed — with the
                 * dismissal disabled the refusal stayed and every one of its
                 * scenarios passed.
                 *
                 * The two ways out the scenarios lock — Escape, and a press
                 * somewhere else — are untouched: both are dismissals this does
                 * not speak for.
                 */
                onFocusOutside={(event) => event.preventDefault()}
                // Radix returns focus to a trigger and this popover has an
                // anchor instead, so the way back to the button is said here.
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  button.current?.focus()
                }}
              >
                <p className="text-sm">
                  Every record has to be decided before the review can finish.
                </p>
                <ul className="flex flex-col gap-0.5">
                  {stage.pending.map((rid) => (
                    <li
                      key={rid}
                      className="meta-mono text-tone-red"
                      data-testid={`finish-refusal-${rid}`}
                    >
                      {titleOf(list, rid)}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            )}
          </Popover>
        </>
      )}
    </section>
  )
}

/** What the press did, and what happens because of it. */
const WITH_THE_AI =
  'the AI reads what you asked for and either files a new revision or closes this retro'

/** The rids a refused finish came back with, when that is what happened. */
function pendingRidsOf(
  error: TRPCClientErrorLike<AppRouter> | null,
): readonly string[] | undefined {
  if (error === null || error.data === null || error.data === undefined) return undefined
  return 'pendingRids' in error.data ? error.data.pendingRids : undefined
}

function titleOf(list: RecordList, rid: string): string {
  const found = list.records.find((record) => record.rid === rid)
  // The number the rest of the page shows this record by, so the refusal names
  // the same records the reviewer is looking at rather than a second numbering.
  return found === undefined ? rid : `#${found.globalId} ${found.title}`
}
