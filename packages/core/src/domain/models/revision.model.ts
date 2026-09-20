import type { RetroRecord } from '#domain/models/record.model'

/**
 * The AI's immutable numbered draft of a retrospective's records. `n` starts at 1
 * per retrospective. There is no update path anywhere in the system — feedback
 * produces revision n+1, never an edit (data-model.md §Revision).
 */
export type Revision = {
  readonly id: number
  readonly retroId: number
  readonly n: number
  readonly createdAt: string
  /**
   * The retrospective's plain-language name, as this draft proposed it — AI
   * authored, optional, at most 80 characters. Each revision carries its own,
   * and the latest one is the retrospective's: a title is part of the draft, so
   * a redraft is how it changes, like everything else here.
   */
  readonly title: string | undefined
  /** Embedded, ordered by `num`. */
  readonly records: readonly RetroRecord[]
}

export type NewRevision = Omit<Revision, 'id'>
