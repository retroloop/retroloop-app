import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { resolveDataDir } from '#stage'

/**
 * The data-dir env vars after the rename: `RETROLOOP_HOME` is the name the
 * product documents, `RETRO_HOME` stays honored as a silent alias so an
 * existing stage keeps resolving without any migration. The explicit `--data`
 * beats both.
 */
describe('the data-dir env alias', () => {
  test('RETROLOOP_HOME selects the stage', () => {
    expect(resolveDataDir({ env: { RETROLOOP_HOME: '/tmp/a' } })).toBe('/tmp/a')
  })

  test('RETRO_HOME still works alone — an existing stage needs no migration', () => {
    expect(resolveDataDir({ env: { RETRO_HOME: '/tmp/b' } })).toBe('/tmp/b')
  })

  test('RETROLOOP_HOME wins when both are set', () => {
    expect(resolveDataDir({ env: { RETROLOOP_HOME: '/tmp/a', RETRO_HOME: '/tmp/b' } })).toBe(
      '/tmp/a',
    )
  })

  test('--data beats both', () => {
    expect(
      resolveDataDir({ data: '/tmp/c', env: { RETROLOOP_HOME: '/tmp/a', RETRO_HOME: '/tmp/b' } }),
    ).toBe('/tmp/c')
  })

  test('a relative --data resolves against the caller cwd', () => {
    expect(resolveDataDir({ data: 'stage', cwd: '/tmp/base', env: {} })).toBe(
      join('/tmp/base', 'stage'),
    )
  })
})
