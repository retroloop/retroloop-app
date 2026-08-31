import { useState, useSyncExternalStore } from 'react'

/**
 * The review page has two columns that are not the reading column — the record
 * index on the left and the comments on the right — and both answer the same
 * question the same way: is there room for a third column, and if not, is the
 * sheet that stands in for one open?
 *
 * It is one hook because the answer has to be one answer. The two mounts of
 * either panel must **never both be in the document**: a hidden rail beside an
 * open sheet is two copies of the same list and, for the comments, two live
 * composers — and whichever one a reader (or a step) reached would be a coin
 * toss. That is also why the width is asked of `matchMedia` rather than declared
 * as `hidden wide:block`: a CSS-hidden rail is still mounted.
 */

/**
 * The `wide` breakpoint (`--breakpoint-wide: 92rem`, styles.css), read from one
 * place because every panel has to agree about it: the reading column plus one
 * side column already fill the page below this width, and there is no room for
 * the other.
 *
 * It moved from 80rem to 84rem in session 9 and to 92rem in session 10, both
 * times because the rails grew and never for its own sake. Rails of 288 and 368
 * leave a 1344px page 576px of prose, which is far below the band the reading
 * column is held to; 1472 is the first width where all three columns fit without
 * the reading one paying for them.
 *
 * **The cost is paid by real screens and it is the widest it has ever been**
 * (`r-wider-page-for-panels`): a 1440px laptop and a landscape iPad at 1366 both
 * read the review in the narrow layout now — one column, both panels behind
 * their glyphs — where at 84rem they had three columns. That is the trade the
 * rail widths make for themselves, and it is flagged in the lane report rather
 * than buried here: the two are one dial, and moving the rails is what moves it.
 */
const RAIL_FITS = '(min-width: 92rem)'

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(RAIL_FITS)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function railFits(): boolean {
  return window.matchMedia(RAIL_FITS).matches
}

export type SidePanel = {
  /** Whether the page is wide enough for the rail; the sheet answers for it below. */
  readonly fits: boolean
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
}

/**
 * Held by the page rather than by either mount, because the two mounts are in
 * different parts of the tree: a rail belongs beside the reading column and the
 * affordance that opens its sheet belongs in the sticky header.
 *
 * The sheet belongs to the narrow layout. Crossing into the rail's width takes
 * it off the page, and it must not be waiting there on the way back: an iPad
 * turned to landscape and home again would otherwise come back to a sheet nobody
 * tapped, which reads as the page acting on its own. That is adjusted during the
 * render that notices the width changed rather than from an effect, so there is
 * never a frame in which a sheet is open at a width that has no sheet.
 */
export function useSidePanel(): SidePanel {
  const [open, setOpen] = useState(false)
  const fits = useSyncExternalStore(subscribeToWidth, railFits)

  const [lastFits, setLastFits] = useState(fits)
  if (lastFits !== fits) {
    setLastFits(fits)
    setOpen(false)
  }

  return { fits, open, setOpen }
}
