import {
  type DecisionState,
  LANE_STATES,
  type LaneRecordRow,
  type LaneState,
  type RecordLifecycleStatus,
  type RetroRef,
} from '@retro/core'
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
 * commonest mistake here is reaching for a rid, because a rid is what the
 * lifecycle acts are addressed by (`resolve` and `reopen` take either form
 * since retro 20 `r-brief-record-resolve-line`; `lifecycleAddress` below) — so
 * the refusal has to say which of the two names this act uses, and why.
 */
function globalId(value: string | undefined, action: string, which?: string): number {
  const parsed = Number(value)
  if (value === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    const whose = which === undefined ? 'the' : `the ${which}`
    throw new UsageError(
      `record ${action} needs ${whose} record's #globalId — the number \`record list\` puts first, ` +
        'not a rid: a record has one number for the whole ledger, and (retro, rid) is its address inside one',
    )
  }
  return parsed
}

/** The three lane words a verdict cannot be, and the plain listing has no way to answer for. */
const LANE_ONLY_STATES: readonly LaneState[] = ['in-progress', 'resolved', 'archived']

/** The acts addressed by a global number rather than by a rid. */
type LaneAction = 'queue' | 'get' | 'relations' | 'claim' | 'unclaim'

/** Everything a lane act may be handed, so a guard can refuse what it may not. */
type RecordArgs = {
  readonly rid?: string
  readonly to?: string
  readonly how?: string
  readonly retro?: number
  readonly session?: string
  readonly revision?: number
  readonly state?: string
  readonly text?: string
  readonly all?: boolean
  readonly ref?: readonly string[]
  readonly note?: string
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
 * **Both take the `#globalId` as well as the rid** (retro 20
 * `r-brief-record-resolve-line`): the queue and `record get` hand out numbers,
 * and the manager holding one was reading the record a second time for its rid
 * and its retrospective before it could resolve it. A number needs no `--retro`
 * — it names its retrospective on its own — and the write is still addressed
 * `(retroId, rid)` underneath (`lifecycleAddress`).
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
    'Read the queue, look a record up, mark one resolved after fixing it, or relate two',
    (yargs) =>
      yargs
        .positional('action', {
          choices: [
            'list',
            'queue',
            'get',
            'relations',
            'claim',
            'unclaim',
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
            'resolve/reopen: which record — its #globalId, e.g. 194, or its rid with --retro, e.g. r-stale-lock · archive/unarchive: its rid with --retro · get/relations/claim/unclaim: its #globalId · relate/unrelate: the #globalId the relation is authored FROM',
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
        .option('retro', {
          type: 'number',
          describe: 'Retrospective id (not needed when resolve/reopen are given a #globalId)',
        })
        .option('session', { type: 'string', describe: 'Session id or UUID (its active retro)' })
        .option('revision', { type: 'number', describe: 'list: revision number [default: latest]' })
        .option('all', {
          type: 'boolean',
          describe:
            'list: every record of every retrospective instead of one revision’s — refuses --retro/--session/--revision, and is what --text and the lane states need',
        })
        .option('text', {
          type: 'string',
          describe:
            'list --all: case-insensitive substring over the title, the slug, the problem and the root cause',
        })
        .option('state', {
          choices: [...LANE_STATES],
          describe:
            'list: only records in this state (`hold` is a pre-split verdict; in-progress/resolved/archived need --all)',
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
        })
        .epilogue(LANE_HELP),
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

        if (action === 'queue' || action === 'get' || action === 'relations') {
          await readLane(context, args, action)
          return
        }

        if (action === 'claim' || action === 'unclaim') {
          await claimRecord(context, args, action)
          return
        }

        if (action === 'list' && args.all === true) {
          await listEverything(context, args)
          return
        }

        if (action === 'list') {
          const retro = retroRef(args)
          // The three lane words are a different question, and the plain listing
          // has no way to answer them: they are folded from the lifecycle and the
          // claim, which a revision listing carries per record but does not
          // filter on. Refused with the flag that does answer, rather than
          // silently matching nothing.
          if (LANE_ONLY_STATES.includes(args.state as LaneState)) {
            throw new UsageError(
              `record list --state ${args.state} needs --all: it is a lane state rather than a verdict, ` +
                'and the lane reads across every retrospective',
            )
          }
          if (args.text !== undefined) {
            throw new UsageError(
              'record list --text needs --all: a search over one revision’s records is a listing you can read',
            )
          }
          // Refused rather than ignored: `record list r-stale-lock` is somebody
          // expecting a filter, and answering with the whole revision would look
          // like the filter matched everything.
          if (args.rid !== undefined) {
            throw new UsageError(
              'record list takes no record id; it lists the whole revision. `record get <#globalId>` reads one.',
            )
          }

          const { retroId, revisionN, records } = await context.app.records.list.execute({
            actor: 'ai',
            retro,
            revision: args.revision,
            // Narrowed rather than cast: the option now offers the lane's whole
            // vocabulary, and the three words this listing cannot answer for were
            // refused above.
            state: args.state as DecisionState | undefined,
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

        // Examined before any retrospective flag, because the number form
        // needs none (`lifecycleAddress`).
        const positional = args.rid
        if (positional === undefined) {
          throw new UsageError(
            `record ${action} needs a record id — its #globalId, e.g. 194, or its rid with --retro, e.g. r-stale-lock --retro 19`,
          )
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
        // The two the lane listing reads with. Refused here on the standing
        // above: an act on one record has nothing to narrow.
        if (args.all === true || args.text !== undefined) {
          throw new UsageError(
            `record ${action} takes no --all or --text: they narrow a listing, and this acts on one record`,
          )
        }

        const { retro, rid } = await lifecycleAddress(context, action, positional, args)

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

  const fromId = globalId(args.rid, action, 'first')
  const toId = globalId(args.to, action, 'second')

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

/**
 * **`--help` is the contract** (cli.md's AUTHORITY note), so the lane's rules
 * are stated here rather than only in a design document: what each act takes,
 * what it answers with, and what it exits.
 */
const LANE_HELP = `The lane — the work, and the marker on it

  record queue                 Every APPROVED, UNRESOLVED, not-archived record of
                               every retrospective the human has FINISHED, oldest
                               first. Takes no --retro/--session/--revision.
  record get <#globalId>       One record in the same shape, plus "retrospective".
  record relations <#globalId> Every relation in force on it, both directions,
                               each with the far record's state and references.
  record list --all            Every record of every retrospective, any state.
                               --state takes the lane words too; --text searches
                               the title, slug, problem and root cause.
  record claim <#globalId>     Say you are working on it. Exit 4 if somebody
                               already is, or if the record is not open.
  record unclaim <#globalId>   Give it back. Exit 4 if nobody is holding it.
                               A resolve clears the claim on its own.
  record resolve <#globalId> --ref <sha>
                               Mark it fixed, citing the evidence. A #globalId
                               needs no --retro (one given must agree); the rid
                               form, r-stale-lock --retro <n>, still works.
  record reopen <#globalId>    Take that back — the fix did not hold.

  get/relations/claim/unclaim take the #globalId — the number \`record list\` puts
  first — not a rid, and refuse --retro/--session/--revision/--state/--ref/--note/--how.

  --json shapes
    queue, list --all  a bare array of rows; get, one row plus "retrospective"
    row                { recordId, retroId, retro, sessionId, title, slug, problem,
                         rootCause { whatHappened, whys, root }, diagnosticData,
                         ownerWords,
                         selectedSolution { index, level, title, body, footprint },
                         involvement, relations [{ recordId, kind, direction }],
                         claim null | { claimedAt, actor }, resolved,
                         lifecycle { state, resolvedAt, ref, refs, claimedAt } }
    retrospective      { retroId, retro, sessionId, claudeSession, cwd, finishedAt, closed }
    relations          [{ recordId, retroId, retro, slug, title, kind, direction,
                          state, resolvedAt, ref, refs }]
    claim/unclaim      { recordId, retroId, slug, version, claim }

  Exit codes: 0 ok · 2 usage · 3 no such record · 4 conflict (already claimed,
  not claimed, or not open) · 5 forbidden actor · 7 server.`

/**
 * `record queue`, `record get` and `record relations` — **the reading half of
 * the lane**, all three off one read model (`list-lane-records.use-case.ts`).
 *
 * They are together because they are the same row asked three ways, and because
 * the guards below are identical for all three: each is addressed by a global
 * number and none of them lives inside a retrospective.
 */
async function readLane(
  context: CliContext,
  args: RecordArgs,
  action: 'queue' | 'get' | 'relations',
): Promise<void> {
  refuseLaneOptions(action, args)

  if (action === 'queue') {
    if (args.rid !== undefined) {
      throw new UsageError(
        'record queue takes no record id: it is the whole queue, and `record get <#globalId>` reads one record',
      )
    }

    const { records } = await context.app.records.lane.execute({ actor: 'ai', scope: 'queue' })
    printRows(context, records)
    return
  }

  // The second positional belongs to the relation pair alone, on `record list`'s
  // standing: a second argument is somebody expecting it to mean something.
  if (args.to !== undefined) {
    throw new UsageError(
      `record ${action} takes one record id; a second one is only for relate/unrelate, which name two records`,
    )
  }

  const id = globalId(args.rid, action)
  const row = await oneRecord(context, id)

  if (action === 'get') {
    context.output.result(
      {
        ...laneRowJson(row),
        /**
         * Where the record came from, which a queue row does not carry and a
         * reader of one record always wants: this is the block that says whether
         * the round is closed and when the human put it down, so an agent can
         * tell "he finished this an hour ago" from "he finished it in April".
         */
        retrospective: {
          retroId: row.retroId,
          retro: row.retroNumber,
          sessionId: row.sessionId,
          claudeSession: row.claudeSession,
          cwd: row.cwd,
          finishedAt: row.review.finishedAt ?? null,
          closed: row.review.closed,
        },
      },
      () =>
        [
          laneRowLine(row),
          `    Solution ${row.selectedSolution.index} — ${row.selectedSolution.title}`,
          ...row.ownerWords.map((words) => `    “${words}”`),
        ].join('\n'),
    )
    return
  }

  await printRelations(context, row)
}

/**
 * `record relations <#globalId>` — one record's history, as the lane needs it.
 *
 * Each line names the **other** record: its number and pair to go and read it
 * with, its title so a person knows what is at the end of the line, and where it
 * now stands — because the question this answers is *"has this been dealt with
 * before, and what came of it?"*
 *
 * **A far record a later draft withdrew is still listed**, with its rid for a
 * title and `null` where its state would be. The row was written about a record
 * that existed, and dropping the line would be this command inferring something
 * from an absence (`relation.view.ts` §RecordRelationDetail).
 */
async function printRelations(context: CliContext, row: LaneRecordRow): Promise<void> {
  /**
   * The far ends, resolved against the whole lane — one more build of a listing
   * this store answers in one pass, and only when the record has relations at
   * all. The alternative is a read per far end, which is what `records.byId`
   * does for a page holding one record; here the rows are already the shape the
   * answer needs.
   */
  const everything =
    row.relations.length === 0
      ? []
      : (await context.app.records.lane.execute({ actor: 'ai', scope: 'all' })).records
  const byId = new Map(everything.map((candidate) => [candidate.recordId, candidate]))
  const retroNumbers = new Map(
    everything.map((candidate) => [candidate.retroId, candidate.retroNumber]),
  )

  const relations = row.relations.map((relation) => {
    const far = byId.get(relation.globalId)
    const resolved = far?.lifecycle.status === 'resolved'
    return {
      recordId: relation.globalId,
      retroId: relation.retroId,
      retro: far?.retroNumber ?? requireRetroNumber(retroNumbers, relation.retroId),
      slug: relation.rid,
      // The far record's title, or its rid — the record's own name, authored by
      // the AI and the one thing a withdrawn record still has.
      title: far?.title ?? relation.rid,
      kind: relation.how,
      direction: relation.direction,
      state: far?.laneState ?? null,
      resolvedAt: resolved ? (far?.lifecycle.at ?? null) : null,
      ref: far?.lifecycle.refs[0] ?? null,
      refs: [...(far?.lifecycle.refs ?? [])],
    }
  })

  context.output.result(
    relations,
    () =>
      relations
        .map(
          (relation) =>
            `#${relation.recordId} [${relation.state === null ? 'withdrawn' : farState(relation.state, relation.ref)}] ` +
            `${relation.title} — ${relation.kind} (${relation.direction})`,
        )
        .join('\n') || 'No relations.',
  )
}

/** `resolved abc123` where there is a reference to cite, and the bare word otherwise. */
function farState(state: string, ref: string | null): string {
  return state === 'resolved' && ref !== null ? `resolved ${ref}` : state
}

/**
 * The "Retro #n" of a retrospective nothing on the lane came from.
 *
 * Unreachable: a relation names a **minted** record, a minted record belongs to a
 * retrospective, and every retrospective's latest revision carries at least one
 * record — so the retrospective is on the lane and so is its number. It is
 * checked rather than defaulted for `requireGlobalId`'s reason: saying which
 * retrospective has no number beats printing `#NaN` beside a real record.
 */
function requireRetroNumber(numbers: ReadonlyMap<number, number>, retroId: number): number {
  const number = numbers.get(retroId)
  if (number === undefined) {
    throw new Error(`retrospective ${retroId} is at the far end of a relation but has no records`)
  }
  return number
}

/**
 * `record claim` / `record unclaim` — **the AI saying it is working on
 * something, and saying it has stopped** (`record-claim.model.ts`).
 *
 * It is the one write here that is not about the record's outcome: a claim is
 * true for an afternoon, it says nothing about whether the work was any good,
 * and the lifecycle axis beside it never moves. What it buys is the thing a
 * queue cannot have without it — two agents reading the same queue a minute
 * apart do not both pick up the same record, because the second one is refused
 * with exit 4.
 *
 * **A resolve clears it**, in the same unit of work
 * (`set-record-lifecycle.use-case.ts`), so the ordinary path is claim, fix,
 * `record resolve` — and `unclaim` is for the case that is honest and awkward:
 * the work was started and put down.
 *
 * Addressed by the global number like `relate`, because the queue hands out
 * numbers and nothing else.
 */
async function claimRecord(
  context: CliContext,
  args: RecordArgs,
  action: 'claim' | 'unclaim',
): Promise<void> {
  refuseLaneOptions(action, args)

  if (args.to !== undefined) {
    throw new UsageError(
      `record ${action} takes one record id; a second one is only for relate/unrelate, which name two records`,
    )
  }

  const result = await context.app.records.claim.execute({
    actor: 'ai',
    id: globalId(args.rid, action),
    claimed: action === 'claim',
  })

  context.output.result(
    {
      recordId: result.recordId,
      retroId: result.retroId,
      slug: result.rid,
      version: result.version,
      // Where the record stands now, not the row just written — the shape
      // `record resolve` answers in, so one read serves both.
      claim:
        result.claim === undefined
          ? null
          : { claimedAt: result.claim.claimedAt, actor: result.claim.actor },
    },
    () =>
      `${action === 'claim' ? 'Claimed' : 'Released'} #${result.recordId} ${result.rid} ` +
      `in retro ${result.retroId} (v${result.version})`,
  )
}

/**
 * `record list --all` — **every record of every retrospective**, the history deep
 * dive (item 6).
 *
 * A different command wearing the same word, and deliberately so: the plain
 * `record list` answers about one revision of one retrospective and is what the
 * review loop reads; this answers about the whole store and is what somebody
 * searching for *"have we seen this before"* reads. They share a word because
 * they share a question — "what records are there" — and they share nothing
 * else, which is why `--all` refuses every argument that names one retrospective
 * rather than quietly ignoring it.
 */
async function listEverything(context: CliContext, args: RecordArgs): Promise<void> {
  if (args.retro !== undefined || args.session !== undefined) {
    throw new UsageError(
      'record list --all takes no --retro or --session: it reads every retrospective, ' +
        'which is the whole of what --all means',
    )
  }
  if (args.revision !== undefined) {
    throw new UsageError(
      'record list --all takes no --revision: it reads each retrospective’s latest revision, ' +
        'which is the one every write acts on',
    )
  }
  if (args.rid !== undefined || args.to !== undefined) {
    throw new UsageError(
      'record list --all takes no record id; `record get <#globalId>` reads one record',
    )
  }
  if (args.ref !== undefined || args.note !== undefined || args.how !== undefined) {
    throw new UsageError(
      'record list --all takes no --ref, --note or --how: those are words a write carries, and this reads',
    )
  }

  const { records } = await context.app.records.lane.execute({
    actor: 'ai',
    scope: 'all',
    state: args.state as LaneState | undefined,
    text: args.text,
  })
  printRows(context, records)
}

/** One record by its global number, or a `NotFoundError` the exit map turns into 3. */
async function oneRecord(context: CliContext, id: number): Promise<LaneRecordRow> {
  const { records } = await context.app.records.lane.execute({
    actor: 'ai',
    scope: 'all',
    recordId: id,
  })
  const row = records[0]
  if (row === undefined) {
    // Unreachable: the use case answers `NotFoundError` rather than an empty
    // list when the number names no record of a latest revision.
    throw new Error(`record #${id} resolved to no row`)
  }
  return row
}

/**
 * Where a lifecycle act is addressed — `(retro, rid)` either way, which is the
 * address the use case takes and the one every write in the store is keyed on.
 *
 * A positional that is all digits is the record's `#globalId` (retro 20
 * `r-brief-record-resolve-line`): the number `record queue` and `record get`
 * hand out, looked up here to the `(retroId, rid)` it names. A rid can never be
 * all digits (`ridSchema`: `r-some-words`), so the two forms cannot be confused.
 * The lookup is the read `record get` makes, and a number nothing was minted
 * for, or that a later draft withdrew, is its `NotFoundError` — exit 3, the same
 * answer `record get` gives. The write then re-reads the record inside its own
 * transaction (`set-record-lifecycle.use-case.ts`), so a record withdrawn between
 * the two is a refusal from the write, never a row against a record that is gone.
 *
 * The rid form is unchanged and still needs `--retro` or `--session` — a rid
 * names a record inside one retrospective — and its refusal names the other form,
 * because the refusal is the only place the difference gets taught.
 */
async function lifecycleAddress(
  context: CliContext,
  action: LifecycleAction,
  positional: string,
  args: { readonly retro?: number; readonly session?: string },
): Promise<{ readonly retro: RetroRef; readonly rid: string }> {
  if (/^\d+$/.test(positional) && Number.parseInt(positional, 10) > 0) {
    const id = Number.parseInt(positional, 10)
    const row = await oneRecord(context, id)
    return { retro: retroRef(args, { retroId: row.retroId, namedBy: `#${id}` }), rid: row.rid }
  }
  if (args.retro === undefined && args.session === undefined) {
    throw new UsageError(
      `record ${action} ${positional} needs --retro or --session: a rid names a record inside one ` +
        'retrospective — its #globalId, the number `record queue` puts first, names it on its own',
    )
  }
  return { retro: retroRef(args), rid: positional }
}

/**
 * Everything a lane act refuses, in one place.
 *
 * Every one of these is somebody reaching for an argument from a neighbouring
 * act — `--retro` from `record list`, `--ref` from `record resolve`, `--how`
 * from `record relate` — and an ignored argument answers as if it had meant
 * something. The messages say what the act is addressed by instead, because the
 * refusal is the only place the difference gets taught.
 */
function refuseLaneOptions(action: LaneAction, args: RecordArgs): void {
  if (args.retro !== undefined || args.session !== undefined) {
    throw new UsageError(
      action === 'queue'
        ? 'record queue takes no --retro or --session: the queue is every finished retrospective’s ' +
            'approved work, which is what makes it a queue rather than a listing'
        : `record ${action} takes no --retro or --session: a #globalId names a record on its own, ` +
            'and the lane deliberately crosses retrospectives',
    )
  }
  if (args.revision !== undefined || args.state !== undefined) {
    throw new UsageError(
      `record ${action} takes no --revision or --state: the lane reads each retrospective’s latest ` +
        'revision, and narrowing belongs to `record list --all`',
    )
  }
  if (args.ref !== undefined || args.note !== undefined || args.how !== undefined) {
    throw new UsageError(
      `record ${action} takes no --ref, --note or --how: those are words a write carries, and ` +
        'a claim carries only who took the record and when',
    )
  }
  if (args.all === true || args.text !== undefined) {
    throw new UsageError(
      `record ${action} takes no --all or --text: they belong to \`record list\`, which is the ` +
        'act that narrows a listing',
    )
  }
}

/** The rows of `record queue` and `record list --all` — a bare array, empty when nothing qualifies. */
function printRows(context: CliContext, rows: readonly LaneRecordRow[]): void {
  context.output.result(
    rows.map(laneRowJson),
    () => rows.map(laneRowLine).join('\n') || 'No records.',
  )
}

/**
 * **One row shape for `record queue`, `record list --all` and `record get`.**
 *
 * Three commands and one projection, because they are the same record asked for
 * three ways: a queue is a filter, `get` is a filter of one, and `--all` is no
 * filter at all. Two shapes that drifted would mean an agent parsing the queue
 * and an agent parsing `get` disagreeing about the record they are both holding.
 *
 * `undefined` becomes `null` here rather than vanishing, on the standing
 * `views.ts` sets: a key that comes and goes is a shape a script has to guess at.
 */
function laneRowJson(row: LaneRecordRow) {
  return {
    /** The number every lane act takes, and the only single-column handle a record has. */
    recordId: row.recordId,
    retroId: row.retroId,
    /** Its retrospective's place in its session — the "Retro #n" of the identity line. */
    retro: row.retroNumber,
    sessionId: row.sessionId,
    title: row.title,
    /** The record's own name — the rid, prefix untouched, which every write is addressed by. */
    slug: row.rid,
    problem: row.problem,
    rootCause: {
      whatHappened: row.rootCause.whatHappened,
      whys: [...row.rootCause.whys],
      root: row.rootCause.root,
    },
    /**
     * The evidence the AI diagnosed from — logs, timings, what it ran — or
     * `null` on a record filed before the field existed. Null rather than an
     * absent key, on this function's standing rule: a key that comes and goes is
     * a shape a script has to guess at.
     */
    diagnosticData: row.diagnosticData ?? null,
    /**
     * What the human said about this record: the note he wrote with the verdict
     * first, then his comments, oldest first. It is the field that lets an agent
     * act on a queue row without opening the review page.
     */
    ownerWords: [...row.ownerWords],
    /** The fix in effect, with the files it touches as a list rather than a paragraph. */
    selectedSolution: {
      index: row.selectedSolution.index,
      level: row.selectedSolution.level,
      title: row.selectedSolution.title,
      body: row.selectedSolution.body,
      footprint: [...row.selectedSolution.footprint],
    },
    /** How much of the human the fix needs — the one field that decides whether to start. */
    involvement: row.decision.involvement,
    /**
     * What this record was said to have to do with others, both directions.
     * `kind` is the words whoever related them used — free text, no vocabulary
     * (`record-relation.model.ts`); `record relations <#globalId>` is the same
     * list with the far record's title and standing on it.
     */
    relations: row.relations.map((relation) => ({
      recordId: relation.globalId,
      kind: relation.how,
      direction: relation.direction,
    })),
    /** Who is holding it right now, or `null` — the in-progress marker. */
    claim:
      row.claim === undefined ? null : { claimedAt: row.claim.claimedAt, actor: row.claim.actor },
    /** The one question a caller asks most often, answered without reading `lifecycle`. */
    resolved: row.lifecycle.status === 'resolved',
    /**
     * Where it stands, in the lane's one vocabulary — the verdict, the lifecycle
     * and the claim folded into a word (`record-lane.service.ts`), with the
     * evidence beside it. `ref` is the first reference and `refs` is all of them:
     * a reader who wants one line takes `ref`, and one who wants the whole claim
     * takes `refs`.
     */
    lifecycle: {
      state: row.laneState,
      resolvedAt: row.lifecycle.status === 'resolved' ? (row.lifecycle.at ?? null) : null,
      ref: row.lifecycle.refs[0] ?? null,
      refs: [...row.lifecycle.refs],
      claimedAt: row.claim?.claimedAt ?? null,
    },
  }
}

/**
 * The line a person reads: the number to act on, the verdict, what has happened
 * to it since, and enough of the identity line to find the retrospective.
 *
 * The marker goes **after** the verdict rather than replacing it, on `record
 * list`'s standing: a row that read `[in progress]` alone would have thrown away
 * the fact that the human approved it, which is why it is work at all.
 */
function laneRowLine(row: LaneRecordRow): string {
  const marker = markerOf(row)
  return (
    `#${row.recordId} [${row.decision.state}] ${marker}${row.rid} — ${row.title}` +
    ` · L${row.selectedSolution.level} · ${row.decision.involvement}` +
    ` · retro ${row.retroId} (#${row.retroNumber} of session ${row.sessionId})`
  )
}

/** Only rows something has happened to say anything — a column that reads "open" everywhere earns nothing. */
function markerOf(row: LaneRecordRow): string {
  if (row.claim !== undefined) return '[in progress] '
  if (row.lifecycle.status === 'resolved') {
    const ref = row.lifecycle.refs[0]
    return ref === undefined ? '[resolved] ' : `[resolved ${ref}] `
  }
  // Only where somebody archived it: a declined record is archived from birth
  // and its verdict already says so (`record-lane.service.ts`).
  if (row.lifecycle.status === 'archived' && row.lifecycle.actor !== undefined) {
    return '[archived] '
  }
  return ''
}
