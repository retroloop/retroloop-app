import { createFileRoute } from '@tanstack/react-router'
import { NotFoundPage, PlaceholderPage } from '@/components/chrome/placeholder-page'
import { APP_NAME } from '@/lib/app-name'
import { integerId } from '@/lib/ids'

export const Route = createFileRoute('/projects/$projectId')({ component: ProjectPage })

/**
 * A placeholder with a real breadcrumb (ux-brief 03).
 *
 * The contract says the crumb should carry the project's *name*, and v0 cannot:
 * `sessions.list`/`sessions.get` are deferred until the pages that need them
 * (trpc.md §Deferred), and inventing a procedure so a stub can be prettier is
 * exactly the trade this project refuses. So the crumb says what the URL knows.
 * "Unknown id" is therefore an id that is not an integer — the only kind this
 * route can recognise without asking the server.
 */
function ProjectPage() {
  const { projectId } = Route.useParams()
  const id = integerId(projectId)
  if (id === undefined) return <NotFoundPage what="project" id={projectId} />

  return (
    <PlaceholderPage
      crumbs={[{ label: APP_NAME, to: '/' }, { label: `Project ${id}` }]}
      kind="Project"
      title={`Project ${id}`}
      placeholder="This project's sessions, newest first, with a retro count and state for each."
    />
  )
}
