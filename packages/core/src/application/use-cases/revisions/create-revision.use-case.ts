import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseRevisionInput, type RecordInput } from '#application/schemas/revision-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError, type ValidationIssue } from '#domain/errors/validation.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { RetroRecord } from '#domain/models/record.model'
import type { Revision } from '#domain/models/revision.model'
import { resolveSession, type SessionRef } from '#domain/services/reference.service'

export type CreateRevisionInput = {
  readonly actor: Actor
  readonly session: SessionRef
  /** Raw JSON — validated here, at the boundary, against the revision schema. */
  readonly revision: unknown
  /** `--expect-revision <n>`: refuse unless the revision about to be written is `n`. */
  readonly expectRevision?: number
}

export type CreateRevisionOutput = {
  readonly retroId: number
  /** `true` when this call opened a new retrospective rather than adding to one. */
  readonly retroStarted: boolean
  readonly revision: Revision
}

/**
 * The field-by-field copy, deliberately not a spread: a new field is added here
 * by hand or it is not stored at all.
 *
 * Nothing is derived on the way in, and that is load-bearing: `revision get`'s
 * `content` is *this object*, and SKILL.md promises a lost draft can be rebuilt
 * from it by wrapping it in `{ "records": [...] }`. A key stored here that the
 * input schema does not accept would break that promise, and would only ever
 * surface as an exit 2 in someone else's session. The level a record proposes is
 * read through `proposedLevel()` instead.
 */
function toRecord(input: RecordInput): RetroRecord {
  return {
    rid: input.rid,
    num: input.num,
    title: input.title,
    type: input.type,
    problem: input.problem,
    humanWords: input.humanWords.map((words) => ({
      verbatim: words.verbatim,
      cleaned: words.cleaned,
      context: words.context,
    })),
    rootCause: {
      whatHappened: input.rootCause.whatHappened,
      whys: [...input.rootCause.whys],
      root: input.rootCause.root,
    },
    diagnosticData: input.diagnosticData,
    workaround: input.workaround,
    solutions: input.solutions.map((solution) => ({
      bullets: solution.bullets,
      footprint: solution.footprint,
      level: solution.level,
      recommended: solution.recommended,
    })),
    requester: input.requester,
    impacts: input.impacts,
    defaults: {
      severity: input.defaults.severity,
      involvement: input.defaults.involvement,
    },
  }
}

/**
 * Record identity is minted once per retrospective and never moves (D1, D5).
 * A single revision cannot see that, so the check lives here, over every earlier
 * revision of the same retrospective:
 *
 * - a `rid` seen before keeps the `num` it was given — no renumbering;
 * - a `num` used before keeps its `rid` — no reuse;
 * - the numbers the retrospective has handed out stay dense, 1..M, so `num` is a
 *   display position and not an arbitrary label.
 *
 * A record may stop appearing (the AI dropped it in a later draft) without
 * breaking density: its number stays spoken for and is never handed to another
 * record.
 */
function checkIdentityStability(
  previous: readonly Revision[],
  records: readonly RecordInput[],
): void {
  const numByRid = new Map<string, number>()
  const ridByNum = new Map<number, string>()
  for (const revision of previous) {
    for (const record of revision.records) {
      numByRid.set(record.rid, record.num)
      ridByNum.set(record.num, record.rid)
    }
  }

  const issues: ValidationIssue[] = []
  records.forEach((record, index) => {
    const knownNum = numByRid.get(record.rid)
    if (knownNum !== undefined && knownNum !== record.num) {
      issues.push({
        path: `records.${index}.num`,
        message: `${record.rid} is record ${knownNum} in this retrospective; records are never renumbered`,
      })
    }
    const owner = ridByNum.get(record.num)
    if (owner !== undefined && owner !== record.rid) {
      issues.push({
        path: `records.${index}.num`,
        message: `num ${record.num} already belongs to ${owner}; numbers are never reused`,
      })
    }
    numByRid.set(record.rid, record.num)
    ridByNum.set(record.num, record.rid)
  })

  const numbers = [...ridByNum.keys()].sort((left, right) => left - right)
  const firstGap = numbers.findIndex((num, index) => num !== index + 1)
  if (firstGap !== -1) {
    issues.push({
      path: 'records',
      message: `record numbers must be dense from 1; got ${numbers.join(', ')}`,
    })
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `revision: ${issues[0]?.message ?? 'invalid record identity'}`,
      issues,
    )
  }
}

/**
 * The AI submits a draft (cli.md `revision create`).
 *
 * Lifecycle is implicit: the revision joins the session's one
 * non-`finished` retrospective, or starts a new one when the last is finished.
 * The first revision moves the retrospective from `open` to `reviewing` (D3).
 * Everything — the new retrospective, the revision, the state change and both
 * events — commits as one unit of work, so a rejected draft leaves no orphan
 * retrospective behind.
 */
export class CreateRevisionUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateRevisionInput): Promise<CreateRevisionOutput> {
    ForbiddenActorError.assert('ai', input.actor, 'submitting a revision')
    const parsed = parseRevisionInput(input.revision)

