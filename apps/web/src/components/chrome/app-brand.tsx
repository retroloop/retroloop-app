import { Link } from '@tanstack/react-router'
import { APP_NAME } from '@/lib/app-name'

/** A small loop mark — the retrospective cycle, in the accent. */
function RetroMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-primary" fill="none" aria-hidden>
      <path
        d="M8 2.4a5.6 5.6 0 1 1-5.24 3.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M2.2 2.3v3.5h3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The product's name in the top menu, and the way home from anywhere.
 *
 * It exists because the trail left the header: breadcrumbs belong somewhere
 * below the top menu rather than inside it. The name used to be the trail's
 * first crumb, so moving the trail down would have taken the app's own name out
 * of the chrome and left a bar holding nothing but a theme toggle. The split is
 * the honest one: **the header says what this is, the trail below says where
 * you are.**
 *
 * The mark comes with it rather than staying on the first crumb, so the glyph is
 * drawn once per page — a mark in the header and a second mark directly beneath
 * it would be the product introducing itself twice.
 */
export function AppBrand() {
  return (
    <Link
      to="/"
      data-testid="app-brand"
      className="flex shrink-0 items-center gap-2 rounded font-semibold text-foreground text-sm tracking-tight"
    >
      <RetroMark />
      {APP_NAME}
    </Link>
  )
}
