import { REVIEW_WAIT_EVENT_NAMES, type RetroRef } from '@retro/core'
import type { Argv } from 'yargs'
import { retroRef } from '#args'
import { TimeoutError, UsageError } from '#errors'
import { type CliContext, type CliRuntime, type GlobalOptions, withContext } from '#runtime'
import { localOriginFor } from '#server/address'
import { subscribeToRetroEvents } from '#server/event-stream'
import { readLock } from '#server/lock'

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** The wait's answer, from whichever channel produced it. */
type Outcome = {
  readonly kind: string
  readonly retroId: number | null
  readonly revision: number | null
  readonly at: string
}

/** Which channel produced it. Reported, because a silent degradation is the bug. */
type Channel = 'stream' | 'store'

/**
 * Where to start listening, and **the id of the retrospective it resolved to**.
 *
 * Not "now", and not "the beginning". From **the latest `RevisionCreated` of this
 * retrospective**: a `ReviewFinished` after that point is news about the revision
 * the caller just submitted, while one before it belongs to a round that is
 * already over.
 *
 * That choice closes a real race. The skill's loop is `revision create` then
 * `review wait`; if the human finishes in the moment between those two commands,
 * waiting from "now" would block forever on an event that has already happened.
 * Starting from the revision means the answer is already there and `wait` returns
 * at once.
 *
 * The subscribing form hands this same number to the server as its
 * `lastEventId`, so the replay covers exactly the window the poll would have —
 * the race fix is one decision serving both channels rather than two that have
 * to agree.
 *
 * The retro id rides along because `--session` addressing resolves here and the
 * subscription needs the integer. Reading it off the event costs no second
 * query, and its absence means there is no revision to wait on, which is the one
 * case the stream could not have been opened for anyway.
 */
async function startPointFor(
  context: CliContext,
  retro: RetroRef,
): Promise<{ readonly cursor: number; readonly retroId: number | undefined }> {
  const { events } = await context.app.events.list.execute({
    actor: 'ai',
    retro,
    names: ['RevisionCreated'],
  })
  const latest = events.at(-1)
  return { cursor: latest?.id ?? 0, retroId: latest?.retroId }
}

/**
 * The store, polled — the wait as it has always worked, and the last word.
 *
 * It runs on both paths: the subscribing form falls through to it when there is
 * no server, when the stream cannot be opened or breaks, **and when the stream's
 * deadline passes**. That last one is deliberate. The database is where the
 * press actually lands and the stream is only a faster route to the same rows,
 * so the wait must never report "nothing happened" without having asked the
 * place that would know — a timeout with the answer sitting in the store is
 * precisely the shape of doubt this record was filed about. With the deadline
 * already spent the loop below does exactly one read and then reports the
 * timeout, which costs one query.
 */
async function pollStore(
  context: CliContext,
  retro: RetroRef,
  options: {
    readonly cursor: number
    readonly pollIntervalMs: number
    readonly timeoutSeconds?: number
    readonly deadline?: number
  },
): Promise<Outcome> {
  for (;;) {
    const { events } = await context.app.events.list.execute({
      actor: 'ai',
      retro,
      afterId: options.cursor,
      names: REVIEW_WAIT_EVENT_NAMES,
      limit: 1,
    })
    const outcome = events.at(0)
    if (outcome !== undefined) {
      return {
        kind: outcome.name,
        retroId: outcome.retroId ?? null,
        revision: outcome.revisionN ?? null,
        at: outcome.at,
      }
    }

    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      throw new TimeoutError(
        `timed out after ${options.timeoutSeconds}s waiting for the reviewer to finish`,
      )
    }
    await sleep(options.pollIntervalMs)
  }
}

/** What `wait --any` answers with: the round, and whose it was. */
type AnyFinish = {
  readonly retroId: number
  /** Its place within its session — the "Retro #n" a reader sees on the page. */
  readonly retro: number
  readonly sessionId: number
  readonly finishedAt: string
}

