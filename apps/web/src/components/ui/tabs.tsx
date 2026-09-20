import { Tabs as TabsPrimitive } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The tab strip, on Radix's `Tabs` — which is where the keyboard behaviour comes
 * from and the reason this is not three buttons and a conditional. A tablist
 * with roving focus, arrow keys, Home/End and `aria-selected` is a contract a
 * screen reader already knows, and it is not one worth reimplementing by hand.
 *
 * **Trimmed from what `shadcn add tabs` wrote**, and nothing in the generated
 * file was wrong — the two reasons are both about where the open-tab styling
 * lives.
 *
 * **The vertical orientation is back, because it has a caller**
 * (`r-settings-vertical-tabs`): shadcn ships vertical tabs and the settings page
 * is built on them. It was trimmed at first on the rule that a variant nobody
 * asked for is a second look nobody approved — and the settings page is now the
 * one asking. It is Radix's own `orientation="vertical"`: the arrow keys become
 * up/down and every part gets `data-orientation="vertical"`, which is what the
 * classes below key off, so this is one prop rather than a second component.
 * The `line` variant still has no caller and is still not here.
 *
 * **The two orientations' layout classes are two disjoint sets, and that is the
 * `PRESSED` lesson again rather than tidiness.** tailwind-merge only drops a
 * class another one *with the same modifier* would conflict with, so a bare
 * `bg-muted` beside a `data-vertical:bg-transparent` survives into the same
 * class list and the winner is decided by the order Tailwind happened to emit
 * two selectors of equal specificity — `data-vertical` compiles to a
 * zero-specificity `:where()`. So every utility the two orientations disagree
 * about carries a `data-horizontal:` or a `data-vertical:` and never neither:
 * the branches are mutually exclusive, exactly one matches, and nothing is left
 * to emission order. Only what both orientations genuinely share is unprefixed.
 *
 * The rest is the `PRESSED` lesson from `decision-controls.tsx`, taken before it
 * had to be learned again. The generated file separates an open tab from a
 * closed one with a bare `data-active:bg-background` *and* a
 * `dark:data-active:bg-input/30`, and tailwind-merge only drops a class another
 * one **with the same modifier** would conflict with — so a call site that
 * wanted a readable fill would have to overwrite both halves and remember why,
 * which is exactly the trap that shipped a verdict button styled in one theme
 * and bare in the other. Here the three channels an open tab differs by — fill,
 * ink, border — are one line, in one place, with no `dark:` override to lose a
 * fight with.
 *
 * `data-active:` is the project's own variant rather than Tailwind's:
 * `styles.css` imports `shadcn/tailwind.css`, which registers `data-active`,
 * `data-checked`, `data-horizontal` and `data-vertical` as
 * `[data-state="active"]` and friends,
 * the attributes Radix actually sets. A bare `data-x` in Tailwind 4.3 means
 * `[data-x]` and would match nothing here, so the variant is load-bearing —
 * `radio-group.tsx` leans on the same one.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn(
        'flex',
        // Horizontal: the strip above its panel — what every horizontal caller
        // gets, unchanged.
        'data-horizontal:flex-col data-horizontal:gap-3',
        // Vertical: the nav beside the panel, and `items-start` so a short nav
        // does not stretch to the height of a long panel.
        'data-vertical:flex-row data-vertical:items-start data-vertical:gap-6',
        className,
      )}
      {...props}
    />
  )
}

/**
 * `w-fit` horizontally, so the strip is as wide as its tabs and no wider — a
 * full-width segmented control would say the three solutions divide the record
 * between them, and they do not. Vertically the width is the **caller's**: a nav
 * is a column of a layout, and `settings.tsx` sizes it so the panel's left edge
 * stays put as the reader moves between sections.
 *
 * Nothing here wraps or clamps. A three-tab strip measures 378px against the
 * 678px reading column at the narrowest screen this product is read on
 * (1024 × 1366, measured), so `flex-wrap` and `max-w-full` were insurance
 * against a width that cannot happen — and a class no viewport exercises is a
 * class whose failure nothing would catch.
 */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex rounded-lg',
        'data-horizontal:w-fit data-horizontal:items-center data-horizontal:gap-1',
        'data-horizontal:bg-muted data-horizontal:p-1',
        // Vertical: a column of rows on the page's own ground. The enclosing
        // tray goes — in the reference the section list is a list, not a
        // segmented control — so the only fill anywhere on it is the selected
        // row's, and the width is the caller's to set.
        'data-vertical:flex-col data-vertical:items-stretch data-vertical:gap-0.5',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Three channels tell an open tab from a closed one — its fill, its ink and its
 * border — and none of them is a colour a theme can bleach on its own
 * (`r-theme-blind-assertions`). The weight is deliberately *not* one of them:
 * bolding the open tab would resize it, and a strip that jumps every time the
 * reviewer looks at another solution is worse than one channel fewer.
 *
 * The border is `transparent` rather than absent on a closed tab, because
 * `@layer base` gives every element `border-border` — a bare `border` here would
 * draw a visible box on all of them.
 *
 * The focus ring is the app's own: `button:focus-visible` in `styles.css`
 * already rings every interactive target, and this is a `<button>`.
 */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-3 font-medium text-muted-foreground text-sm transition-colors',
        'hover:text-foreground',
        'data-active:border-hairline data-active:bg-card data-active:text-foreground',
        'data-horizontal:py-1',
        // Vertical: the row fills the nav's width, its text starts at the left
        // so the names line up as a list, and it is taller because it is a row
        // in a list rather than a segment in a strip. A centred label in a
        // full-width row would read as a button rather than as a section.
        'data-vertical:w-full data-vertical:justify-start data-vertical:py-2',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
