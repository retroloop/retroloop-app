/**
 * The two writers in the system. The CLI always acts as `ai`; the browser always
 * acts as `human` (architecture.md §Actor model). Every use case takes one, and
 * human-owned writes refuse `ai` — and vice versa where the mutability matrix
 * (data-model.md §Mutability matrix) names the AI as the author.
 */
export type Actor = 'ai' | 'human'
