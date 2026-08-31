import { expect, test } from '@playwright/test'
import type { AppRouterOutputs } from '@retro/api'
import { reviewCrumbs } from '../src/lib/review-crumbs'

/**
 * The review trail, both ways round (KC-0020).
 *
 * `session create --project` is optional now, so a retro whose session never
 * carried a project is the ordinary case — and the page has to read the same
 * either way. This is the lowest layer that can say so: the trail is pure data,
 * and a scenario would need a second fixture world to prove one branch of it
 * (testing.md §The lowest layer that can express it).
 */
type Retro = AppRouterOutputs['retros']['get']

const RETRO: Retro = {
  retroId: 1,
  session: { id: 12, cwd: '/Users/haider/Developer/retro', startedAt: '2026-08-24T09:00:00.000Z' },
  project: 'retro',
  title: 'The lock file that outlived its process',
  retroNumber: 3,
  state: 'reviewing',
  startedAt: '2026-08-24T09:00:00.000Z',
  finishedAt: null,
  latestRevision: 2,
  revisions: [],
}

test('names the project between the app and the session when the session carries one', () => {
  expect(reviewCrumbs(RETRO, 2).map((crumb) => crumb.label)).toEqual([
    'Retroloop',
    'retro',
    'Session 12',
    'Retro #3 · Rev 2',
  ])
})

test('leaves the crumb out entirely when it does not — no empty crumb, no placeholder', () => {
  expect(reviewCrumbs({ ...RETRO, project: null }, 2).map((crumb) => crumb.label)).toEqual([
    'Retroloop',
    'Session 12',
    'Retro #3 · Rev 2',
  ])
})