/**
 * The wait, addressed to the whole stage rather than to one retrospective.
 *
 * **It starts from the outbox head and nothing earlier counts.** The
 * per-retrospective wait starts from the revision it is waiting on, because the
 * press it wants may have landed in the moment between `revision create` and
 * `review wait` — a race with one right answer. This form has no revision to
 * start from, and "the whole history" is not an answer to "tell me when
 * something finishes": every stage with a finished round would return instantly,
 * with whichever one happened first. So the window opens when the command does,
 * and the question about the past is a different command — `review list
 * --finished`, which is also why `--timeout 0` is refused here rather than
 * quietly answering "nothing".
 *
 * **A finish only counts for the revision under review.** `ReviewFinished`
 * outlives the round it was about: the AI answers it with a new draft and the
 * retrospective goes back to the human, while the event stays in the outbox
 * forever. `review.listFinished` is the read that settles it — a retrospective
 * has a row there exactly when its *latest* revision was finished — so an event
 * whose revision is no longer the latest is stepped over and the cursor moves
 * past it, rather than being re-read until the deadline.
 */
async function waitForAnyFinish(
  context: CliContext,
  options: {
    readonly pollIntervalMs: number
    readonly timeoutSeconds?: number
  },
): Promise<AnyFinish> {
  // The head as the command starts, whatever its name: `latestId` comes back
  // from every page precisely so a consumer filtering by name still advances
  // past the events it did not ask for.
  const { latestId } = await context.app.events.list.execute({ actor: 'ai', limit: 1 })
  let cursor = latestId
  const deadline =
    options.timeoutSeconds === undefined ? undefined : Date.now() + options.timeoutSeconds * 1000

  for (;;) {
    const { events } = await context.app.events.list.execute({
      actor: 'ai',
      afterId: cursor,
      names: ['ReviewFinished'],
    })

    if (events.length > 0) {
      // One read for the whole batch, and read *after* the events, so a row can
      // only be fresher than the event it is asked about.
      const { reviews } = await context.app.review.listFinished.execute({ actor: 'ai' })
      for (const event of events) {
        cursor = event.id
        const row = reviews.find(
          (candidate) =>
            candidate.retroId === event.retroId && candidate.revisionN === event.revisionN,
        )
        if (row === undefined) continue
        return {
          retroId: row.retroId,
          retro: row.retroNumber,
          sessionId: row.sessionId,
          finishedAt: row.finishedAt,
        }
      }
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new TimeoutError(
        `timed out after ${options.timeoutSeconds}s waiting for any review to finish (--any)`,
      )
    }
    await sleep(options.pollIntervalMs)
  }
}

/**
 * The finish, off the server's live stream — or `undefined`, meaning "ask the
 * store instead".
 *
 * Every way this can fail is the same answer: there is a store one function call
 * away that holds the truth, so a stream that cannot deliver is a reason to poll
 * and never a reason to fail the command. What the caller loses by falling back
 * is latency, and what it would lose by raising is the wait itself.
 */
