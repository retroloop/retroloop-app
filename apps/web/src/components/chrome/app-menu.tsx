import { Link } from '@tanstack/react-router'
import { MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * **The whole of this product's global navigation, in one dropdown at the top
 * right** — retro-13 `r-menu-dropdown`, the owner: *"Also, move the menu items
 * under a single dropdown in the top right — something that can be done using the
 * dropdown menu."* The reference he attached is the shadcn dropdown-menu itself,
 * so this is that primitive and not a hand-rolled menu.
 *
 * **It lives in the shell rather than on the pages.** The loose links it replaces
 * were the dashboard's own — the records link (A7), then the settings link, whose
 * comment already called itself *"the second link this slot has ever held, and the
 * last one it should"*. A menu each page had to remember to render is a menu that
 * goes missing on the page nobody thought about; mounting it here is what makes
 * "on every page" true by construction, and it is why `/records`, `/settings`,
 * the review and the record pages gain the navigation they never had without
 * touching one of their files.
 *
 * **The items are real links, and that is a requirement rather than an
 * implementation detail** (the record: *"with real links as items so
 * open-in-new-tab works"*). `asChild` hands the menu item's behaviour to a
 * router `Link`, so each row is an `<a href>` a reader can middle-click,
 * ⌘-click, or copy the address of — the three things a menu of `onSelect`
 * handlers silently refuses to do.
 *
 * **Two items and no more.** Records and Settings are the two places in this
 * product that are not reached from something on the page in front of you; the
 * way home is the brand beside this trigger (`app-brand.tsx`) and every
 * retrospective is reached from the dashboard that lists it. A menu is not a
 * sitemap, and the rule this repo holds every element to — *it earns its place or
 * it is left out* — applies hardest to the one control now on all six routes.
 *
 * **No pinned ongoing-review entry.** The record left one conditional on
 * *"record 6's second solution, if taken"*, and it was not: direction 6 shipped
 * as the Debt Front live band on the dashboard (`dashboard/live-band.tsx`), whose
 * whole argument is that a retrospective in flight gets a surface no finished one
 * can appear on. A second, quieter copy of that entry hidden behind a trigger
 * would compete with the surface built to be impossible to miss.
 *
 * **The theme toggle is not here either — it left the header entirely.** It moved
 * under Settings › Appearance › Dark Mode in session 12
 * (`settings/appearance.tsx`, retro-13 `r-theme-under-settings`), and the record
 * for this menu is explicit that it moves *under Settings*, not into the
 * dropdown. So the header now holds exactly two things: what this product is, and
 * where else you can go.
 */
export function AppMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" data-testid="app-menu" aria-label="Open menu">
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      {/* `w-auto` overrides the trigger-width default — the trigger is icon-sized,
          and a menu the width of a glyph would clip both of its own words. */}
      <DropdownMenuContent align="end" data-testid="app-menu-items" className="w-auto min-w-36">
        {DESTINATIONS.map(({ to, label, testId }) => (
          <DropdownMenuItem key={to} asChild data-testid={testId}>
            <Link to={to}>{label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * In the order the two pages were built and the order they are read in: the
 * corpus first, then the vocabulary that describes it. Written as data so the
 * menu cannot grow a row without the list growing a line — which is the review
 * this component wants when someone proposes a third.
 */
const DESTINATIONS: readonly { to: '/records' | '/settings'; label: string; testId: string }[] = [
  { to: '/records', label: 'Records', testId: 'app-menu-records' },
  { to: '/settings', label: 'Settings', testId: 'app-menu-settings' },
]
