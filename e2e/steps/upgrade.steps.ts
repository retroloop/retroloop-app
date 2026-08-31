import { expect } from '@playwright/test'
import { Given, Then, When } from '../fixtures'

/**
 * The upgrade path: a stage an older binary wrote, opened by a newer one.
 *
 * "Older binary" is the registry it carried, not an old artifact kept around —
 * seeding applies every migration except the last, which is exactly what that
 * binary's static registry would have held. The seeding runs in a Bun process
 * (`stage-tool.ts`) because it needs `bun:sqlite`, and because writing an older
 * schema is not something the product exposes and should not pretend to.
 */
Given('a stage written by an older schema, holding a session and a revision', async ({ retro }) => {
  const seeded = await retro.tool('seed-old')
  expect(seeded.code, `seeding failed: ${seeded.stderr}`).toBe(0)

  const { retroId, rids } = seeded.json<{ retroId: number; rids: string[] }>()
  retro.state.retroId = retroId
  retro.state.rids = rids

  // The stage really is behind: exactly one migration is waiting.
  const before = await retro.tool('pending')
  expect(before.json<{ pending: number }>().pending).toBe(1)
})

When('the server starts', async ({ retro }) => {
  await retro.startServer()
})

Then('every migration has been applied', async ({ retro }) => {
  // Applied by whichever process opened the stage first, under the write lock,
  // with no migrate command anywhere — there is not one (migrations.md).
  const after = await retro.tool('pending')
  expect(after.json<{ pending: number }>().pending).toBe(0)
})

Then('a pre-migration backup was taken', async ({ retro }) => {
  const backups = retro.backups()

  // Not a fresh install: there was a database worth keeping, so `VACUUM INTO`
  // snapshotted it before the batch. That snapshot is what `retro restore` puts
  // back if a migration turns out to be wrong.
  expect(backups).toHaveLength(1)
  expect(backups[0]).toMatch(/^retro-.*-pre-batch-\d+\.db$/)
})