async function streamOutcome(
  origin: string,
  retroId: number,
  options: { readonly cursor: number; readonly deadline?: number },
): Promise<Outcome | undefined> {
  const controller = new AbortController()
  const expiry =
    options.deadline === undefined
      ? undefined
      : setTimeout(() => controller.abort(), Math.max(0, options.deadline - Date.now()))

  try {
    for await (const event of subscribeToRetroEvents({
      origin,
      retroId,
      lastEventId: options.cursor,
      signal: controller.signal,
    })) {
      // The stream carries the whole retrospective *and its session* — a replay
      // hands over decisions and comments too. One name ends the wait, the same
      // one the polling filter names (`REVIEW_WAIT_EVENT_NAMES`).
      if (!(REVIEW_WAIT_EVENT_NAMES as readonly string[]).includes(event.name)) continue
      return { kind: event.name, retroId: event.retroId, revision: event.revisionN, at: event.at }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    if (expiry !== undefined) clearTimeout(expiry)
    controller.abort()
  }
}

/**
 * The origin of the server holding this stage, or `undefined` when none does.
 *
 * The stage lock is the answer to "is a server up", and it is already how `up`,
 * `down` and `resolveStage` decide the same thing — a lock whose process is gone
 * is no lock at all, so a crashed server reads as no server rather than as a
 * connection that will hang.
 */
function runningServerOrigin(lockFile: string): string | undefined {
  const lock = readLock(lockFile)
  return lock === undefined ? undefined : localOriginFor(lock.bind, lock.port)
}

async function waitForOutcome(
  context: CliContext,
  retro: RetroRef,
  options: {
    readonly pollIntervalMs: number
    readonly timeoutSeconds?: number
    readonly follow: boolean
  },
): Promise<{ readonly outcome: Outcome; readonly via: Channel }> {
  const { cursor, retroId } = await startPointFor(context, retro)
  const deadline =
    options.timeoutSeconds === undefined ? undefined : Date.now() + options.timeoutSeconds * 1000

  // Three things have to hold before a connection is worth opening, and
  // `--timeout 0` is the interesting one: it asks "has the human finished yet?", a
  // question the store answers completely and instantly because it is where the
  // rows are. No stream can beat a local read, and opening one for a question
  // already answered would be a connection nobody needed. The third is a
  // retrospective with a revision on it — without one there is nothing to
  // subscribe about, and the poll below is what reports that.
  if (options.follow && options.timeoutSeconds !== 0 && retroId !== undefined) {
    const origin = runningServerOrigin(context.stage.lockFile)
    if (origin !== undefined) {
      const streamed = await streamOutcome(origin, retroId, { cursor, deadline })
      if (streamed !== undefined) return { outcome: streamed, via: 'stream' }
    }
  }

  return {
    outcome: await pollStore(context, retro, {
      cursor,
      pollIntervalMs: options.pollIntervalMs,
      timeoutSeconds: options.timeoutSeconds,
      deadline,
    }),
    via: 'store',
  }
}

/**
 * `review status`, `review wait`, `review close` and `review list`.
 *
 * `wait` tails the events table from its own process (realtime.md §CLI waiting) —
 * no server involved, so it works when the server is down, which is the whole
 * reason capture and waiting do not depend on it. It returns on one event name
 * now (`r-one-finish-button`): the human presses one button, and what the round
 * was *about* is read from the round, not from which button they chose.
 *
 * **`--follow` subscribes instead of polling** (`r-monitor-not-realtime`).
 * Under the poll a human pressed Finish and the watching agent heard it only
 * seconds later. The app side already carries events, so the CLI can take them
 * in realtime the same way the UI updates, and this is it: `--follow` opens the
 * server's `events.onRetro` stream, the same ~300 ms channel every open review
 * page holds, and returns the instant the finish is pushed. It degrades to the
 * poll above whenever the stream cannot deliver — no server on the stage, a
 * connection refused, a stream that breaks — because the database is where the
 * press actually lands and the stream is only a faster way to the same rows.
 * That fallback is the edge and not the norm: a live review implies a running
 * server, since the page being reviewed is served by it.
 *
 * **Which channel answered is in the output**, as `via`. A wait that quietly
 * degraded to polling would put back the exact ambiguity this record removed —
 * a quiet few seconds after a press that the presser cannot tell from a broken
 * pipe. It is on the subscribing form alone; the shapes cli.md pins for the
 * existing forms are untouched.
 *
 * `close` is the other end of that change, and the only act on a review the AI
 * has ever had. After the wait returns, the AI reads the round — the records the
 * human sent back with `revise`, the threads still waiting on an answer — and
 * either files the next revision or runs this, which takes the retrospective to
 * `finished` and makes the export possible. It decides nothing: it refuses unless
 * the human has finished *this* revision, every record is decided, and none of
 * them asked to be rewritten (`close-review.use-case.ts`).
 *
 * **`--any` and `list --finished` are the same two questions asked by an agent
 * that owns no retrospective.** Both existing forms need an address, which a
 * caller only has when it filed the revision itself; a watcher that did not had
 * to poll `review status` per retrospective, and one arriving after the press
 * had nowhere to look at all. `wait --any` is the forward question — tell me
 * when the next round is put down, anywhere — and `list --finished` is the
 * backward one, every round already put down and whether the AI closed it. They
 * are deliberately not one command with a flag for time's direction: a wait that
 * answered about the past would return instantly on any stage with history, and
 * that is exactly the `--timeout 0` this form refuses.
 */
export function registerReviewCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'review <action>',
    'Check on a review, wait for the human, or close it to export',
    (yargs) =>
      yargs
        .positional('action', {
          choices: ['status', 'wait', 'close', 'list'] as const,
          describe: 'What to do',
        })
        .option('retro', { type: 'number', describe: 'Retrospective id' })
        .option('session', { type: 'string', describe: 'Session id or UUID (its active retro)' })
        .option('any', {
          type: 'boolean',
          default: false,
          describe:
            'wait: return on the next finish anywhere on the stage; needs no --retro/--session',
        })
        .option('finished', {
          type: 'boolean',
          default: false,
          describe: 'list: every retrospective whose latest revision the human has finished',
        })
        .option('timeout', {
          type: 'number',
          describe: 'wait: give up after this many seconds and exit 7',
        })
        .option('follow', {
          type: 'boolean',
          default: false,
          describe:
            "wait: subscribe to the running server's live events; falls back to polling the store",
        })
        .epilogue(
          [
            'FINISHED means the human pressed Finish on the LATEST revision — which',
            'they cannot do while a record is undecided. A round they finished and the AI',
            'answered with a new revision is not finished any more.',
            '',
            'wait --any blocks until any retrospective on this stage is finished. It',
            'takes no --retro/--session, and only a finish landing AFTER the command',
            'started counts: the window opens at the outbox head. So --timeout 0 is',
            'refused (exit 2) instead of always answering "nothing" — for finishes',
            'that already happened, run review list --finished.',
            '',
            '--follow subscribes when the server offers a stream for the whole stage;',
            'today every stream is per retrospective, so --any polls the store at the',
            'poll interval and reports via: "store".',
            '',
            'JSON:',
            '  wait --any  {"retroId":N,"retro":n,"sessionId":N,"finishedAt":"<iso>"}',
            '              plus "via" with --follow',
            '  list        [{"retroId","retro","sessionId","claudeSession",',
            '                "finishedAt","closed","counts"}] — oldest first',
            '',
            'Exit: 0 answered · 2 bad flags · 3 no such retrospective · 4 the close',
            'was refused · 7 the wait timed out ({"error":{"code":"TIMEOUT"}}).',
          ].join('\n'),
        ),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const anywhere = args.any === true
        const follow = args.follow === true

        // Both flags belong to exactly one action, and a flag on the wrong one
        // is a caller who thinks they asked for something else — answering the
        // action they typed and dropping the flag would be the CLI guessing.
        if (anywhere && args.action !== 'wait') {
          throw new UsageError(
            `--any is a form of \`review wait\`, not of \`review ${args.action}\``,
          )
        }
        if (args.finished === true && args.action !== 'list') {
          throw new UsageError(
            `--finished is a form of \`review list\`, not of \`review ${args.action}\``,
          )
        }

        if (args.action === 'list') {
          if (args.finished !== true) {
            throw new UsageError(
              '`review list` needs --finished; that is the only list it offers today',
            )
          }

          const { reviews } = await context.app.review.listFinished.execute({ actor: 'ai' })
          context.output.result(
            reviews.map((review) => ({
              retroId: review.retroId,
              retro: review.retroNumber,
              sessionId: review.sessionId,
              claudeSession: review.claudeSession,
              finishedAt: review.finishedAt,
              closed: review.closed,
              counts: review.counts,
            })),
            () =>
              reviews
                .map(
                  (review) =>
                    `Retro ${review.retroId} (#${review.retroNumber} of session ${review.sessionId}) ` +
                    `finished ${review.finishedAt}${review.closed ? ', closed' : ''} — ` +
                    // The same three the `status` line prints, and for the same
                    // reason: `pending` is zero on every row here by definition,
                    // and `hold` is zero on every store written since
                    // `r-hold-semantics`.
                    `${review.counts.approved} approved, ${review.counts.declined} declined, ` +
                    `${review.counts.revise} to revise`,
                )
                .join('\n') || 'No finished retrospectives.',
          )
          return
        }

        if (anywhere) {
          if (args.retro !== undefined || args.session !== undefined) {
            throw new UsageError(
              '--any waits for whatever finishes next; name a retrospective or say --any, not both',
            )
          }
          // `--timeout 0` asks "has anything finished yet?", and this form's
          // window starts now — it would answer "no" to a question about the
          // past, every time, correctly and uselessly.
          if (args.timeout === 0) {
            throw new UsageError(
              '--any cannot answer --timeout 0: its window opens when the command starts. ' +
                'Use `review list --finished` for the finishes that already happened',
            )
          }

          const finish = await waitForAnyFinish(context, {
            pollIntervalMs: runtime.pollIntervalMs,
            timeoutSeconds: args.timeout,
          })

          context.output.result(
            { ...finish, ...(follow ? { via: 'store' } : {}) },
            () =>
              `Retro ${finish.retroId} (#${finish.retro} of session ${finish.sessionId}) ` +
              `finished at ${finish.finishedAt}` +
              (follow ? ' (polled the store)' : ''),
          )
          return
        }

        const retro = retroRef(args)

        if (args.action === 'status') {
          const status = await context.app.review.status.execute({ actor: 'ai', retro })
          context.output.result(
            {
              retroId: status.retroId,
              state: status.state,
              finished: status.finished,
              revision: status.revisionN ?? null,
              counts: status.counts,
            },
            () =>
              `Retro ${status.retroId} (${status.state}) revision ${status.revisionN ?? '—'}: ` +
              // The frozen `counts.hold` bucket is not printed: it is zero on
              // every store written since `r-hold-semantics`, and a line that
              // says "0 on hold" is a line that has to be explained. The `held`
              // count that used to sit beside these is gone with the feature
              // (`r-remove-hold`). `revise` *is* printed — it is a live
              // verdict, and it is the one the AI has to act on.
              `${status.counts.pending} pending, ${status.counts.approved} approved, ` +
              `${status.counts.declined} declined, ${status.counts.revise} to revise`,
          )
          return
        }

        if (args.action === 'close') {
          const { retrospective, revisionN } = await context.app.review.close.execute({
            actor: 'ai',
            retro,
          })
          context.output.result(
            {
              retroId: retrospective.id,
              state: retrospective.state,
              revision: revisionN,
              finishedAt: retrospective.finishedAt ?? null,
            },
            () => `Retro ${retrospective.id} closed at revision ${revisionN}; ready to export.`,
          )
          return
        }

        const { outcome, via } = await waitForOutcome(context, retro, {
          pollIntervalMs: runtime.pollIntervalMs,
          timeoutSeconds: args.timeout,
          follow,
        })

        // `via` only on the form that has two channels to choose between: the
        // blocking and `--timeout 0` forms answer in cli.md's four keys, and a
        // fifth appearing under them would widen a contract every monitor
        // script already parses.
        context.output.result(
          { ...outcome, ...(follow ? { via } : {}) },
          () =>
            `${outcome.kind} on retro ${outcome.retroId} revision ${outcome.revision}` +
            (follow ? ` (${via === 'stream' ? 'live stream' : 'polled the store'})` : ''),
        )
      }),
  )
}
