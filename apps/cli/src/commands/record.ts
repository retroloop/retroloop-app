import type { RecordLifecycleStatus } from '@retro/core'
import type { Argv } from 'yargs'
import { retroRef } from '#args'
import { UsageError } from '#errors'
import { type CliContext, type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/** The four lifecycle actions this command offers, as the words they write. */
type LifecycleAction = 'resolve' | 'reopen' | 'archive' | 'unarchive'

const ACT_OF_ACTION: Record<LifecycleAction, RecordLifecycleStatus> = {
  resolve: 'resolved',
  reopen: 'reopened',
  archive: 'archived',
  unarchive: 'unarchived',
}

/** The verb a person reads back. Past tense, because it has already happened. */
const DONE_OF_ACTION: Record<LifecycleAction, string> = {
  resolve: 'Resolved',
  reopen: 'Reopened',
  archive: 'Archived',
  unarchive: 'Unarchived',
}

/**
 * A `#globalId` off the command line.
 *
 * Refused rather than coerced, and the message names the shape it wanted: the
 * commonest mistake here is reaching for a rid, because every other act on this
 * command takes one — so the refusal has to say which of the two names a
 * relation uses, and why.
 */
function globalId(value: string | undefined, which: string): number {
  const parsed = Number(value)
  if (value === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(
      `record relate needs the ${which} record's #globalId — the number \`record list\` puts first, ` +
        'not a rid: a relation names two records, and (retro, rid) is the address of one',
    )
  }
  return parsed
}

/**
 * `record list` — the records of a revision with the state each one is actually
 * in, carry-over included (D2). `carriedOver` and `decidedOnRevision` are what let
 * the AI tell "the human approved this" from "the human approved an earlier
 * version of this", which is the difference that decides whether to touch it.
 *
 * It leads with `#globalId`, which is the number the human is looking at when he
 * says "do 47 first" — the per-retro `num` he used to see restarted at 1 in every
 * retrospective, which is the reading he called weird. Both numbers are in the
 * `--json` shape, along with the rid every write is still addressed by.
 *
 * There were `held` and `holdNote` fields beside them for one session and there
 * are not any more (retro 4 `r-remove-hold`). "Not to be picked up without me"
 * is `involvement`, which the human sets with the verdict.
 *
 * `--state hold` still filters, and still finds nothing on any store written
 * since `r-hold-semantics`: a decision made before it keeps that state forever.
 * `--state revise` is the live one to reach for after a finish (retro 4
 * `r-verdict-revise`): it lists the records the human asked to see rewritten,
 * which are the ones the next revision has to address.
 *
 * `record resolve` and `record reopen` — **the AI's half of the lifecycle axis**
 * (the owner, session 8: *"once the AI fixes those issues, we should have a way
 * to … show that this issue was resolved, we should be able to specify a commit
 * id or github issue or something as reference so that it is easy to see"*).
 *
 * This is the transport for the AI's writes, the way every AI write in this
 * system reaches the store: in-process, against the same SQLite file, never
 * through the server (KC-0004). The human's half of the same use case is
 * `records.setLifecycle` over tRPC, and the row records which of them wrote it —
 * this is the one table in the store with an `actor` column, because it is the
 * one both of them write.
 *
 * `record archive` and `record unarchive` — **the human's half, and they are
 * refused here.** The owner kept the archive pair for himself (session 9:
 * *"the user should be able to unarchive … if a user wants, they can just
 * archive it"*), so `SetRecordLifecycleUseCase` rejects the `ai` actor on those
 * two acts and the CLI writes as `ai` and nothing else.
 *
 * **They are still offered, which is the departure.** The house pattern for a
 * human-only write is a use-case refusal and no CLI surface at all — that is
 * what `threads.resolve` and `review.finish` do, and `data-model.md` says so
 * twice. This does the opposite on purpose: the archive pair sits on the same
 * table, the same command and the same rid as `resolve`, which the AI uses
 * constantly, so an agent will reach for it. Offering it and answering *"marking
 * a record archived is written by the human actor; ai may not perform it"*
 * (exit 5) teaches the rule; hiding it answers "Invalid values: Argument:
 * action" and teaches that the author mistyped something.
 *
 * None of the four takes `--revision`. A record's lifecycle is deliberately not
 * bound to a draft of it: the fix landed against the retrospective, and it goes
 * on being landed when the AI redrafts the record. That is the same reasoning a
 * thread resolution has no revision.
 *
 * The two that work keep working after the review has closed, which is the point
 * — the owner asked for lifecycle *because* the retro is finished by the time
 * anyone fixes anything.
 *
 * `record relate` and `record unrelate` — **the feature's stated purpose, and
 * the AI is the actor it was asked for** (the owner, session 11: *"both actors
 * can relate records, each relation carries how-they-relate words, and the
 * relation reads from both sides, so that AI can easily find past records and
 * build holistic solutions."*)
 *
 * **They are the one pair here addressed by numbers rather than by a rid**, and
 * that is not a convenience: a relation names two records, and `(retroId, rid)`
 * is the address of one. The global id is the only single-column handle a record
 * has (`record-id.model.ts`) — it is also what `record list` puts first, so the
 * two commands compose: list the records, then relate the numbers. `--retro` and
 * `--session` are **refused** on both, because a global number needs no
 * retrospective to be read in, and accepting one would suggest a relation lives
 * inside a retrospective when the whole point is that it does not.
 *
 * `--how` is required on `relate` and refused on `unrelate`. The words are half
 * the act — *"each relation carries how-they-relate words"* — and the removal
 * row carries forward the words of the relation it takes off, so there is
 * nothing for a second set to be about.
 *
 * Like the lifecycle pair they take no `--revision`: a relation is not bound to
 * a draft of either record, and it outlives every redraft of both. They keep
 * working after the review has closed for a stronger version of the lifecycle's
 * reason — the record at the far end is normally in a retrospective that closed
 * sessions ago.
 */
export function registerRecordCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'record <action> [rid] [to]',
    'Inspect a revision’s records, mark one resolved after fixing it, or relate two',
    (yargs) =>
      yargs
        .positional('action', {
          choices: [
            'list',
            'resolve',
            'reopen',
            'archive',
            'unarchive',
            'relate',
            'unrelate',
          ] as const,
          describe: 'What to do (archive/unarchive are the human’s and are refused here)',
        })
        .positional('rid', {
          type: 'string',
          describe:
            'resolve/reopen/archive/unarchive: which record, e.g. r-stale-lock · relate/unrelate: the #globalId the relation is authored FROM',
        })
        .positional('to', {
          type: 'string',
          describe: 'relate/unrelate: the #globalId it is authored TO',
        })
        .option('how', {
          type: 'string',
          describe:
            'relate: how the two relate, in your words — required, and the row keeps them when the relation is taken off',
        })
        .option('retro', { type: 'number', describe: 'Retrospective id' })
        .option('session', { type: 'string', describe: 'Session id or UUID (its active retro)' })
        .option('revision', { type: 'number', describe: 'list: revision number [default: latest]' })
        .option('state', {
          choices: ['pending', 'approved', 'declined', 'revise', 'hold'] as const,
          describe: 'list: only records in this state (`hold` is a pre-split verdict)',
        })
        .option('ref', {
          type: 'string',
          array: true,
          describe:
            'resolve: what shows it was fixed — a commit sha, PR or issue URL, ticket. Repeatable; at least one is required',
        })
        .option('note', {
          type: 'string',
          describe: 'resolve/reopen/archive: one line on why, offered and never demanded',
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        /**
         * yargs types every positional as optional, and `<action>` is neither:
         * it is required and carries a `choices` list, so the parser has already
         * refused an absent or unknown one before this runs. Naming the fallback
         * is a type obligation rather than a branch anybody can reach — and it
         * has to be named, because two of the four acts below are looked up by
         * this word rather than compared to it.
         */
        const action = args.action ?? 'list'

        if (action === 'relate' || action === 'unrelate') {
          await relateRecords(context, args, action)
          return
        }

        const retro = retroRef(args)

        if (action === 'list') {
          // Refused rather than ignored: `record list r-stale-lock` is somebody
          // expecting a filter, and answering with the whole revision would look
          // like the filter matched everything.
          if (args.rid !== undefined) {
            throw new UsageError(
              'record list takes no record id; it lists the whole revision. Use `record get`-style reads via `revision get`.',
            )
          }

          const { retroId, revisionN, records } = await context.app.records.list.execute({
            actor: 'ai',
            retro,
            revision: args.revision,
            state: args.state,
          })

          context.output.result(
            {
              retroId,
              revision: revisionN,
              records: records.map((view) => ({
                rid: view.record.rid,
                /**
                 * The number the human sees on the page and says out loud — so
                 * the AI reading this list can find the record he means. `num`
                 * stays beside it because it is what the draft authored and what
                 * a resubmitted draft must keep saying; `globalId` is minted by
                 * the store and is not part of a draft at all
                 * (`record-id.model.ts`).
                 */
                globalId: view.globalId,
                num: view.record.num,
                title: view.record.title,
                type: view.record.type,
                state: view.decision.state,
                severity: view.decision.severity,
                solutionLevel: view.decision.solutionLevel,
                selectedSolution: view.decision.selectedSolution ?? null,
                involvement: view.decision.involvement,
                carriedOver: view.decision.carriedOver,
                decidedOnRevision: view.decision.decidedOnRevision ?? null,
                /**
                 * Where the record stands *after* the review that filed it —
                 * `open`, `resolved` or `archived` — and the entry that put it
                 * there (#103 `r-lifecycle-projection-gap`).
                 *
                 * This is the read-back the AI actually makes: it resolves a
                 * batch of records through this same command and then lists them
                 * to check the writes landed. Until this key existed the list
                 * said nothing about them, which reads exactly like a store that
                 * refused every write.
                 *
                 * Nested rather than flattened the way `record resolve` flattens
                 * its own answer: that command reports one write, this reports a
                 * row's standing, and the five fields are one thing.
                 */
                lifecycle: {
                  status: view.lifecycle.status,
                  refs: [...view.lifecycle.refs],
                  note: view.lifecycle.note ?? null,
                  actor: view.lifecycle.actor ?? null,
                  at: view.lifecycle.at ?? null,
                },
                /**
                 * What somebody said this record has to do with other records,
                 * both directions (the owner's session-11 ask).
                 *
                 * **This is the read-back the feature exists for.** *"So that AI
                 * can easily find past records"* is answered here or nowhere: the
                 * AI relates a batch through `record relate` and then lists to
                 * check the writes landed — and a listing silent about them reads
                 * exactly like a store that refused every one, which is what #103
                 * `r-lifecycle-projection-gap` was filed about one table over.
                 *
                 * Each entry carries the far record's **address** rather than its
                 * title: `retroId` and `rid` are what every other read this CLI
                 * offers is addressed by, so following a relation is
                 * `record list --retro <retroId>` with what is already in hand.
                 * The browser's answer carries the title instead, because a
                 * person is being handed a link and needs to know what is at the
                 * end of it (`views.schema.ts` §recordRelationSchema).
                 *
                 * Nested rather than flattened, for the reason the lifecycle
                 * block above is: this reports a standing, not a write.
                 */
                relations: view.relations.map((relation) => ({
                  globalId: relation.globalId,
                  retroId: relation.retroId,
                  rid: relation.rid,
                  how: relation.how,
                  direction: relation.direction,
                  actor: relation.actor,
                  at: relation.at,
                })),
              })),
            },
            () =>
              records
                .map(
                  (view) =>
                    `#${view.globalId} [${view.decision.state}] ` +
                    // Only when it has moved off `open`: every record starts
                    // there, and a column that reads "open" on every line of a
                    // fresh retro is a column that has earned nothing.
                    `${view.lifecycle.status === 'open' ? '' : `[${view.lifecycle.status}] `}` +
                    `${view.record.rid} — ${view.record.title}` +
                    // On the same terms: only records somebody has related say
                    // anything, and what they say is the numbers to go and read.
                    (view.relations.length === 0
                      ? ''
                      : `\n    ↔ ${view.relations
                          .map((relation) => `#${relation.globalId} ${relation.how}`)
                          .join(' · ')}`),
                )
                .join('\n') || 'No records.',
          )
          return
        }

        const rid = args.rid
        if (rid === undefined) {
          throw new UsageError(`record ${action} needs a record id, e.g. r-stale-lock`)
        }
        // The second positional belongs to the relation pair alone. Refused
        // rather than ignored, on `record list`'s standing: a second argument is
        // somebody expecting it to mean something, and silently dropping it
        // answers as if it had.
        if (args.to !== undefined) {
          throw new UsageError(
            `record ${action} takes one record id; a second one is only for relate/unrelate, which name two records`,
          )
        }
        // `--revision` and `--state` read a draft; the lifecycle hangs off the
        // record. Accepting them here would suggest a record can be resolved
        // "as of revision 2", which is a thing this feature deliberately is not.
        if (args.revision !== undefined || args.state !== undefined) {
          throw new UsageError(
            `record ${action} takes no --revision or --state: a record's lifecycle belongs to the record, not to a draft of it`,
          )
        }

        const result = await context.app.records.setLifecycle.execute({
          actor: 'ai',
          retro,
          rid,
          status: ACT_OF_ACTION[action],
          refs: args.ref,
          note: args.note,
        })

        context.output.result(
          {
            retroId: result.retroId,
            rid: result.rid,
            version: result.version,
            // The state the record is now in — `open` after a reopen, not the
            // word that was written. `refs` and the three below describe the
            // entry that put it there, which is the one just written.
            status: result.lifecycle.status,
            refs: [...result.lifecycle.refs],
            note: result.lifecycle.note ?? null,
            actor: result.lifecycle.actor ?? null,
            at: result.lifecycle.at ?? null,
          },
          () => {
            const cited =
              result.lifecycle.refs.length === 0 ? '' : ` — ${result.lifecycle.refs.join(', ')}`
            return `${DONE_OF_ACTION[action]} ${result.rid} in retro ${result.retroId} (v${result.version})${cited}`
          },
        )
      }),
  )
}

