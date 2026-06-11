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
      auto?: { old?: unknown; new?: unknown }
      mtProvider?: { old?: unknown; new?: unknown }
      promptId?: { old?: unknown; new?: unknown }
    }
  | null
  | undefined

/** AI if the change flips `auto` on, names an MT provider, or carries a prompt
 *  id (Tolgee AI = `mtProvider: "PROMPT"`). */
export const isAiModification = (m: AiMods): boolean =>
  !!m && (m.auto?.new === true || isTruthy(m.mtProvider?.new) || isTruthy(m.promptId?.new))

/**
 * Was the text AI-produced BEFORE this (human) edit? When someone post-edits an
 * AI translation, Tolgee flips the AI markers off — so the `old` side carries
 * them: `auto: {old: true}`, `mtProvider: {old: "PROMPT"}`. This catches
 * post-edits even when the original AI write came from a batch job that the
 * activity log doesn't expand per-translation.
 */
export const wasAiBeforeModification = (m: AiMods): boolean =>
  !!m && (m.auto?.old === true || isTruthy(m.mtProvider?.old) || isTruthy(m.promptId?.old))
