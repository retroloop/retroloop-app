import { afterAll } from 'bun:test'
import { createTempStage, openTempStore, removeTempStages } from '../support/temp-stage'
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
 * The real store against every repository contract (testing.md suite 1).
 *
 * These are the same functions `memory.contract.test.ts` calls. That is the whole
 * point: the memory adapter is the only mock in the system, and the way it earns
 * that place is by passing, test for test, what `bun:sqlite` passes. Behaviour
 * types cannot express — a miss returns `undefined`, a failed unit of work leaves
 * nothing behind — is proven here once, and every suite above L1 may then trust
 * the fake.
 *
 * The last three suites are read models rather than repositories — `retros.list`,
 * `records.listAll` and `records.byId`: see `list-retros.contract.ts` for why a
 * fold over several reads is run against both adapters too.
 */
const makeStore: StoreFactory = async () => openTempStore({ dataDir: createTempStage() })

describeStoreContract('sqlite', makeStore)
describeSessionRepositoryContract('sqlite', makeStore)
describeRetrospectiveRepositoryContract('sqlite', makeStore)
describeRevisionRepositoryContract('sqlite', makeStore)
describeRecordIdRepositoryContract('sqlite', makeStore)
describeDecisionRepositoryContract('sqlite', makeStore)
describeFinishMessageRepositoryContract('sqlite', makeStore)
describeHoldRepositoryContract('sqlite', makeStore)
describeRecordLifecycleRepositoryContract('sqlite', makeStore)
describeRecordClaimRepositoryContract('sqlite', makeStore)
describeDefinitionRepositoryContract('sqlite', makeStore)
describeRecordMarkupRepositoryContract('sqlite', makeStore)
describeRecordRelationRepositoryContract('sqlite', makeStore)
describeNoteRepositoryContract('sqlite', makeStore)
describeAnnotationRepositoryContract('sqlite', makeStore)
describeCommentThreadRepositoryContract('sqlite', makeStore)
describeThreadResolutionRepositoryContract('sqlite', makeStore)
describeRequestRepositoryContract('sqlite', makeStore)
describeEventRepositoryContract('sqlite', makeStore)
describeCursorRepositoryContract('sqlite', makeStore)
describeListRetrosContract('sqlite', makeStore)
describeListAllRecordsContract('sqlite', makeStore)
describeGetRecordByIdContract('sqlite', makeStore)

afterAll(removeTempStages)
