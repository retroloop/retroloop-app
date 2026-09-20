import type { ReactNode } from 'react'
import { AppBrand } from '@/components/chrome/app-brand'
import { AppBreadcrumb, type Crumb } from '@/components/chrome/app-breadcrumb'
import { AppMenu } from '@/components/chrome/app-menu'
import { cn } from '@/lib/utils'

/**
 * The global chrome: the brand and the navigation menu in a top menu, and the
 * trail on the line below it — breadcrumbs belong somewhere below the top menu
 * rather than inside it.
 *
 * **What the header holds is now exactly two things: what this product is, and
 * where else you can go** (`r-menu-dropdown`). The theme toggle that used to
 * sit on the right is gone from the chrome entirely — it is Settings ›
 * Appearance › Dark Mode and nothing else (`settings/appearance.tsx`) — and the
 * loose nav links the dashboard used to hang in its `action` slot are the two
 * items of the one dropdown (`app-menu.tsx`), mounted here so that "on every
 * page" is true by construction rather than by six pages remembering.
 *
 * **The trail sits inside `<main>`, not in a second bar of chrome, and it does
 * not stick.** That is an engineering call before it is a taste one. Five offsets
 * in this app are measured off this header's `h-14`: the records bar and the
 * review bar rest against it at `top-14` (`records-filter.tsx`,
 * `record-filter.tsx`), the two review rails hang from `top-20` with a
 * `calc(100dvh-6rem)` cap (`record-rail.tsx`, `review-thread.tsx`), and the
 * review's scroll targets clear it with `scroll-mt-20`/`scroll-mt-28`
 * (`record-filter.tsx`). A sticky strip below the header changes the height of
 * the chrome and retunes all five; a trail that is part of the document retunes
 * none of them — and it gives the page its whole viewport back the moment the
 * reader scrolls, which on a page whose subject is a corpus of 132 records is
 * the more valuable half of the trade.
 *
 * **It renders only when there is somewhere above the current page.** On the
 * dashboard the trail would be the single crumb "Retro", directly beneath the
 * word "Retro" in the header — a line that repeats the brand and points nowhere.
 * A breadcrumb with no parent to lead to is not a shortened trail; it is a
 * control that has earned nothing.
 *
 * `lead` and `action` are two slots in that header, and since the dropdown took
 * the global links they are **page-specific affordances only**. The review page
 * is the one page that uses either, for its two side panels on the widths where
 * they have no rail to live in (`r-review-actions-pinned`, and the same need on
 * a tablet) — those stay where they are, because what the dropdown consolidates
 * is *global* navigation. They are slots rather than components of their own
 * because the header is the one strip of the page that is already sticky and
 * already paid for — putting either affordance anywhere else would spend
 * vertical space, which is the whole complaint the first of those records was
 * filed over.
 *
 * Each sits on the side its panel opens from: `lead` before the breadcrumb for
 * the record index, which comes out of the left, and `action` after it for the
 * comments, which come out of the right. A glyph on the far side from its own
 * sheet would be a control pointing away from what it opens.
 *
 * **The measure is one measure, on every page and in every state**: the width of
 * the home page and the width of the retrospective page have to agree. It used
 * to be conditional: a `wide` prop the review page passed exactly while its
 * comment rail was mounted, so the dashboard sat at 1024px on a screen where
 * the review sat at 1280px and the review itself changed width with a query's
 * answer.
 *
 * The reason it was conditional is still true and is now handled where it
 * belongs. The extra `wide` measure is the third column's room; hand it to a
 * reading column that is `flex-1` with no cap and the prose runs to 992px, which
 * is what a UI review measured on every retrospective filed before review-level
 * comments. So the reading column caps *itself* (`retros.$retroId.tsx`), and the
 * page keeps its width whether or not a rail is beside it — which is also why
 * the column no longer moves sideways when one mounts.
 */
export function AppShell({
  crumbs,
  lead,
  action,
  children,
}: {
  crumbs: readonly Crumb[]
  lead?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-hairline border-b bg-background/85 backdrop-blur-md">
        <div className={cn('mx-auto flex h-14 w-full items-center gap-3 px-4 sm:px-6', MEASURE)}>
          <AppBrand />
          {lead}
          <div className="min-w-0 flex-1" />
          {action}
          <AppMenu />
        </div>
      </header>

      <main
        data-testid="page-measure"
        className={cn('mx-auto w-full px-4 pt-6 pb-20 sm:px-6 sm:pt-8', MEASURE)}
      >
        {crumbs.length > 1 ? (
          <div data-testid="breadcrumb-bar" className="pb-5">
            <AppBreadcrumb crumbs={crumbs} />
          </div>
        ) : null}
        {children}
      </main>
    </div>
  )
}

/**
 * 1024px, and 1536px once there is a screen wide enough for three columns
 * (`wide`, 92rem — styles.css). The header and the page body share it, so the
 * breadcrumb starts where the content does, and every route shares it, which is
 * the whole of the rule.
 *
 * 1536 is not a round number chosen for looking wide: it is what the review's
 * three columns and their gutters come to — 24 + 288 + 32 + 768 + 32 + 368 + 24
 * — so at the width where the measure stops growing the last column ends exactly
 * where the header's own last control does. Any other number would leave pixels
 * that no column ever claims, hanging off the right of every wide screen.
 *
 * **The 128px this gained over the earlier 1408 all went to the rails**
 * (`r-wider-page-for-panels`): the maximum width grew, and all of the gain goes
 * to the left index panel and the right comments panel. The reading column's
 * cap did not move: 48rem is a typography ceiling and wider prose would be
 * worse prose, where the rails hold navigation and threads that clip and
 * truncate. So the index took 48 of it and the comments 80 — weighted to the
 * side where threads wrap hardest — and the sum is this number.
 *
 * `mx-auto` is the other half of that rule: past 1536 the page stops growing
 * and centres instead, so an ultra-wide screen gets margins rather than a line
 * of prose running its whole width.
 */
const MEASURE = 'max-w-5xl wide:max-w-[96rem]'
