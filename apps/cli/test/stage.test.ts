import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_HOME, resolveDataDir, resolveHome, resolveStage } from '#stage'

/**
 * One root folder (RL-49): `~/.retroloop` is the root, and everything Retroloop
 * owns hangs off it — `data/` the stage, `backups/db/` the pre-migration
 * snapshots, `retros/` the exports. `--home` and `RETROLOOP_HOME` both name the
 * **root**, never the data directory. `RETRO_HOME` is retired: a name that once
 * meant the data directory would now silently mean a root, so it is ignored
 * rather than reinterpreted.
 */
describe('the root folder', () => {
  test('defaults to ~/.retroloop, with the stage under it', () => {
    expect(resolveHome({ env: {} })).toBe(join(homedir(), DEFAULT_HOME))
    expect(resolveDataDir({ env: {} })).toBe(join(homedir(), DEFAULT_HOME, 'data'))
  })

  test('RETROLOOP_HOME names the root; the stage is <root>/data', () => {
    expect(resolveHome({ env: { RETROLOOP_HOME: '/tmp/a' } })).toBe('/tmp/a')
    expect(resolveDataDir({ env: { RETROLOOP_HOME: '/tmp/a' } })).toBe(join('/tmp/a', 'data'))
  })

  test('RETRO_HOME alone is ignored — the retired name never names a root', () => {
    expect(resolveHome({ env: { RETRO_HOME: '/tmp/b' } })).toBe(join(homedir(), DEFAULT_HOME))
    expect(resolveDataDir({ env: { RETRO_HOME: '/tmp/b' } })).toBe(
      join(homedir(), DEFAULT_HOME, 'data'),
    )
  })

  test('--home beats the environment', () => {
    expect(resolveHome({ home: '/tmp/c', env: { RETROLOOP_HOME: '/tmp/a' } })).toBe('/tmp/c')
    expect(resolveDataDir({ home: '/tmp/c', env: { RETROLOOP_HOME: '/tmp/a' } })).toBe(
      join('/tmp/c', 'data'),
    )
  })

  test('a relative --home resolves against the caller cwd', () => {
    expect(resolveHome({ home: 'root', cwd: '/tmp/base', env: {} })).toBe(join('/tmp/base', 'root'))
    expect(resolveDataDir({ home: 'root', cwd: '/tmp/base', env: {} })).toBe(
      join('/tmp/base', 'root', 'data'),
    )
  })

  test('a relative RETROLOOP_HOME resolves against the caller cwd too', () => {
    expect(resolveHome({ cwd: '/tmp/base', env: { RETROLOOP_HOME: 'root' } })).toBe(
      join('/tmp/base', 'root'),
    )
  })

  test('the stage exposes the root it hangs off, next to the data directory', () => {
    const stage = resolveStage({ home: '/tmp/c', env: {} })

    expect(stage.home).toBe('/tmp/c')
    expect(stage.dataDir).toBe(join('/tmp/c', 'data'))
    expect(stage.lockFile).toBe(join('/tmp/c', 'data', 'server.lock'))
  })
})
