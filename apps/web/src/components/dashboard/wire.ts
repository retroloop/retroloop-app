import type { AppRouterOutputs } from '@retro/api'

/**
 * The retrospective row the dashboard reads, named once.
 *
 * `RecordListRow` already has a home (`components/records/record-lifecycle.tsx`)
 * because the lifecycle controls were born on a row of the flat page; the
 * retrospective row never needed a name while one component consumed it straight
 * from the query. The composed dashboard passes it through five — the live band,
 * the diary, the stat row, and both of the diary's densities — so it gets one.
 *
 * Taken from `AppRouterOutputs` rather than restated, which is R-MOCK-LOCK's
 * discipline applied to a type: the compiler is what stops this page believing in
 * a field the router does not serve.
 *
 * **There is deliberately no local name-fallback helper here any more.** An
 * earlier draft carried one (`roundRetroName`) because the shipped
 * `retroName` still fell back to the per-session number.
 * The global id is now the fallback *everywhere*, so
 * the fix went into `lib/retro-identity.ts` where the dashboard, the review header
 * and the record page all inherit it, and the duplicate died rather than shipping
 * beside it.
 */
export type RetroListRow = AppRouterOutputs['retros']['list'][number]
