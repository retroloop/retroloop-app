import type { ThreadView } from '@retro/core'

/**
 * The `--json` projections shared by more than one command.
 *
 * A comment thread is printed identically by `comment list` and by
 * `revision get` — writing the shape once is what stops the two from drifting
 * into "nearly the same" for a caller parsing both. `undefined` becomes `null`
 * here rather than vanishing: a key that comes and goes is a shape a script has
 * to guess at (cli.md §Conventions).
 *
 * There was a `requestJson` beside it, printed by `request list` and by
 * `revision get`. Both callers are gone (retro 4 `r-remove-requests`) and so is
 * it: an ask is a review-level comment now, and comes back through `threadJson`
 * like every other one.
 *
 * It takes a `ThreadView` rather than a `CommentThread` because two of the keys
 * below are read models rather than columns: `revision` is stored or derived
 * (`thread.view.ts`), and `resolved` is the latest resolution version's value.
 * Taking the domain row instead would mean each of the three CLI read paths
 * deriving them again, which is how one definition becomes three.
 *
 * **`resolved` is read-only here, and there is no flag anywhere in the CLI that
 * writes it.** The CLI writes as the AI and only as the AI, and
 * `ResolveThreadUseCase` refuses that actor before it looks at anything —
 * *"only the human should be able to mark it, not the AI"* (`r-resolvable-comments`).
 * What the AI gets is the ability to see which asks the human has already
 * settled, which is exactly what it needs when drafting the next revision.
 */
export function threadJson(thread: ThreadView) {
  return {
    threadId: thread.id,
    rid: thread.rid ?? null,
    section: thread.section ?? null,
    openedAt: thread.openedAt,
    resolved: thread.resolved,
    messages: thread.messages.map((message) => ({
      commentId: message.id,
      actor: message.actor,
      text: message.text,
      at: message.at,
      revision: message.revision,
    })),
  }
}
