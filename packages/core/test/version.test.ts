import { describe, expect, test } from 'bun:test'
import { CORE_VERSION as viaSubpath } from '#version'
import { CORE_VERSION as viaBarrel } from '../src/index'

describe('core package wiring', () => {
  test('the barrel and the #* subpath import resolve to the same module', () => {
    expect(viaBarrel).toBe(viaSubpath)
  })

  test('the core version is a semver string', () => {
    expect(viaBarrel).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
