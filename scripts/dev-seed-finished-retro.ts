#!/usr/bin/env bun

/**
 * **A finished retrospective, on demand** — the stage an acceptance run starts
 * from (RL-50).
 *
 * The record lane only hands out work from a round the human has **finished**:
 * `record queue` is the approved, unresolved records of retrospectives whose
 * latest revision he put down (`list-lane-records.use-case.ts`). So every
 * acceptance run of the lane — the plugin's, a demo, a hand walk-through of
 * `record queue` → `record claim` → `record resolve` — has to start from a stage
 * that holds one, and building one by hand is four commands plus a browser.
 *
 * **It acts as the human, and that is why it is not a CLI command.** Recording a
 * verdict and finishing a round are human-only and UI-only: there is no
 * `retroloop decision record`, and there never will be, because the human
 * deciding in the browser is the product (KC-0010). A seed has to write those
 * rows anyway, so it writes them **here**, in `scripts/`, where nothing ships and
 * nobody can reach it by accident from the binary. `apps/cli/test/support/
 * finish-review.ts` stands in the same place for the same reason.
 *
 * **The refusal is the whole safety.** Without `RETROLOOP_DEV_SEED=1` this
 * writes nothing and exits 2 — before it opens a store, so a mistyped `--home`
 * pointed at a real stage does not even migrate it. An accident here is not a
 * cosmetic one: it would put approved records and a finished round into somebody's
 * ledger, with the human's name on decisions he never made.
 *
 * **It never closes the review.** Closing is the AI's own act and the lane's
 * business (`review close`, and the catch-up the plugin runs), so the stage is
 * left exactly where a real one is the moment the human presses Finish: finished,
 * not closed, with every record on the queue. A seed that closed it would have
 * decided something the run it is seeding exists to exercise.
 *
 *     RETROLOOP_DEV_SEED=1 bun run scripts/dev-seed-finished-retro.ts \
 *       --records 3 [--footprint <path>] [--involvement autonomous] [--home <root>]
 *
 * One JSON document on stdout: `{"retroId":N,"sessionId":N,"recordIds":[…]}`, the
 * record ids in `num` order — the numbers `record queue` and `record claim` take.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { resolveStage } from '@retro/cli'
import {
  createApp,
  type Involvement,
  involvementSchema,
  openSqliteStore,
  type RecordInput,
} from '@retro/core'

/** Enough records to exercise a queue, and few enough that a mistake is cheap. */
const MAX_RECORDS = 50

type Options = {
  readonly records: number
  readonly involvement: Involvement
  readonly footprint: string
  readonly home: string | undefined
}

