import { createFileRoute } from '@tanstack/react-router'
import { NotFoundPage, PlaceholderPage } from '@/components/chrome/placeholder-page'
import { APP_NAME } from '@/lib/app-name'
import { integerId } from '@/lib/ids'

export const Route = createFileRoute('/sessions/$sessionId')({ component: SessionPage })

/** See `projects.$projectId.tsx` for why the crumb carries an id and not a name. */
function SessionPage() {
  const { sessionId } = Route.useParams()
  const id = integerId(sessionId)
  if (id === undefined) return <NotFoundPage what="session" id={sessionId} />

  return (
    <PlaceholderPage
      crumbs={[{ label: APP_NAME, to: '/' }, { label: `Session ${id}` }]}
      kind="Session"
      title={`Session ${id}`}
      placeholder="Branch, start time, the live notes stream, and this session's retrospectives — Tier 2."
    />
  )
}
