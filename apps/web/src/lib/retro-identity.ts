/**
 * How a retrospective says what it is, in the two places one is shown: a
 * dashboard row and the review page's header (KC-0020, shortlist N1/N3).
 *
 * Both read the same two functions rather than each formatting the line, because
 * the point of an identity line is that it is the *same* line — a reader who
 * learns to recognise "Session 1 · Retro #1 · /Users/…/retro" on the dashboard
 * has to meet it unchanged when they click through. Strings rather than a shared
 * component: the markup differs (a row heading is not a page heading) and the
 * wording is what must not.
 *
 * Pure data, so both are provable without a browser (`test/retro-identity.spec.ts`).
 */

/**
 * Where a retrospective sits: which session, and which of that session's
 * retrospectives it is. It carries no title, because the identity line does not
 * print one — and a row that has no title to give must still be able to say
 * where it comes from. `records.listAll` is that row: its retrospective's name
 * is not on the wire (F1 dropped it on "every field earns its place"), and
 * without this split the flat records page could not call the shared function
 * and would have grown a third copy of the line.
 */
export type RetroPlace = {
  readonly retroNumber: number
  readonly session: { readonly id: number; readonly cwd: string }
}

/**
 * The identity fields, structurally. `retros.get` and `retros.list` both carry
 * them — deliberately as the same session shape (`views.schema.ts`) — so either
 * output satisfies this without being narrowed first.
 */
export type RetroIdentity = RetroPlace & {
  /**
   * The retrospective's **global** id — the number every URL, breadcrumb and
   * record page already uses, and since D5 the number its fallback name is built
   * from.
   *
   * It is on this shape and not on `RetroPlace` because `retroName` is the only
   * reader that needs it: the identity line below is deliberately the
   * *per-session* reading ("Session S · Retro #n"), which KC-0020 settled and
   * which is still true. Every output that satisfies this type already carries
   * the field — `retros.list`, `retros.get`, and `records.byId` through
   * `recordDetailSchema` — so nothing on the wire changed to make this possible.
   */
  readonly retroId: number
  readonly title: string | null
}

/**
 * What to call the retrospective: the name its latest revision gave it, or
 * "Retro <global id> — <cwd basename>" when that revision proposed none.
 *
 * **The fallback used to print `retroNumber`, and that was the bug.** The owner,
 * on the session-12 diary view: *"the [retros] need to have their global ids
 * displayed rather than session's internal [sequence] number"*, and then, ruling
 * on it directly (D5): *"untitled retros should show the global id as fallback."*
 * `retroNumber` counts **within a session** — three of his fourteen
 * retrospectives are "#1" and two more are "#2" — so on any list that shows more
 * than one session the old fallback printed a number that could not identify the
 * thing it was printed on. On the dashboard it was worse than ambiguous: the row
 * showed the global id in one column and `Retro #1` as the name three characters
 * away, which is two different numbers for one retrospective on one line.
 *
 * **The directory stays.** The fallback is still not a bare number, which is the
 * standing rule (ledger v2 #120, against bare ticket numbers) — and `Retro 2 —
 * retro` is the exact shape he was shown in the direction round before he ruled,
 * so keeping the basename is honouring the ruling rather than reading past it.
 * With a global id the basename no longer does the *distinguishing* work it was
 * originally there for, but it still says where the retrospective happened, which
 * is the only other thing an unnamed retro can tell you.
 *
 * Changed here and in one place, so all three surfaces inherit it: the dashboard
 * row, the review page's header, and the record page. That is the whole reason
 * this module exists — a reader who learns to recognise a name on one page has to
 * meet it unchanged on the next.
 */
export function retroName(retro: RetroIdentity): string {
  return retro.title ?? `Retro ${retro.retroId} — ${cwdBasename(retro.session.cwd)}`
}

/**
 * "Session S · Retro #n · <cwd>" — the identity line, whole (N1).
 *
 * The owner, on the order: *"On the home page it should show \"Session #X ·
 * Retro #Y\" instead of something like: \"Retro #1 · Session 1\""*. The session
 * is the larger thing and comes first — a retrospective is the *n*th of a
 * session, not the other way round — and the line now reads outside-in, the way
 * the breadcrumb already did.
 *
 * Changed in one place, so three surfaces follow: the dashboard row, the review
 * header, and a row of the flat records page — which is the reader who most
 * needs the line unchanged, since it is the only page where two of them are on
 * screen at once and telling them apart is the whole job.
 */
export function retroIdentityLine(retro: RetroPlace): string {
  return `Session ${retro.session.id} · Retro #${retro.retroNumber} · ${retro.session.cwd}`
}

/**
 * The last segment of the session's working directory. A trailing slash is
 * dropped rather than read as an empty name; a path with no segment left to take
 * (`/`) keeps what it was given, because showing the path is more use than
 * showing nothing.
 */
export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '')
  const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return basename === '' ? cwd : basename
}
