import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { Session } from '#domain/models/session.model'
import { createHarness, type Harness } from '../support/harness'

describe('comment threads', () => {
  let harness: Harness
  let session: Session
  let retroId: number
  let rid: string

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
    const created = await harness.revision(session.id)
    retroId = created.retroId
    rid = created.revision.records[0]?.rid ?? ''
  })

  test('opens the thread on a record section and appends to it afterwards', async () => {
    const first = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid, section: 'problem' },
      text: 'The impact is understated here.',
    })
    const second = await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId },
      target: { kind: 'record', rid, section: 'problem' },
      text: 'Rewritten in revision 2.',
    })

    expect(second.thread.id).toBe(first.thread.id)
    expect(second.thread.rid).toBe(rid)
    expect(second.thread.section).toBe('problem')
    expect(second.thread.messages.map((message) => message.actor)).toEqual(['human', 'ai'])
    expect(await harness.eventNames()).toEqual([
      'SessionCreated',
      'RetrospectiveStarted',
      'RevisionCreated',
      'CommentAdded',
      'CommentAdded',
    ])
  })

  test('keeps a separate thread per section of the same record', async () => {
    const problem = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid, section: 'problem' },
      text: 'about the problem',
    })
    const direction = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid, section: 'direction' },
      text: 'about the direction',
    })

    expect(direction.thread.id).not.toBe(problem.thread.id)
  })

  test('opens a review-level thread anchored to nothing', async () => {
    const { thread } = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'review' },
      text: 'The whole revision reads as one problem, not three.',
    })

    expect(thread.rid).toBeUndefined()
    expect(thread.section).toBeUndefined()
    expect(thread.messages).toHaveLength(1)
  })

  test('replies into an existing thread by id — how the AI answers a review thread', async () => {
    const opened = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'review' },
      text: 'Please split record 1.',
    })

    const { thread } = await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId },
      target: { kind: 'thread', threadId: opened.thread.id },
      text: 'Split into r-one and r-two in revision 2.',
    })

    expect(thread.id).toBe(opened.thread.id)
    expect(thread.messages).toHaveLength(2)
  })

  test('replies to a thread without being told which retrospective it is in', async () => {
    const opened = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'review' },
      text: 'Please split record 1.',
    })

    // A thread id already determines its retrospective; `threads.reply({threadId,
    // text})` on the wire relies on that.
    const { thread } = await harness.app.threads.addComment.execute({
      actor: 'ai',
      target: { kind: 'thread', threadId: opened.thread.id },
      text: 'Split in revision 2.',
    })

    expect(thread.id).toBe(opened.thread.id)
    expect(thread.messages).toHaveLength(2)
  })

  test('still needs a retrospective to open a thread', async () => {
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'human',
        target: { kind: 'review' },
        text: 'about the whole review',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('is a NotFound when replying to a thread that does not exist', async () => {
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'ai',
        target: { kind: 'thread', threadId: 404 },
        text: 'into the void',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  test('refuses a thread that belongs to another retrospective', async () => {
    const other = await harness.session('uuid-other')
    const otherRetro = await harness.revision(other.id)
    const opened = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId: otherRetro.retroId },
      target: { kind: 'review' },
      text: 'elsewhere',
    })

    await expect(
      harness.app.threads.addComment.execute({
        actor: 'ai',
        retro: { retroId },
        target: { kind: 'thread', threadId: opened.thread.id },
        text: 'wrong review',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  test('is a NotFound for an unknown thread, record or retrospective', async () => {
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'ai',
        retro: { retroId },
        target: { kind: 'thread', threadId: 404 },
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'ai',
        retro: { retroId },
        target: { kind: 'record', rid: 'r-ghost', section: 'problem' },
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'ai',
        retro: { retroId: 404 },
        target: { kind: 'review' },
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  test('rejects an empty comment and an unknown section', async () => {
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: '   ',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        // biome-ignore lint/suspicious/noExplicitAny: an adapter could pass anything; the guard is the point.
        target: { kind: 'record', rid, section: 'impact' as any },
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('refuses comments on a finished review', async () => {
    await harness.decide(retroId, rid, 'approved')
    await harness.closeReview(retroId)

    await expect(
      harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: 'one more thing',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  /**
   * A comment shows the revision it is associated with, but shows across every
   * revision. The thread stays put across revisions — it is keyed on `(retroId,
   * rid, section)` — and each message says which draft it answers.
   */
  describe('the revision a comment was written against', () => {
    test('stamps the latest revision when the writer names none — the CLI’s path', async () => {
      const first = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'record', rid, section: 'problem' },
        text: 'Asked while revision 1 stood alone.',
      })
      expect(first.thread.messages.at(-1)?.revision).toBe(1)

      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid }])
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid }])
      const later = await harness.app.threads.addComment.execute({
        actor: 'ai',
        target: { kind: 'thread', threadId: first.thread.id },
        text: 'Answered once revision 3 was filed.',
      })

      // One thread, two revisions, and the thread still shows both messages.
      expect(later.thread.id).toBe(first.thread.id)
      expect(later.thread.messages.map((message) => message.revision)).toEqual([1, 3])
    })

    /**
     * A revision is announced and never swapped in, so the reviewer can still
     * be reading revision 1 while revision 3 exists — and what they write
     * belongs to what they were reading, not to what was newest.
     */
    test('stores the revision the writer names, even when a newer one exists', async () => {
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid }])
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid }])

      const { thread } = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: 'Written against the revision on screen, not the newest one.',
        revisionN: 2,
      })

      expect(thread.messages.at(-1)?.revision).toBe(2)
    })

    test('refuses a revision the retrospective does not have', async () => {
      for (const revisionN of [0, 2, -1, 1.5]) {
        await expect(
          harness.app.threads.addComment.execute({
            actor: 'human',
            retro: { retroId },
            target: { kind: 'review' },
            text: 'x',
            revisionN,
          }),
          `revision ${revisionN} was accepted`,
        ).rejects.toBeInstanceOf(ValidationError)
      }
    })

    /**
     * A comment written before `comments_add_revision` carries no stamp, and
     * never will — human data is never rewritten. The read view derives one from
     * the revision timestamps instead: the latest revision filed at or before
     * the moment the comment was written.
     */
    test('derives a revision for a comment written before the column existed', async () => {
      const { thread } = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: 'A message from an older store.',
      })
      harness.clock.advance(60 * 60 * 1000)
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid }])
      harness.clock.advance(60 * 60 * 1000)

      // Straight to the store, because no write path can produce an unstamped
      // comment any more — which is the whole point of the column.
      await harness.store.threads.addComment(thread.id, {
        threadId: thread.id,
        actor: 'ai',
        text: 'Written after revision 2 was filed, and never stamped.',
        at: harness.clock.iso(),
        revisionN: undefined,
      })

      const { threads } = await harness.app.threads.list.execute({
        actor: 'ai',
        retro: { retroId },
      })
      const messages = threads.find((candidate) => candidate.id === thread.id)?.messages

      expect(messages?.map((message) => message.revisionN)).toEqual([1, undefined])
      expect(messages?.map((message) => message.revision)).toEqual([1, 2])
    })
  })

  /**
   * `r-resolvable-comments`: only the human can mark a comment resolved, never
   * the AI.
   */
  describe('resolve', () => {
    async function aThread(): Promise<number> {
      const { thread } = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: 'Two of these records are the same complaint.',
      })
      return thread.id
    }

    test('a thread nobody marked is not resolved', async () => {
      const threadId = await aThread()

      const { threads } = await harness.app.threads.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(threads.find((thread) => thread.id === threadId)?.resolved).toBe(false)
    })

    test('the human marks it, and every read view says so', async () => {
      const threadId = await aThread()

      const { thread } = await harness.app.threads.resolve.execute({
        actor: 'human',
        threadId,
        resolved: true,
      })

      expect(thread.resolved).toBe(true)
      const { threads } = await harness.app.threads.list.execute({
        actor: 'ai',
        retro: { retroId },
      })
      expect(threads.find((candidate) => candidate.id === threadId)?.resolved).toBe(true)
      expect(await harness.eventNames()).toContain('ThreadResolved')
    })

    /** Reopening is a version, not an edit: what he did at 10:00 is still there. */
    test('reopening appends a version rather than erasing the one that stands', async () => {
      const threadId = await aThread()
      await harness.app.threads.resolve.execute({ actor: 'human', threadId, resolved: true })

      const { thread } = await harness.app.threads.resolve.execute({
        actor: 'human',
        threadId,
        resolved: false,
      })

      expect(thread.resolved).toBe(false)
      expect((await harness.store.threadResolutions.findLatest(threadId))?.version).toBe(2)
      expect(await harness.eventNames()).toContain('ThreadReopened')
    })

    test('the AI may answer a thread and may never settle one', async () => {
      const threadId = await aThread()

      await harness.app.threads.addComment.execute({
        actor: 'ai',
        target: { kind: 'thread', threadId },
        text: 'Two more are drafted; they did not clear the bar.',
      })

      await expect(
        harness.app.threads.resolve.execute({ actor: 'ai', threadId, resolved: true }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
      expect(await harness.store.threadResolutions.findLatest(threadId)).toBeUndefined()
    })

    test('is a NotFound for a thread that does not exist', async () => {
      await expect(
        harness.app.threads.resolve.execute({ actor: 'human', threadId: 404, resolved: true }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    test('refuses once the review is finished', async () => {
      const threadId = await aThread()
      await harness.decide(retroId, rid, 'approved')
      await harness.closeReview(retroId)

      await expect(
        harness.app.threads.resolve.execute({ actor: 'human', threadId, resolved: true }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  describe('list', () => {
    test('lists every thread, filters by record, and finds the unanswered ones', async () => {
      const waiting = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'record', rid, section: 'problem' },
        text: 'a question the AI has not answered',
      })
      const answered = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'record', rid, section: 'direction' },
        text: 'another question',
      })
      await harness.app.threads.addComment.execute({
        actor: 'ai',
        retro: { retroId },
        target: { kind: 'thread', threadId: answered.thread.id },
        text: 'answered',
      })

      expect(
        (await harness.app.threads.list.execute({ actor: 'ai', retro: { retroId } })).threads,
      ).toHaveLength(2)
      expect(
        (
          await harness.app.threads.list.execute({
            actor: 'ai',
            retro: { retroId },
            rid: 'r-other',
          })
        ).threads,
      ).toEqual([])
      expect(
        (
          await harness.app.threads.list.execute({
            actor: 'ai',
            retro: { retroId },
            unansweredOnly: true,
          })
        ).threads.map((thread) => thread.id),
      ).toEqual([waiting.thread.id])
    })

    test('is a NotFound for an unknown retrospective', async () => {
      await expect(
        harness.app.threads.list.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
