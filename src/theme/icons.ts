// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for icon sizing.
//
// Every icon dimension in the app (flags, inline SVG action icons) comes from
// this scale. Pick a tier by role; don't hardcode pixel sizes on icons.
// ─────────────────────────────────────────────────────────────────────────────

export const ICON = {
  /** Inline with body text — table-row flags, card action icons. */
  sm: 16,
  /** Emphasised / header icons — panel headers, list rows. */
  md: 20,
  /** Standalone or prominent icons. */
  lg: 24,
} as const

export type IconSize = keyof typeof ICON