    return this.store.tx(async (repositories) => {
      const session = NotFoundError.require(
        await resolveSession(repositories.sessions, input.session),
        'session',
        input.session,
      )
      const at = timestamp(this.clock)

      const open = await repositories.retrospectives.findOpenBySession(session.id)
      const retro =
        open ??
        (await repositories.retrospectives.add({
          sessionId: session.id,
          state: 'open',
          startedAt: at,
          finishedAt: undefined,
        }))
      const retroStarted = open === undefined
      if (retroStarted) {
        await repositories.events.append(
          newDomainEvent('RetrospectiveStarted', at, { sessionId: session.id, retroId: retro.id }),
        )
      }

      /**
       * **Round integrity** (`r-revision-sneaks-past-review`).
       *
       * A revision may land as the first of a retrospective, or as the answer to a
       * round the human has finished — and nothing else. Until this gate the store
       * enforced none of the loop's rhythm: identity and races were guarded, the
       * review's state was never an input, and the file-review-finish-file
       * choreography lived only in SKILL.md prose, which binds nobody at the API.
       *
       * It fired twice in one retrospective, on the cooperative case: the human
       * asked for changes mid-review, and filing immediately was the obliging thing
       * the choreography did not forbid. Sending a revision while the human has not
       * finished the review must not be allowed — the human should not be spending
       * time on a review while the AI slips a new revision in underneath it. The
       * cost is that a replacement can flip a record the human has already decided
       * back to `pending` (D2), so review time is spent on a moving target with no
       * signal that it moved.
       *
       * `ReviewFinished` for the latest revision is the whole of the question, and
       * it is the same signal `close-review.use-case.ts` reads for the same
       * reason: it is the human's one explicit act ending their side of a round,
       * and nothing here is inferred from silence, from an empty comment list or
       * from time passing.
       *
       * **Checked before `--expect-revision`**, because this is a refusal to write
       * at all rather than a disagreement about which number the write would take:
       * an author told "the next revision is 3, not 2" would fix the number and
       * file again into the same unfinished round.
       *
       * **No override, deliberately.** A draft correction seconds after filing
       * waits for a finish too — the stated price of the guarantee, and a flag to
       * buy it back would recreate exactly the sneak.
       */
      const latest = await repositories.revisions.findLatestByRetro(retro.id)
      if (latest !== undefined) {
        const finishes = await repositories.events.list({
          retroId: retro.id,
          names: ['ReviewFinished'],
        })
        if (!finishes.some((event) => event.revisionN === latest.n)) {
          throw new ConflictError(
            `retrospective ${retro.id} revision ${latest.n} is still being reviewed; ` +
              'a new revision can only answer a finished round. To change a record now, ' +
              'ask for a `revise` verdict on it and let the human Finish the review — ' +
              'the rewrite lands as the next revision.',
          )
        }
      }

      const n = (await repositories.revisions.countByRetro(retro.id)) + 1
      if (input.expectRevision !== undefined && input.expectRevision !== n) {
        throw new ConflictError(
          `expected to write revision ${input.expectRevision}, but the next revision of retrospective ${retro.id} is ${n}`,
        )
      }

      checkIdentityStability(await repositories.revisions.listByRetro(retro.id), parsed.records)

      const revision = await repositories.revisions.add({
        retroId: retro.id,
        n,
        createdAt: at,
        title: parsed.title,
        records: parsed.records.map(toRecord).sort((left, right) => left.num - right.num),
      })

      /**
       * The global number, minted for every record this draft introduces.
       *
       * **Beside the revision, never inside it.** `rid` and `num` above are the
       * AI's own fields, copied across one by one so that `revision get
       * --content` hands back byte for byte what was submitted; this is the one
       * name on a record the AI does not author, so it is a row of its own
       * (`record-id.model.ts`, and the migration has the whole argument).
       *
       * Only the rids this retrospective has never held. A record that appears
       * again in a later draft keeps the number it was given — that is what
       * "minted at first appearance" means, and it is the same rule identity
       * stability already states for `num`. `revision.records` is stored sorted
       * by `num`, so three records introduced together are numbered in the order
       * the reviewer will read them rather than in whatever order the draft
       * happened to list them.
       */
      const alreadyMinted = new Set(
        (await repositories.recordIds.listByRetro(retro.id)).map((minted) => minted.rid),
      )
      for (const record of revision.records) {
        if (alreadyMinted.has(record.rid)) continue
        await repositories.recordIds.add({ retroId: retro.id, rid: record.rid })
      }

      if (retro.state !== 'reviewing') {
        await repositories.retrospectives.setState(retro.id, 'reviewing')
      }

      await repositories.events.append(
        newDomainEvent(
          'RevisionCreated',
          at,
          { sessionId: session.id, retroId: retro.id, revisionN: n },
          { records: revision.records.length },
        ),
      )

      return { retroId: retro.id, retroStarted, revision }
    })
  }
}
