import type { AppRouterOutputs } from '@retro/api'
import type { Crumb } from '@/components/chrome/app-breadcrumb'
import { APP_NAME } from '@/lib/app-name'

type Retro = AppRouterOutputs['retros']['get']

/**
 * The review page's trail: `Retro › [project ›] Session S › Retro #n · Rev k`.
 *
 * The project crumb appears only when the session carries one. `project` went
 * optional and dormant — one project routinely holds several
 * software packages, so it was the wrong unit, and nothing routes or groups by
 * it any more — which makes "no project" the ordinary case rather than a
 * degraded one. It is not a link even when present: data-model.md keeps it a
 * string on the session rather than an entity, so there is no id to link with.
 *
 * Pure data, so both shapes of the trail are provable without a browser
 * (`test/review-crumbs.spec.ts`).
 */
export function reviewCrumbs(retro: Retro, revision: number): readonly Crumb[] {
  return [
    { label: APP_NAME, to: '/' },
    ...(retro.project === null ? [] : [{ label: retro.project }]),
    {
      label: `Session ${retro.session.id}`,
      to: '/sessions/$sessionId',
      params: { sessionId: String(retro.session.id) },
    },
    { label: `Retro #${retro.retroNumber} · Rev ${revision}` },
  ]
}