/**
 * `record relate` / `record unrelate` — the AI relating what it has just filed to
 * what it found in the past, in its own process (KC-0004).
 *
 * Every guard here is about the shape of the *command*; the domain's guards — a
 * record related to itself, a number nothing was minted for, a record a later
 * draft withdrew, a pair that already stands — are the use case's and arrive as
 * typed errors the exit-code map already handles. Restating any of them here
 * would be a second copy free to disagree with the browser's.
 */
async function relateRecords(
  context: CliContext,
  args: {
    readonly rid?: string
    readonly to?: string
    readonly how?: string
    readonly retro?: number
    readonly session?: string
    readonly revision?: number
    readonly state?: string
    readonly ref?: readonly string[]
    readonly note?: string
  },
  action: 'relate' | 'unrelate',
): Promise<void> {
  const related = action === 'relate'

  // A global number needs no retrospective to be read in, and accepting one
  // would suggest a relation lives inside a retrospective — which is the one
  // thing this feature is not.
  if (args.retro !== undefined || args.session !== undefined) {
    throw new UsageError(
      `record ${action} takes no --retro or --session: a #globalId names a record on its own, ` +
        'and a relation deliberately crosses retrospectives',
    )
  }
  if (args.revision !== undefined || args.state !== undefined) {
    throw new UsageError(
      `record ${action} takes no --revision or --state: a relation belongs to the records, not to a draft of them`,
    )
  }
  if (args.ref !== undefined || args.note !== undefined) {
    throw new UsageError(
      `record ${action} takes no --ref or --note: what a relation says is --how, and it says it once`,
    )
  }
  if (related && (args.how ?? '').trim().length === 0) {
    throw new UsageError(
      'record relate needs --how: each relation carries how-they-relate words, and a relation ' +
        'citing nothing leaves a reader to guess whether one record supersedes the other, duplicates it, or caused it',
    )
  }
  if (!related && args.how !== undefined) {
    throw new UsageError(
      'record unrelate takes no --how: the row it writes carries forward the words of the relation it takes off',
    )
  }

  const fromId = globalId(args.rid, 'first')
  const toId = globalId(args.to, 'second')

  const result = await context.app.records.relate.execute({
    actor: 'ai',
    fromId,
    toId,
    related,
    how: related ? args.how : undefined,
  })

  context.output.result(
    {
      fromId: result.fromId,
      toId: result.toId,
      version: result.version,
      // Where the record now stands, not what was just written — the shape
      // `record list`'s block has, so the AI reads one answer either way.
      relations: result.relations.map((relation) => ({
        globalId: relation.globalId,
        retroId: relation.retroId,
        rid: relation.rid,
        how: relation.how,
        direction: relation.direction,
        actor: relation.actor,
        at: relation.at,
      })),
    },
    () =>
      related
        ? `Related #${result.fromId} → #${result.toId} (v${result.version}) — ${args.how}`
        : `Un-related #${result.fromId} → #${result.toId} (v${result.version})`,
  )
}
