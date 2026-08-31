import type { Argv } from 'yargs'
import { parseJsonInput, readTextInput, retroRef, sessionRef } from '#args'
import { UsageError } from '#errors'
import { type CliContext, type CliRuntime, type GlobalOptions, withContext } from '#runtime'
import { threadJson } from '#views'

/**
 * `revision create` — the AI submits a draft.
 * `revision get` — the draft back with every piece of human feedback on it, or
 * with `--feedback-only` the feedback alone.
 *
 * `retro` in the returned `{ retroId, retro, revision, url }` is the
 * retrospective's **1-based position within its session**, not its id. cli.md
 * gives the shape without saying which, and KC-0011 settles it: the breadcrumb is
 * "Project › Session › Retro #n · Rev k", so `retro` and `revision` are the two
 * human-facing numbers of that pair while `retroId` is the address.
 */
export function registerRevisionCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'revision <action>',
    'Submit a revision, or read one back with its feedback',
    (yargs) =>
      yargs
        .positional('action', { choices: ['create', 'get'] as const, describe: 'What to do' })
        /**
         * `create` requires `--session` and `--file`; `get` requires neither, and
         * takes `--retro` instead. yargs' `demandOption` cannot depend on the
         * positional, so the demand is made per action in the handler — and there
         * is a test that `create` still refuses to run without either one.
         */
        .option('session', {
          type: 'string',
          describe: 'create: session id or UUID; get: the session’s active retro',
        })
        .option('file', {
          type: 'string',
          describe: 'create: JSON matching the revision schema, or - for stdin',
        })
        .option('expect-revision', {
          type: 'number',
          describe: 'create: refuse (exit 4) unless the revision about to be written is this one',
        })
        .option('retro', { type: 'number', describe: 'get: retrospective id' })
        .option('revision', { type: 'number', describe: 'get: revision number [default: latest]' })
        .option('feedback-only', {
          type: 'boolean',
          default: false,
          describe: 'get: decisions and comments only — no record bodies',
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        if (args.action === 'get') {
          await getRevision(context, args)
          return
        }

        if (args.session === undefined) throw new UsageError('revision create needs --session')
        if (args.file === undefined) throw new UsageError('revision create needs --file')

        const raw = await readTextInput({ file: args.file }, runtime, 'revision create')
        const revisionInput = parseJsonInput(
          raw,
          args.file === '-' ? 'the revision on stdin' : args.file,
        )

        const session = sessionRef(args.session)
        const created = await context.app.revisions.create.execute({
          actor: 'ai',
          session,
          revision: revisionInput,
          expectRevision: args.expectRevision,
        })

        const retrospectives = await context.app.sessions.get.execute({ actor: 'ai', session })
        const position =
          retrospectives.retrospectives.findIndex((retro) => retro.id === created.retroId) + 1

        const url = context.stage.urlForRetro(created.retroId, created.revision.n)
        context.output.result(
          {
            retroId: created.retroId,
            retro: position,
            revision: created.revision.n,
            url,
          },
          () =>
            `Revision ${created.revision.n} of retro #${position} — ${created.revision.records.length} record(s) — ${url}`,
        )
      }),
  )
}

type GetArgs = {
  readonly retro?: number
  readonly session?: string
  readonly revision?: number
  readonly feedbackOnly: boolean
}

/**
 * The two projections cli.md documents, kept honestly different.
 *
 * `--feedback-only` is not the full shape with the bodies nulled out — it is the
 * verdict fields and nothing else, because the AI reads it to answer "what did the
 * human say", and padding that answer with keys it must ignore is how a caller
 * ends up parsing the wrong one.
 *
 * `--feedback-only` also carries `finishMessage` since
 * `r-finish-confirm-message`: the word he left when he finished the round, which
 * the owner asked to have *"delivered separately from the comments"* and which
 * belongs to the same question this projection answers. It is `null` when he left
 * none, like every other optional here — a key that comes and goes is a shape a
 * script has to guess at. The full projection does not carry it: the record names
 * this one.
 *
 * `held` and `holdNote` were in both projections for one session. Retro 4
 * `r-remove-hold` took them out with the feature: whether to pick an item up
 * without the human is `involvement`, which is a verdict field and is already
 * in both. `requests` went the same way (`r-remove-requests`) — the asks are
 * review-level comments now, and they are in `threads`.
 */
async function getRevision(context: CliContext, args: GetArgs): Promise<void> {
  const retro = retroRef(args)

  if (args.feedbackOnly) {
    const feedback = await context.app.revisions.feedback.execute({
      actor: 'ai',
      retro,
      revision: args.revision,
    })

    context.output.result(
      {
        retroId: feedback.retrospective.id,
        // The retrospective's **stored** state, and deliberately not the
        // displayed reading `review status` gives: `open`, `reviewing` or
        // `finished`, never `submitted`. This command is addressed to a
        // revision and reports the row the retrospective is in; the command
        // that answers "where does the round stand" is `review status`, and it
        // is the one that carries the fourth word (`design/cli.md`,
        // `design/lifecycle.md` §submitted).
        state: feedback.retrospective.state,
        revision: {
          n: feedback.revision.n,
          createdAt: feedback.revision.createdAt,
          records: feedback.revision.records,
        },
        records: feedback.records.map((verdict) => ({
          rid: verdict.rid,
          num: verdict.num,
          state: verdict.state,
          decidedOnRevision: verdict.decidedOnRevision ?? null,
          contentChangedSince: verdict.contentChangedSince ?? null,
          severity: verdict.severity,
          solutionLevel: verdict.solutionLevel,
          selectedSolution: verdict.selectedSolution ?? null,
          involvement: verdict.involvement,
          reviewerNote: verdict.reviewerNote ?? null,
        })),
        threads: feedback.threads.map(threadJson),
        finishMessage: feedback.finishMessage ?? null,
      },
      () => summarize(feedback.records, feedback.threads.length, feedback.finishMessage),
    )
    return
  }

  const view = await context.app.revisions.get.execute({
    actor: 'ai',
    retro,
    revision: args.revision,
  })

  context.output.result(
    {
      retroId: view.retrospective.id,
      /** The stored state, as in the `--feedback-only` form above — not `review status`'s reading. */
      state: view.retrospective.state,
      revision: {
        n: view.revision.n,
        createdAt: view.revision.createdAt,
        records: view.revision.records,
      },
      records: view.records.map((record) => ({
        rid: record.record.rid,
        num: record.record.num,
        title: record.record.title,
        type: record.record.type,
        state: record.decision.state,
        decidedOnRevision: record.decision.decidedOnRevision ?? null,
        carriedOver: record.decision.carriedOver,
        contentChangedSince: record.decision.contentChangedSince ?? null,
        severity: record.decision.severity,
        solutionLevel: record.decision.solutionLevel,
        selectedSolution: record.decision.selectedSolution ?? null,
        involvement: record.decision.involvement,
        reviewerNote: record.decision.reviewerNote ?? null,
        content: record.record,
      })),
      threads: view.threads.map(threadJson),
    },
    () =>
      summarize(
        view.records.map((record) => ({
          num: record.record.num,
          state: record.decision.state,
        })),
        view.threads.length,
      ),
  )
}

function summarize(
  records: readonly { readonly num: number; readonly state: string }[],
  threads: number,
  finishMessage?: string,
): string {
  const states = records.map((record) => `${record.num}. ${record.state}`).join('\n')
  const lines = [states, `${threads} thread(s)`]
  if (finishMessage !== undefined) lines.push(`Final message: ${finishMessage}`)
  return lines.join('\n')
}
