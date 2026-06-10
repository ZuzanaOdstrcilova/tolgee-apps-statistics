/**
 * Single source of truth for "was this translation change produced by AI?".
 * Used by both the webhook store (live per-cell origin for the tools panel)
 * and the match pipeline (history-revision classification), so the rule can't
 * drift between the two.
 */

export const isTruthy = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && v !== ''

type AiMods =
  | {
      auto?: { new?: unknown }
      mtProvider?: { new?: unknown }
      promptId?: { new?: unknown }
    }
  | null
  | undefined

/** AI if the change flips `auto` on, names an MT provider, or carries a prompt
 *  id (Tolgee AI = `mtProvider: "PROMPT"`). */
export const isAiModification = (m: AiMods): boolean =>
  !!m && (m.auto?.new === true || isTruthy(m.mtProvider?.new) || isTruthy(m.promptId?.new))
