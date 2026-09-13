import type { Migration } from '#infrastructure/sqlite/migration'
import { migration as createSessions } from '#infrastructure/sqlite/migrations/20260823120000_create_sessions'
import { migration as createRetrospectives } from '#infrastructure/sqlite/migrations/20260823120100_create_retrospectives'
import { migration as createRevisions } from '#infrastructure/sqlite/migrations/20260823120200_create_revisions'
import { migration as createDecisions } from '#infrastructure/sqlite/migrations/20260823120300_create_decisions'
import { migration as createNotes } from '#infrastructure/sqlite/migrations/20260823120400_create_notes'
import { migration as createAnnotations } from '#infrastructure/sqlite/migrations/20260823120500_create_annotations'
import { migration as createCommentThreads } from '#infrastructure/sqlite/migrations/20260823120600_create_comment_threads'
import { migration as createComments } from '#infrastructure/sqlite/migrations/20260823120700_create_comments'
import { migration as createRequests } from '#infrastructure/sqlite/migrations/20260823120800_create_requests'
import { migration as createRequestResponses } from '#infrastructure/sqlite/migrations/20260823120900_create_request_responses'
import { migration as createEvents } from '#infrastructure/sqlite/migrations/20260823121000_create_events'
import { migration as createCursors } from '#infrastructure/sqlite/migrations/20260824090000_create_cursors'
import { migration as sessionsProjectOptional } from '#infrastructure/sqlite/migrations/20260825090000_sessions_project_optional'
import { migration as revisionsAddTitle } from '#infrastructure/sqlite/migrations/20260825091000_revisions_add_title'
import { migration as createHolds } from '#infrastructure/sqlite/migrations/20260825120000_create_holds'
import { migration as decisionsAllowRevise } from '#infrastructure/sqlite/migrations/20260826090000_decisions_allow_revise'
import { migration as commentsAddRevision } from '#infrastructure/sqlite/migrations/20260827090000_comments_add_revision'
import { migration as createThreadResolutions } from '#infrastructure/sqlite/migrations/20260827090100_create_thread_resolutions'
import { migration as solutionsAnchorAndSelection } from '#infrastructure/sqlite/migrations/20260828090000_solutions_anchor_and_selection'
import { migration as createFinishMessages } from '#infrastructure/sqlite/migrations/20260828100000_create_finish_messages'
import { migration as createRecordLifecycle } from '#infrastructure/sqlite/migrations/20260829093000_create_record_lifecycle'
import { migration as createRecordIds } from '#infrastructure/sqlite/migrations/20260830090000_create_record_ids'
import { migration as recordLifecycleAllowArchive } from '#infrastructure/sqlite/migrations/20260831090000_record_lifecycle_allow_archive'
import { migration as createLabelDefinitions } from '#infrastructure/sqlite/migrations/20260901090000_create_label_definitions'
import { migration as createAttributeDefinitions } from '#infrastructure/sqlite/migrations/20260901090100_create_attribute_definitions'
import { migration as createSettings } from '#infrastructure/sqlite/migrations/20260901090200_create_settings'
import { migration as createRecordLabels } from '#infrastructure/sqlite/migrations/20260901090300_create_record_labels'
import { migration as createRecordAttributeValues } from '#infrastructure/sqlite/migrations/20260901090400_create_record_attribute_values'
import { migration as createRecordRelations } from '#infrastructure/sqlite/migrations/20260901090500_create_record_relations'
import { migration as createRecordClaims } from '#infrastructure/sqlite/migrations/20260913090000_create_record_claims'

/**
 * The static registry (migrations.md).
 *
 * Every migration is imported by name because **a compiled binary cannot glob a
 * directory** — `bun build --compile` bundles what the source references and
 * nothing else. `bun run scripts/make-migration.ts <name>` maintains this file;
 * appending by hand is fine as long as the array stays sorted by version, which
 * is the order the migrator applies them in.
 *
 * Parents before children: the foreign keys point backwards through this list.
 */
export const MIGRATIONS: readonly Migration[] = [
  createSessions,
  createRetrospectives,
  createRevisions,
  createDecisions,
  createNotes,
  createAnnotations,
  createCommentThreads,
  createComments,
  createRequests,
  createRequestResponses,
  createEvents,
  createCursors,
  sessionsProjectOptional,
  revisionsAddTitle,
  createHolds,
  decisionsAllowRevise,
  commentsAddRevision,
  createThreadResolutions,
  solutionsAnchorAndSelection,
  createFinishMessages,
  createRecordLifecycle,
  createRecordIds,
  recordLifecycleAllowArchive,
  // The two definition tables come before the two that reference them, which is
  // the "parents before children" rule above: `record_labels.label_id` and
  // `record_attribute_values.attribute_id` are foreign keys into them.
  createLabelDefinitions,
  createAttributeDefinitions,
  createSettings,
  createRecordLabels,
  createRecordAttributeValues,
  // Same rule again, one table further back: `record_relations.from_id` and
  // `.to_id` are both foreign keys into `record_ids`, which is minted well above
  // this line.
  createRecordRelations,
  createRecordClaims,
]
