import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import {
  createApp,
  MIGRATIONS,
  migrate,
  openSqliteStore,
  pendingMigrations,
  rollbackLastBatch,
} from '../../packages/core/src/index'
import { aRevisionDraft, TEST_CLOCK } from './world'

/**
 * The Bun half of the e2e suite.
 *
 * Playwright runs the scenarios under Node, where `bun:sqlite` does not exist —
 * so everything that has to open the database directly lives here and is
 * spawned as a Bun process. That is not a workaround: seeding an *older schema*
 * is not something the product exposes, and doing it out-of-process keeps the
 * scenario itself talking to the product only through its real surfaces.
 *
 * Usage: `bun run stage-tool.ts <command> [args...] <dataDir>`; prints one JSON
 * object. The stage directory is last because `world.ts` appends it to every
 * call, so a command's own arguments sit between the two.
 */
const clock = { now: () => new Date(TEST_CLOCK) }

const argv = process.argv.slice(2)
const command = argv[0]
const dataDir = argv.at(-1)
const rest = argv.slice(1, -1)
if (command === undefined || dataDir === undefined || argv.length < 2) {
  console.error('usage: stage-tool.ts <seed-old|pending|finish-round> [args...] <dataDir>')
  process.exit(2)
}

/**
 * A stage as an older binary left it: every migration **except the last**, which
 * is what that binary's static registry would have held, plus real rows written
 * through the App.
 *
 * The rows are written at the *full* schema and the last migration is then rolled
 * back, rather than the other way round. Writing them at the older schema would
 * mean running today's repositories against a table today's repositories do not
 * describe — the moment the newest migration adds a column any adapter selects,
 * seeding fails on `no such column` and the scenario stops being about upgrading
 * at all. Rolling back afterwards reaches the same stage by the one path that
 * stays true whatever the next migration turns out to be: `down()` is the
 * definition of "as it was before", and the migrator suite already proves each
 * one reverses exactly what it did.
 *
 * Two batches, so the rollback undoes the last migration and not the lot: a
 * rollback undoes a *run*, and a single `migrate` call would make every
 * migration one run (migrations.md §Ledger table).
 */
async function seedOld(): Promise<void> {
  const file = join(dataDir as string, 'retro.db')
  const database = new Database(file, { create: true })
  database.run('PRAGMA journal_mode = WAL')
  database.run('PRAGMA foreign_keys = ON')
  migrate(database, { registry: MIGRATIONS.slice(0, -1), clock })
  migrate(database, { registry: MIGRATIONS, clock })
  database.close()

  const store = openSqliteStore({ dataDir: dataDir as string, migrate: false, clock })
  let seeded: { sessionId: number; retroId: number; rids: string[] }
  try {
    const app = createApp(store, { clock })
    const { session } = await app.sessions.create.execute({
      actor: 'ai',
      claudeSession: 'uuid-upgrade',
      project: 'retro',
      cwd: '/Users/sample/Developer/retro',
      branch: 'main',
      supervised: true,
    })
    const rids = ['r-record-1', 'r-record-2']
    const { retroId } = await app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: JSON.parse(aRevisionDraft(rids)) as unknown,
    })
    seeded = { sessionId: session.id, retroId, rids }
  } finally {
    await store.close()
  }

  const rewound = new Database(file)
  try {
    rewound.run('PRAGMA foreign_keys = ON')
    rollbackLastBatch(rewound)
  } finally {
    rewound.close()
  }
  console.log(JSON.stringify(seeded))
}

function reportPending(): void {
  const database = new Database(join(dataDir as string, 'retro.db'))
  try {
    console.log(JSON.stringify({ pending: pendingMigrations(database).length }))
  } finally {
    database.close()
  }
}

/**
 * The human's half of a round, from a process that is not the browser: every
 * record marked `revise`, then Finish.
 *
 * It is here rather than behind a CLI command because finishing is the human's
 * and has no CLI surface — that is the point of it — and because a revision may
 * only answer a finished round (`r-revision-sneaks-past-review`). A scenario
 * whose subject is the SSE stream needs the round put down without spending a
 * dozen browser steps on doing it, and this is the same
 * standing-in-for-the-server move `apps/cli/test/support/finish-review.ts`
 * makes one layer down.
 *
 * `revise` rather than `approved` because it is the verdict the gate's own
 * refusal names: a mid-round change request becomes a `revise` verdict and a
 * Finish, and the AI's next draft answers it. So the scenario that follows is
 * the loop's designed rhythm rather than a way around it.
 */
async function finishRound(): Promise<void> {
  const retroId = Number(rest[0])
  if (!Number.isInteger(retroId)) {
    console.error('usage: stage-tool.ts finish-round <retroId> <dataDir>')
    process.exit(2)
  }

  const store = openSqliteStore({ dataDir: dataDir as string, clock })
  try {
    const app = createApp(store, { clock })
    const { records } = await app.records.list.execute({
      actor: 'human',
      retro: { retroId },
    })
    for (const view of records) {
      await app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: view.record.rid,
        decision: { state: 'revise' },
      })
    }
    const finished = await app.review.finish.execute({ actor: 'human', retro: { retroId } })
    console.log(JSON.stringify({ retroId, revisionN: finished.revisionN }))
  } finally {
    await store.close()
  }
}

if (command === 'seed-old') await seedOld()
else if (command === 'pending') reportPending()
else if (command === 'finish-round') await finishRound()
else {
  console.error(`unknown command: ${command}`)
  process.exit(2)
}
