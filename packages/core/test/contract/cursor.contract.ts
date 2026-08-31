import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { StoreFactory } from './store.contract'

export function describeCursorRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · CursorRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    test('returns undefined for a consumer that has never read', async () => {
      expect(await store.cursors.find('tailer')).toBeUndefined()
    })

    test('creates a cursor on first save', async () => {
      const saved = await store.cursors.save({
        name: 'tailer',
        position: 12,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })

      expect(saved).toEqual({
        name: 'tailer',
        position: 12,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })
      expect(await store.cursors.find('tailer')).toEqual(saved)
    })

    test('moves a cursor that already exists, rather than adding a second', async () => {
      await store.cursors.save({
        name: 'tailer',
        position: 12,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })
      await store.cursors.save({
        name: 'tailer',
        position: 30,
        updatedAt: '2026-08-24T09:05:00.000Z',
      })

      expect(await store.cursors.find('tailer')).toEqual({
        name: 'tailer',
        position: 30,
        updatedAt: '2026-08-24T09:05:00.000Z',
      })
    })

    test('keeps consumers apart', async () => {
      await store.cursors.save({
        name: 'tailer',
        position: 12,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })
      await store.cursors.save({
        name: 'export',
        position: 4,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })

      expect((await store.cursors.find('tailer'))?.position).toBe(12)
      expect((await store.cursors.find('export'))?.position).toBe(4)
    })

    test('starts from zero, which means nothing has been read', async () => {
      await store.cursors.save({
        name: 'tailer',
        position: 0,
        updatedAt: '2026-08-24T09:00:00.000Z',
      })

      expect((await store.cursors.find('tailer'))?.position).toBe(0)
    })
  })
}
