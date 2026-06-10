// Render a language flag the same way Tolgee does — as a Twemoji SVG image
// (consistent across platforms), not the OS emoji glyph. Tolgee stores a
// `flagEmoji` per language; we convert it to the matching Twemoji asset.

/** Emoji → Twemoji SVG URL (e.g. "🇩🇪" → ".../1f1e9-1f1ea.svg"). */
export const twemojiUrl = (emoji: string): string => {
  const cps = [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((h) => h !== 'fe0f') // drop the variation selector
    .join('-')
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${cps}.svg`
}

export function Flag({ emoji, size = 16 }: { emoji: string; size?: number }) {
  if (!emoji) return null
  return (
    <img
      src={twemojiUrl(emoji)}
      alt={emoji}
      height={size}
      loading="lazy"
      style={{ flex: 'none', verticalAlign: 'middle' }}
    />
  )
}
