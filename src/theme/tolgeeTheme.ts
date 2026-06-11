import { createTheme, type Theme } from '@mui/material/styles'
import { applyTolgeeTheme, type TolgeeAppTheme } from '@tolgee/apps-sdk/browser'
import { FONT } from './typography'

const IN_IFRAME = typeof window !== 'undefined' && window.parent !== window

/**
 * Apply the host palette, but keep the iframe background TRANSPARENT.
 *
 * `applyTolgeeTheme` sets `color-scheme: dark` on <html>, which makes the
 * browser paint an OPAQUE dark backdrop across the whole iframe — that's the
 * stray dark panel behind our content in dark mode, defeating the transparent
 * body that should let the host background show through. Our MUI theme and the
 * `--tg-color-*` tokens already style every surface for the mode, so we don't
 * need the UA's dark canvas: reset `color-scheme` inside the iframe. Standalone
 * keeps it (its root paints an explicit canvas, so there's no see-through).
 */
export function applyHostTheme(theme: TolgeeAppTheme): void {
  applyTolgeeTheme(theme)
  if (IN_IFRAME) document.documentElement.style.colorScheme = 'normal'
}

// MUI theme mirroring Tolgee's real palette and component styling
// (tolgee-platform: webapp/src/colors.tsx + ThemeProvider.tsx), so our MUI
// components match what Tolgee renders. Tolgee uses MUI too, so this is a
// faithful — not approximate — match.

type Mode = 'light' | 'dark'

const PALETTE = {
  light: {
    primary: '#ec407a',
    primaryDark: '#d81b5f',
    secondary: '#2b5582',
    text: '#4e5967',
    textSecondary: '#808080',
    divider: '#e1e5eb',
    bgDefault: '#fdfdff',
    bgPaper: '#ffffff',
    inset: '#f7f8fb',
    info: '#009b85',
    tooltipBg: '#ffffff',
    tooltipText: '#111111',
  },
  dark: {
    primary: '#ff6995',
    primaryDark: '#ff6995',
    secondary: '#aed5ff',
    text: '#dddddd',
    textSecondary: '#acacac',
    divider: '#2c3c52',
    bgDefault: '#1f2d40',
    bgPaper: '#1e2b3e',
    inset: '#233043',
    info: '#6db2a4',
    tooltipBg: '#394556',
    tooltipText: '#efefef',
  },
} as const

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'

export function buildTolgeeTheme(mode: Mode): Theme {
  const p = PALETTE[mode]
  return createTheme({
    palette: {
      mode,
      primary: { main: p.primary, dark: p.primaryDark, contrastText: '#ffffff' },
      secondary: { main: p.secondary },
      info: { main: p.info },
      text: { primary: p.text, secondary: p.textSecondary },
      divider: p.divider,
      background: { default: p.bgDefault, paper: p.bgPaper },
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: FONT_STACK,
      htmlFontSize: 15,
      // Shared roles from the FONT scale (src/theme/typography.ts) so MUI
      // <Typography> and the inline data-viz views agree. Other MUI variants
      // keep their default scale (only the dev showcase renders them).
      button: { ...FONT.body, fontWeight: 500 },
      caption: { ...FONT.caption },
    },
    components: {
      // Tolgee's MuiButton override: square-ish 3px radius, 40px tall.
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 3, padding: '6px 16px', minHeight: 40 },
          sizeSmall: { minHeight: 30, padding: '4px 10px', fontSize: 13 },
        },
      },
      // Inputs sit on the paper colour with a divider-coloured outline.
      MuiOutlinedInput: {
        styleOverrides: {
          root: { backgroundColor: p.bgPaper },
          notchedOutline: { borderColor: p.divider },
        },
      },
      // Tolgee's tooltip: light surface, dark text, soft shadow, 11px radius.
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: 12,
            boxShadow: '1px 1px 6px rgba(0, 0, 0, 0.25)',
            borderRadius: 11,
            color: p.tooltipText,
            backgroundColor: p.tooltipBg,
          },
          arrow: { color: p.tooltipBg },
        },
      },
      // Pink-tinted selected/hover rows, like Tolgee's menus.
      MuiMenuItem: {
        styleOverrides: {
          root: {
            '&.Mui-selected': { backgroundColor: `${p.primary}14` },
            '&.Mui-selected:hover': { backgroundColor: `${p.primary}22` },
          },
        },
      },
    },
  })
}

/**
 * The theme the Tolgee host would post for a given mode, mirrored from our
 * PALETTE. Used only by the STANDALONE preview so it drives the SAME
 * `applyTolgeeTheme` / `--tg-color-*` path as the real iframe (instead of only
 * the fallback hex), making dark/light faithfully previewable + verifiable.
 */
export const tolgeeHostTheme = (mode: Mode): TolgeeAppTheme => {
  const p = PALETTE[mode]
  return {
    mode,
    colors: {
      background: p.bgDefault,
      backgroundPaper: p.bgPaper,
      text: p.text,
      textSecondary: p.textSecondary,
      primary: p.primary,
      primaryContrast: '#ffffff',
      divider: p.divider,
      error: mode === 'dark' ? '#ff6f6a' : '#e6453f',
    },
  }
}
