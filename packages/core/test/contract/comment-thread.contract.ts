import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewComment, NewCommentThread } from '#domain/models/comment-thread.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

function aNewComment(overrides: Partial<NewComment> = {}): NewComment {
  return {
    threadId: 0,
    actor: 'human',
    text: 'The impact is understated here.',
    at: '2026-08-23T10:01:00.000Z',
    revisionN: 4,
    ...overrides,
  }
}

export function describeCommentThreadRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · CommentThreadRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewThread = (overrides: Partial<NewCommentThread> = {}): NewCommentThread => ({
      retroId,
      rid: 'r-deploy-blocked',
      section: 'problem',
      openedAt: '2026-08-23T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('opens a thread with no messages', async () => {
      const thread = await store.threads.addThread(aNewThread())

      expect(thread.messages).toEqual([])
      expect(await store.threads.findById(thread.id)).toEqual(thread)
    })

    test('appends messages in order and returns the whole thread', async () => {
      const thread = await store.threads.addThread(aNewThread())

      await store.threads.addComment(thread.id, aNewComment({ text: 'first' }))
      const updated = await store.threads.addComment(
        thread.id,
        aNewComment({ actor: 'ai', text: 'second' }),
      )

      expect(updated?.messages.map((message) => message.text)).toEqual(['first', 'second'])
      expect(updated?.messages.every((message) => message.threadId === thread.id)).toBe(true)
      expect(await store.threads.findById(thread.id)).toEqual(updated)
    })

    /**
     * The revision a comment was written against is stored on the message
     * (`comments_add_revision`), and it is nullable because every comment
     * written before the column existed has none — human data is never
     * rewritten, so those rows stay NULL forever and a reader derives instead.
     * Both directions have to be proven: a stored 7 that came back as `undefined`
     * would send every message through the derivation without anybody noticing.
     */
    test('keeps the revision a comment was written against, and an absent one absent', async () => {
      const thread = await store.threads.addThread(aNewThread())

      await store.threads.addComment(thread.id, aNewComment({ text: 'stamped', revisionN: 7 }))
      const updated = await store.threads.addComment(
        thread.id,
        aNewComment({ text: 'unstamped', revisionN: undefined }),
      )

      expect(updated?.messages.map((message) => message.revisionN)).toEqual([7, undefined])
      expect((await store.threads.findById(thread.id))?.messages.at(0)?.revisionN).toBe(7)
    })

    test('returns undefined for a miss', async () => {
      expect(await store.threads.findById(404)).toBeUndefined()
      expect(await store.threads.addComment(404, aNewComment())).toBeUndefined()
      expect(await store.threads.findByAnchor(retroId, 'r-nope', 'problem')).toBeUndefined()
    })

    test('finds the one thread anchored to a record section', async () => {
      const problem = await store.threads.addThread(aNewThread({ section: 'problem' }))
      await store.threads.addThread(aNewThread({ section: 'direction' }))

      expect(await store.threads.findByAnchor(retroId, 'r-deploy-blocked', 'problem')).toEqual(
        problem,
      )
    })

    test('lists a retrospective, filtered by record', async () => {
      const first = await store.threads.addThread(aNewThread())
      const other = await store.threads.addThread(aNewThread({ rid: 'r-other' }))
      const review = await store.threads.addThread(
        aNewThread({ rid: undefined, section: undefined }),
      )
      await store.threads.addThread(aNewThread({ retroId: otherRetroId }))

      expect(await store.threads.listByRetro(retroId)).toEqual([first, other, review])
      expect(await store.threads.listByRetro(retroId, { rid: 'r-other' })).toEqual([other])
    })

    test('filters to threads whose last message is human — the unanswered ones', async () => {
      const answered = await store.threads.addThread(aNewThread({ section: 'problem' }))
      await store.threads.addComment(answered.id, aNewComment({ actor: 'human' }))
      await store.threads.addComment(answered.id, aNewComment({ actor: 'ai' }))

      const waiting = await store.threads.addThread(aNewThread({ section: 'direction' }))
      await store.threads.addComment(waiting.id, aNewComment({ actor: 'ai' }))
      await store.threads.addComment(waiting.id, aNewComment({ actor: 'human' }))

      // An empty thread has no human message waiting, so it is not unanswered.
      await store.threads.addThread(aNewThread({ section: 'footprint' }))

      const unanswered = await store.threads.listByRetro(retroId, { unansweredOnly: true })
      expect(unanswered.map((thread) => thread.id)).toEqual([waiting.id])
    })
  })
}
