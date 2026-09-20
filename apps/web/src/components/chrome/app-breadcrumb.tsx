import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'

export type Crumb = {
  readonly label: string
  /**
   * Omitted on the final crumb, which is the current page — and on any crumb
   * with nowhere to go. The project is one: data-model.md makes it a string on
   * the session rather than an entity, so there is no id to link with, and a
   * crumb that guessed one would be a link to the wrong project.
   */
  readonly to?:
    | '/'
    | '/projects/$projectId'
    | '/sessions/$sessionId'
    | '/retros/$retroId'
    /**
     * The flat records page, which became a link rather than a leaf when a
     * record got a page of its own: `Retro › Records › #7` is the trail a reader
     * arrives on, and the middle crumb is the way back to the list they came
     * from.
     */
    | '/records'
  readonly params?: Record<string, string>
}

/**
 * `Retro › Project › Session › Retro #n · Rev k`, truncated to what applies.
 *
 * **It is a trail and nothing else.** The mark and the app name
 * used to ride on the first crumb, because the trail was the header; now the
 * header has a brand of its own (`app-brand.tsx`) and this renders one line below
 * it, inside the page. So the first crumb lost the glyph and the bold — it is an
 * ancestor like any other, and drawing the mark here would put it on screen
 * twice.
 *
 * The first crumb is still "Retro" and still links home. Dropping it would have
 * made the trail start mid-air at "Records", and the way back to the dashboard is
 * the one thing every reader of a trail reaches for.
 */
export function AppBreadcrumb({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <Breadcrumb data-testid="breadcrumb">
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1.5">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          // The root crumb is one short word and every other crumb can be a path;
          // holding it clear of the shrink keeps "Retro" whole while a working
          // directory truncates.
          const isRoot = index === 0
          const content = (
            <span className="flex min-w-0 items-center gap-2" data-testid="breadcrumb-crumb">
              <span className="truncate">{crumb.label}</span>
            </span>
          )

          return (
            <Fragment key={crumb.label}>
              <BreadcrumbItem className={cn('min-w-0', isRoot && 'shrink-0')}>
                {isLast ? (
                  <BreadcrumbPage>{content}</BreadcrumbPage>
                ) : crumb.to === undefined ? (
                  // Not a link and not the current page, so neither of the two
                  // shadcn slots fits: `BreadcrumbPage` would put a second
                  // `aria-current="page"` on the trail.
                  content
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to} params={crumb.params as never} className="min-w-0 rounded">
                      {content}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator className="shrink-0 [&>svg]:size-3" />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
