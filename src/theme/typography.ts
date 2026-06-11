import type { CSSProperties } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for app typography.
//
// Every text size/weight in the app comes from `FONT` below — both the MUI
// `<Typography>` variants (wired up in tolgeeTheme.ts) and the inline-styled
// data-viz views (dashboard + panel, which render raw HTML/SVG rather than MUI).
// Change a role here and it applies everywhere; don't hardcode `fontSize` in
// components.
// ─────────────────────────────────────────────────────────────────────────────

/** Font family for the inline-styled views (Inter-first, Tolgee's webapp font). */
export const SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

type Role = {
  fontSize: number
  fontWeight: number
}

/**
 * Semantic type scale. Roles, not pixel buckets — pick by meaning and the size
 * follows. Near-duplicate sizes from the old code (11.5 / 12.5 / 13.5 …) are
 * collapsed into these. Override `color` / `lineHeight` / `fontWeight` per call
 * site after spreading, e.g. `{ ...FONT.micro, fontWeight: 600, color: COL.dim }`.
 */
export const FONT = {
  /** Hero stat numbers — donut centre, gauges, big scores. */
  display: { fontSize: 22, fontWeight: 700 },
  /** Light page heading (h1). */
  pageTitle: { fontSize: 24, fontWeight: 400 },
  /** Section titles, breadcrumb, logo. */
  title: { fontSize: 16, fontWeight: 600 },
  /** Block / card titles, language header. */
  subtitle: { fontSize: 15, fontWeight: 600 },
  /** Tabs and default body copy. */
  body: { fontSize: 14, fontWeight: 400 },
  /** Emphasized small labels (card names, legend). */
  label: { fontSize: 13, fontWeight: 600 },
  /** Small text & secondary descriptions. */
  caption: { fontSize: 13, fontWeight: 400 },
  /** Tiny labels, status lines, gauge captions. */
  micro: { fontSize: 12, fontWeight: 400 },
  /** Cramped sublabels (donut centre caption). */
  nano: { fontSize: 10, fontWeight: 400 },
} as const satisfies Record<string, Role>

export type FontRole = keyof typeof FONT

/** Spread helper with an explicit weight override, typed as CSSProperties. */
export const font = (role: FontRole, fontWeight?: number): CSSProperties =>
  fontWeight === undefined ? { ...FONT[role] } : { ...FONT[role], fontWeight }
