import { createMemoryStore } from '#infrastructure/memory/memory-store.adapter'
import { describeAnnotationRepositoryContract } from './annotation.contract'
import { describeCommentThreadRepositoryContract } from './comment-thread.contract'
import { describeCursorRepositoryContract } from './cursor.contract'
import { describeDecisionRepositoryContract } from './decision.contract'
import { describeDefinitionRepositoryContract } from './definition.contract'
import { describeEventRepositoryContract } from './event.contract'
import { describeFinishMessageRepositoryContract } from './finish-message.contract'
import { describeGetRecordByIdContract } from './get-record-by-id.contract'
import { describeHoldRepositoryContract } from './hold.contract'
import { describeListAllRecordsContract } from './list-all-records.contract'
import { describeListRetrosContract } from './list-retros.contract'
import { describeNoteRepositoryContract } from './note.contract'
import { describeRecordClaimRepositoryContract } from './record-claim.contract'
import { describeRecordIdRepositoryContract } from './record-id.contract'
import { describeRecordLifecycleRepositoryContract } from './record-lifecycle.contract'
import { describeRecordMarkupRepositoryContract } from './record-markup.contract'
import { describeRecordRelationRepositoryContract } from './record-relation.contract'
import { describeRequestRepositoryContract } from './request.contract'
import { describeRetrospectiveRepositoryContract } from './retrospective.contract'
import { describeRevisionRepositoryContract } from './revision.contract'
import { describeSessionRepositoryContract } from './session.contract'
import { describeStoreContract, type StoreFactory } from './store.contract'
import { describeThreadResolutionRepositoryContract } from './thread-resolution.contract'

/**
 * The memory store against every repository contract (testing.md suite 1).
 *
 * Item 3 adds `sqlite.contract.test.ts` next to this file, calling the same
 * functions with a temp-file store. Two implementations, one set of tests — which
 * is the only way "the memory adapter behaves like the real thing" can be a fact
 * rather than a hope.
 *
 * The last three suites are read models rather than repositories: `retros.list`
 * folds four reads into a dashboard row, `records.listAll` folds six into a flat
 * one, and `records.byId` folds six more into a record page and its timeline.
 * The fold is where the two adapters would be most likely to disagree without
 * anyone noticing.
 */
const makeStore: StoreFactory = async () => createMemoryStore()

describeStoreContract('memory', makeStore)
describeSessionRepositoryContract('memory', makeStore)
describeRetrospectiveRepositoryContract('memory', makeStore)
describeRevisionRepositoryContract('memory', makeStore)
describeRecordIdRepositoryContract('memory', makeStore)
describeDecisionRepositoryContract('memory', makeStore)
describeFinishMessageRepositoryContract('memory', makeStore)
describeHoldRepositoryContract('memory', makeStore)
describeRecordLifecycleRepositoryContract('memory', makeStore)
describeRecordClaimRepositoryContract('memory', makeStore)
describeDefinitionRepositoryContract('memory', makeStore)
describeRecordMarkupRepositoryContract('memory', makeStore)
describeRecordRelationRepositoryContract('memory', makeStore)
describeNoteRepositoryContract('memory', makeStore)
describeAnnotationRepositoryContract('memory', makeStore)
describeCommentThreadRepositoryContract('memory', makeStore)
describeThreadResolutionRepositoryContract('memory', makeStore)
describeRequestRepositoryContract('memory', makeStore)
describeEventRepositoryContract('memory', makeStore)
describeCursorRepositoryContract('memory', makeStore)
describeListRetrosContract('memory', makeStore)
describeListAllRecordsContract('memory', makeStore)
describeGetRecordByIdContract('memory', makeStore)
