import { REVIEW_WAIT_EVENT_NAMES, type RetroRef } from '@retro/core'
import type { Argv } from 'yargs'
import { retroRef } from '#args'
import { TimeoutError } from '#errors'
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
  // `--timeout 0` is the interesting one: it asks "has he finished yet?", a
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
 * `review status`, `review wait` and `review close`.
 *
 * `wait` tails the events table from its own process (realtime.md §CLI waiting) —
 * no server involved, so it works when the server is down, which is the whole
 * reason capture and waiting do not depend on it. It returns on one event name
 * now (retro 4 `r-one-finish-button`): the human presses one button, and what
 * the round was *about* is read from the round, not from which button he chose.
 *
 * **`--follow` subscribes instead of polling** (retro 10
 * `r-monitor-not-realtime`). The owner pressed Finish and the watching agent
 * heard it seconds later — *"I pressed finish just now, why you received event
 * after a few seconds?"* — and named the fix himself: *"the app side supports
 * events, cannot the cli receive events in realtime? I mean the way UI gets
 * updated in the realtime."* It can, and this is it: `--follow` opens the
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
 * has ever had. After the wait returns, the AI reads the round — the records
 * he sent back with `revise`, the threads still waiting on an answer — and
 * either files the next revision or runs this, which takes the retrospective to
 * `finished` and makes the export possible. It decides nothing: it refuses
 * unless he has finished *this* revision, every record is decided, and none of
 * them asked to be rewritten (`close-review.use-case.ts`).
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
          choices: ['status', 'wait', 'close'] as const,
          describe: 'What to do',
        })
        .option('retro', { type: 'number', describe: 'Retrospective id' })
        .option('session', { type: 'string', describe: 'Session id or UUID (its active retro)' })
        .option('timeout', {
          type: 'number',
          describe: 'wait: give up after this many seconds and exit 7',
        })
        .option('follow', {
          type: 'boolean',
          default: false,
          describe:
            "wait: subscribe to the running server's live events; falls back to polling the store",
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
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
              // (retro 4 `r-remove-hold`). `revise` *is* printed — it is a live
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

        const follow = args.follow === true
        const { outcome, via } = await waitForOutcome(context, retro, {
          pollIntervalMs: runtime.pollIntervalMs,
          timeoutSeconds: args.timeout,
          follow,
        })

        // `via` only on the form that has two channels to choose between: the
        // blocking and `--timeout 0` forms have answered in cli.md's four keys
        // since item 4, and a fifth appearing under them would widen a contract
        // every monitor script already parses.
        context.output.result(
          { ...outcome, ...(follow ? { via } : {}) },
          () =>
            `${outcome.kind} on retro ${outcome.retroId} revision ${outcome.revision}` +
            (follow ? ` (${via === 'stream' ? 'live stream' : 'polled the store'})` : ''),
        )
      }),
  )
}