/** The `{"error":{code,message}}` document every refusal in this product wears. */
function refuse(code: string, message: string): never {
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`)
  process.exit(2)
}

/**
 * The flags, parsed by hand — five of them, and `yargs` is the CLI's dependency
 * rather than the root's. Unknown flags are refused rather than ignored: a
 * mistyped `--recrods 3` that silently seeded nothing would be read as the
 * script being broken.
 */
function parse(argv: readonly string[]): Options {
  let records: string | undefined
  let involvement: string | undefined
  let footprint: string | undefined
  let home: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      refuse('USAGE', `${flag} takes a value`)
    }
    index += 1

    switch (flag) {
      case '--records':
        records = value
        break
      case '--involvement':
        involvement = value
        break
      case '--footprint':
        footprint = value
        break
      case '--home':
        home = value
        break
      default:
        refuse(
          'USAGE',
          `unknown option ${flag} — this takes --records, --involvement, --footprint and --home`,
        )
    }
  }

  if (records === undefined) refuse('USAGE', '--records <n> is required')
  const count = Number(records)
  if (!Number.isInteger(count) || count < 1 || count > MAX_RECORDS) {
    refuse('USAGE', `--records must be a whole number from 1 to ${MAX_RECORDS}; got ${records}`)
  }

  /**
   * The enum is asked rather than restated — `involvementSchema` is the one
   * place the five words are written down, and a list copied here would be free
   * to disagree with the value the decision is then recorded with.
   */
  const chosen = involvement === undefined ? undefined : involvementSchema.safeParse(involvement)
  if (chosen !== undefined && !chosen.success) {
    refuse(
      'USAGE',
      `--involvement must be one of ${[...involvementSchema.values].join(', ')}; got ${involvement}`,
    )
  }

  return {
    records: count,
    // The default the lane wants: work an agent may start on its own, which is
    // what an acceptance run of `record claim` is about.
    involvement: chosen?.data ?? 'autonomous',
    // The literal the footprint field takes when a solution touches nothing —
    // read back as an empty list (`lane.view.ts` §laneFootprint).
    footprint: footprint ?? 'none',
    home,
  }
}

/**
 * One record, honest about being a seed.
 *
 * Nothing here pretends to be a real friction: the problem says what it is, the
 * human words are the sentence somebody would have said about it, and the
 * solution's one bullet says to change the file the footprint names. A seed that
 * read like a real record would eventually be quoted as one.
 */
function seedRecord(n: number, options: Options): RecordInput {
  return {
    rid: `r-dev-seed-${n}`,
    num: n,
    title: `Dev seed record ${n}`,
    type: 'issue',
    problem:
      `A placeholder record written by \`scripts/dev-seed-finished-retro.ts\` so the ` +
      `record lane has something to hand out. It describes no real friction.`,
    humanWords: [
      {
        verbatim: 'seed this stage so i can walk the queue',
        cleaned: 'Seed this stage so the queue has work on it.',
        context: 'setting up an acceptance run',
      },
    ],
    rootCause: {
      whatHappened: 'An acceptance run needed a finished retrospective and the stage was empty.',
      whys: [
        '**Why was the stage empty?** Nothing had filed a retrospective against it.',
        'Filing one by hand takes a session, a revision, a verdict per record and a finish.',
        'Two of those four are the human’s and no CLI command performs them.',
      ],
      root: 'The queue is made of finished rounds, and finishing a round is not a scriptable act.',
    },
    diagnosticData:
      '- **The stage:** empty — no session, no retrospective, no revision.\n' +
      '- **The acts a CLI cannot perform:** the verdict per record, and the finish.',
    workaround: 'Drive the review UI by hand once per stage.',
    solutions: [
      {
        bullets: '- **Dev seed.** Change the file the footprint names.',
        footprint: options.footprint,
        level: 1,
        recommended: true,
      },
    ],
    requester: 'human',
    impacts: 'human',
    defaults: { severity: 3, involvement: options.involvement },
  }
}

const options = parse(process.argv.slice(2))

/**
 * Read **after** the options and before anything is opened, so a refusal leaves
 * no stage directory and no migrated database behind — which is what makes the
 * guard a guard rather than a message printed over a write.
 */
if (process.env.RETROLOOP_DEV_SEED !== '1') {
  refuse(
    'DEV_SEED_DISABLED',
    'this writes a retrospective as the human and is for development stages only; ' +
      'set RETROLOOP_DEV_SEED=1 to run it',
  )
}

const stage = resolveStage({ home: options.home, env: process.env, cwd: process.cwd() })
const store = openSqliteStore({
  dataDir: stage.dataDir,
  // The snapshots belong to the root, not to the stage — the same pair the CLI
  // opens with (`apps/cli/src/runtime.ts`).
  backupsDir: join(stage.home, 'backups', 'db'),
})

try {
  const app = createApp(store)

  const { session } = await app.sessions.create.execute({
    actor: 'ai',
    // Unique per run, because the registration is idempotent by this key: a
    // fixed one would hand every seed the first run's session.
    claudeSession: `dev-seed-${randomUUID()}`,
    cwd: process.cwd(),
    supervised: true,
  })

  const { retroId } = await app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: {
      title: `Dev seed — ${options.records} record(s)`,
      records: Array.from({ length: options.records }, (_, index) =>
        seedRecord(index + 1, options),
      ),
    },
  })

  /**
   * The human's half, record by record and then the round. Approved, because an
   * approved record is the only kind the queue offers — nothing is inferred from
   * silence, so a record left pending would simply not be work.
   */
  for (let n = 1; n <= options.records; n += 1) {
    await app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid: `r-dev-seed-${n}`,
      decision: { state: 'approved', selectedSolution: 1, involvement: options.involvement },
    })
  }

  await app.review.finish.execute({ actor: 'human', retro: { retroId } })

  // The global ids, read back rather than guessed: the sequence runs across every
  // retrospective on the stage, so a seed into a store that already holds records
  // does not start at 1 (`record-id.model.ts`).
  const { records } = await app.records.list.execute({ actor: 'ai', retro: { retroId } })
  const recordIds = [...records]
    .sort((left, right) => left.record.num - right.record.num)
    .map((view) => view.globalId)

  process.stdout.write(`${JSON.stringify({ retroId, sessionId: session.id, recordIds })}\n`)
} finally {
  await store.close()
}
