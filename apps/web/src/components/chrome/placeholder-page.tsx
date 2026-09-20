import { ConstructionIcon, SearchXIcon } from 'lucide-react'
import type { Crumb } from '@/components/chrome/app-breadcrumb'
import { AppShell } from '@/components/chrome/app-shell'
import { APP_NAME } from '@/lib/app-name'

/**
 * The routes that exist so the contract's URLs resolve. They
 * render the breadcrumb, the page title and one line saying what will be here.
 * Nothing on them is interactive — a control here would be a control nobody
 * asked for.
 */
export function PlaceholderPage({
  crumbs,
  kind,
  title,
  placeholder,
}: {
  crumbs: readonly Crumb[]
  kind: string
  title: string
  placeholder: string
}) {
  return (
    <AppShell crumbs={crumbs}>
      <div className="flex flex-col gap-6" data-testid="placeholder">
        <header className="flex flex-col gap-2">
          <h2 className="section-label">{kind}</h2>
          <h1 className="font-semibold text-xl tracking-tight" data-testid="page-title">
            {title}
          </h1>
        </header>

        <div className="flex items-center gap-3 rounded-xl border border-border border-dashed bg-card px-4 py-5">
          <ConstructionIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">{placeholder}</p>
        </div>
      </div>
    </AppShell>
  )
}

/** An id nothing answers to. Kept deliberately plain. */
export function NotFoundPage({ what, id }: { what: string; id: string }) {
  return (
    <AppShell crumbs={[{ label: APP_NAME, to: '/' }, { label: 'Not found' }]}>
      <div
        className="flex items-center gap-3 rounded-xl border border-hairline bg-card px-4 py-5"
        data-testid="not-found"
      >
        <SearchXIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm">
          No {what} with id <span className="font-mono text-muted-foreground">{id}</span>.
        </p>
      </div>
    </AppShell>
  )
}
