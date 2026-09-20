import { createApp, openSqliteStore } from '@retro/core'

/**
 * Stands in for the second process: the human finishing a review.
 *
 * It is not the CLI, and it cannot be — finishing is human-only and UI-only, so
 * no CLI command exists for it. What matters for the test is that the write lands
 * from **a different process** against the same stage, exactly as the server will
 * do on the human's behalf.
 */
const dataDir = process.argv[2]
const retroId = Number(process.argv[3])
if (dataDir === undefined || !Number.isInteger(retroId)) {
  console.error('usage: finish-review.ts <dataDir> <retroId>')
  process.exit(2)
}

const store = openSqliteStore({ dataDir })
try {
  const app = createApp(store)
  await app.review.finish.execute({ actor: 'human', retro: { retroId } })
} finally {
  await store.close()
}
