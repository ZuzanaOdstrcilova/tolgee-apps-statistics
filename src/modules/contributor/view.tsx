import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { Popover, Tooltip as MuiTooltip } from '@mui/material'
import { Flag } from '../../lib/flag'
import { ICON } from '../../theme/icons'
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import { createTolgeeApp } from '@tolgee/apps-sdk/browser'
import { applyHostTheme, buildTolgeeTheme, tolgeeHostTheme } from '../../theme/tolgeeTheme'
import { FONT, SANS } from '../../theme/typography'
import {
  AVATAR_COLOR,
  BADGES,
  MIX_META,
  TIER_META,
  closestBadge,
  type BadgeKey,
  type Mix,
  type ScoredMember,
  type Tier,
} from './data'

// Shared visual layer for the contributor dashboard + panel. Built on the same
// tokens as the rest of the app: --s-* chrome (light/dark via App.css), FONT /
// SANS, and recharts for the trust ring. Mix / tier colours are data-viz
// constants from data.ts (they read on both light and dark).

export const C = {
  text: 'var(--s-text)',
  dim: 'var(--s-dim)',
  faint: 'var(--s-faint)',
  line: 'var(--s-line)',
  lineSoft: 'var(--s-line-soft)',
  surface: 'var(--s-surface)',
  canvas: 'var(--s-canvas)',
  track: 'var(--s-track)',
  accent: 'var(--s-accent)',
} as const

const STANDALONE = window.parent === window

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({
  initials,
  avatarUrl,
  size = 38,
}: {
  initials: string
  avatarUrl?: string
  size?: number
}) {
  // Show the Tolgee user photo when present; fall back to initials (also on a
  // failed image load).
  const [failed, setFailed] = useState(false)
  const showImg = !!avatarUrl && !failed
  return (
    <span
      style={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        background: AVATAR_COLOR,
        color: '#fff',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...FONT.label,
        fontWeight: 600,
        fontSize: Math.round(size * 0.34),
        letterSpacing: '0.02em',
      }}
    >
      {showImg ? (
        <img
          src={avatarUrl}
          alt=""
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            display: 'block',
          }}
        />
      ) : (
        initials
      )}
    </span>
  )
}

// ── Member avatar with a click-to-open detail card ───────────────────────────
/** Clickable avatar → a popover with a bigger photo, name, mailto email,
 *  language flags and badges. */
export function MemberAvatar({ member, size = 38 }: { member: ScoredMember; size?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={`Open ${member.name}`}
        style={{
          appearance: 'none',
          border: 'none',
          background: 'none',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          borderRadius: '50%',
          lineHeight: 0,
          flex: 'none',
        }}
      >
        <Avatar initials={member.initials} avatarUrl={member.avatarUrl} size={size} />
      </button>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { style: { borderRadius: 14, background: C.surface, overflow: 'visible' } } }}
      >
        <MemberCard member={member} />
      </Popover>
    </>
  )
}

function MemberCard({ member }: { member: ScoredMember }) {
  return (
    <div style={{ width: 260, padding: 20, color: C.text, fontFamily: SANS }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Avatar initials={member.initials} avatarUrl={member.avatarUrl} size={88} />
      </div>
      <div style={{ ...FONT.subtitle, color: C.text, textAlign: 'center', marginTop: 12 }}>
        {member.name}
      </div>
      {member.email && (
        <a
          href={`mailto:${member.email}`}
          style={{ ...FONT.caption, color: C.accent, textAlign: 'center', display: 'block', marginTop: 3, textDecoration: 'none' }}
        >
          {member.email}
        </a>
      )}

      {member.langs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', margin: '16px 0' }}>
          {member.langs.map((tag) => {
            const emoji = member.langFlags?.[tag]
            return emoji ? (
              <Flag key={tag} emoji={emoji} size={ICON.md} />
            ) : (
              <span
                key={tag}
                style={{
                  ...FONT.nano,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: C.dim,
                  background: C.lineSoft,
                  border: `1px solid ${C.line}`,
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                {tag}
              </span>
            )
          })}
        </div>
      )}

      {member.badges.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 9,
            justifyContent: 'center',
            borderTop: `1px solid ${C.line}`,
            paddingTop: 16,
          }}
        >
          {member.badges.map((b) => (
            <BadgeIcon key={b} badge={b} earned size={36} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tier tag ────────────────────────────────────────────────────────────────
export function TierTag({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 10px',
        borderRadius: 999,
        background: meta.color,
        color: '#fff',
        ...FONT.micro,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {meta.label}
    </span>
  )
}

// ── Contribution mix: horizontal stacked bar + legend ─────────────────────────
export function MixBar({ mix, height = 10 }: { mix: Mix; height?: number }) {
  const segs = MIX_META.map((m) => ({ ...m, value: mix[m.key] })).filter((s) => s.value > 0)
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div style={{ display: 'flex', height, gap: 1.5, width: '100%' }}>
      {segs.map((s, i) => {
        const first = i === 0
        const last = i === segs.length - 1
        return (
          <MuiTooltip key={s.key} arrow title={`${s.label} ${Math.round((s.value / total) * 100)}%`}>
            <div
              style={{
                flexGrow: s.value,
                flexBasis: 0,
                minWidth: 3,
                background: s.color,
                borderTopLeftRadius: first ? 5 : 0,
                borderBottomLeftRadius: first ? 5 : 0,
                borderTopRightRadius: last ? 5 : 0,
                borderBottomRightRadius: last ? 5 : 0,
              }}
            />
          </MuiTooltip>
        )
      })}
    </div>
  )
}

/** Mix legend — `withPct` shows each share next to its label (panel). */
export function MixLegend({ mix, withPct = false }: { mix?: Mix; withPct?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
      {MIX_META.map((m) => (
        <span
          key={m.key}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...FONT.micro, color: C.dim }}
        >
          <span
            style={{ width: 9, height: 9, borderRadius: 2, background: m.color, display: 'inline-block' }}
          />
          {m.label}
          {withPct && mix ? ` ${mix[m.key]}%` : ''}
        </span>
      ))}
    </div>
  )
}

// ── Thin labelled meter (clean rate, survival) ────────────────────────────────
export function MeterBar({ value, color = C.accent }: { value: number; color?: string }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: C.track, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: '100%',
          borderRadius: 999,
          background: color,
        }}
      />
    </div>
  )
}

// ── Trust ring (radial progress with the score in the centre) ─────────────────
export function TrustRing({
  trust,
  size = 132,
  preliminary = false,
}: {
  trust: number
  size?: number
  preliminary?: boolean
}) {
  const color = TIER_META[trust >= 85 ? 'core' : trust >= 65 ? 'trusted' : 'new'].color
  const data = [{ name: 'trust', value: trust, fill: color }]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <RadialBarChart
          width={size}
          height={size}
          innerRadius="80%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: C.track }} dataKey="value" cornerRadius={20} />
        </RadialBarChart>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            ...FONT.display,
            fontSize: Math.round(size * 0.3),
            color: C.text,
          }}
        >
          {trust}
        </div>
      </div>
      <div style={{ ...FONT.micro, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Trust score
      </div>
      {preliminary && <PreliminaryTag />}
    </div>
  )
}

/** Trust score is provisional (sample too small) — shown anywhere trust appears. */
export function PreliminaryTag() {
  return (
    <MuiTooltip arrow title="Too few strings yet — trust is provisional and will firm up with more work.">
      <span style={{ ...FONT.nano, color: C.faint, fontStyle: 'italic', cursor: 'help' }}>
        preliminary
      </span>
    </MuiTooltip>
  )
}

/** Trust score as a magenta-on-light pill (the leaderboard cell). */
/** Trust score → band colour, mirroring the AI match-score palette:
 *  ≥90 green · 80–89 teal · 70–79 light blue · <70 light pink. */
export const trustColor = (trust: number): string =>
  trust >= 90 ? '#00C86C' : trust >= 80 ? '#5CD6B0' : trust >= 70 ? '#4FC3F7' : '#FF7A8F'

// Darker, more saturated band colours for TEXT — the pill's tinted background
// keeps the soft band hue, but the number reads with proper contrast (the pale
// teal/light-blue were washed out as text).
const trustTextColor = (trust: number): string =>
  trust >= 90 ? '#0a8f4f' : trust >= 80 ? '#0e8a76' : trust >= 70 ? '#1565c0' : '#c2185b'

export function TrustPill({ trust }: { trust: number }) {
  const color = trustColor(trust)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        color: trustTextColor(trust),
        ...FONT.micro,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      Trust: {trust}
    </span>
  )
}

// ── Badges ────────────────────────────────────────────────────────────────────
export function BadgeIcon({
  badge,
  earned,
  size = 40,
}: {
  badge: BadgeKey
  earned: boolean
  size?: number
}) {
  const meta = BADGES[badge]
  const c = meta.color
  return (
    <MuiTooltip arrow title={`${meta.label} — ${meta.note}`}>
      <span
        style={{
          width: size,
          height: size,
          flex: 'none',
          borderRadius: '50%',
          border: `1.5px solid ${earned ? c : C.line}`,
          background: earned ? `color-mix(in srgb, ${c} 16%, transparent)` : 'transparent',
          boxShadow: earned ? `0 1px 4px color-mix(in srgb, ${c} 28%, transparent)` : 'none',
          opacity: earned ? 1 : 0.4,
          filter: earned ? 'none' : 'grayscale(1)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.round(size * 0.5),
          lineHeight: 1,
          cursor: 'help',
        }}
      >
        {meta.glyph}
      </span>
    </MuiTooltip>
  )
}

/** First three earned badges, as compact glyphs (leaderboard cell). */
export function BadgeRow({ badges }: { badges: BadgeKey[] }) {
  if (badges.length === 0) return <span style={{ color: C.faint }}>—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 7 }}>
      {badges.slice(0, 3).map((b) => (
        <BadgeIcon key={b} badge={b} earned size={32} />
      ))}
    </span>
  )
}

/** Full badge grid with an earned/total header, then the closest-badge nudge. */
export function BadgePanel({ member }: { member: ScoredMember }) {
  const earned = new Set(member.badges)
  const all = Object.keys(BADGES) as BadgeKey[]
  const closest = closestBadge(member)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...FONT.micro, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Badges
        </span>
        <span style={{ ...FONT.micro, color: C.faint }}>
          {earned.size}/{all.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {all.map((b) => (
          <span key={b} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 56 }}>
            <BadgeIcon badge={b} earned={earned.has(b)} />
            <span
              style={{
                ...FONT.nano,
                color: earned.has(b) ? C.dim : C.faint,
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {BADGES[b].label}
            </span>
          </span>
        ))}
      </div>
      {closest && (
        <div style={{ background: C.lineSoft, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ ...FONT.nano, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Closest badge
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 8px' }}>
            <BadgeIcon badge={closest.key} earned={false} size={26} />
            <span style={{ ...FONT.label, color: C.text }}>{BADGES[closest.key].label}</span>
          </div>
          <MeterBar value={closest.progress} />
          <div style={{ ...FONT.micro, color: C.dim, marginTop: 6 }}>
            {closest.progress}% there · {closest.nudge}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Segmented control (range / activity / tier / rank filters) ────────────────
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            style={{
              appearance: 'none',
              cursor: 'pointer',
              ...FONT.micro,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 999,
              border: `1px solid ${on ? C.accent : C.line}`,
              background: on ? 'color-mix(in srgb, var(--s-accent) 10%, transparent)' : 'transparent',
              color: on ? C.accent : C.dim,
              fontFamily: SANS,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A labelled filter row: small grey label above a segmented control. */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ ...FONT.micro, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.5px', width: 96, flex: 'none' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

/** "Sample data" chip — flags that the numbers are mock until the backend lands. */
export function SampleDataChip() {
  return (
    <MuiTooltip
      arrow
      title="Sample data. Contributor metrics need per-string activity & QA signals from the backend (not wired yet)."
    >
      <span
        style={{
          ...FONT.micro,
          fontWeight: 500,
          color: C.dim,
          background: C.lineSoft,
          padding: '3px 9px',
          borderRadius: 999,
          cursor: 'help',
        }}
      >
        Sample data
      </span>
    </MuiTooltip>
  )
}

// ── Loading / empty states (real backend; no mock fallback) ──────────────────
const skel = (style: CSSProperties) => <div className="s-skel" style={style} aria-hidden />

/** Shimmer placeholder for the contributor leaderboard while it loads. */
export function ContributorSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 8px' }}>
      {skel({ width: 180, height: 28, borderRadius: 8, marginBottom: 18 })}
      {skel({ height: 96, borderRadius: 14, marginBottom: 18 })}
      <div style={{ ...cardStyle, padding: '14px 16px' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '20px 8px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
            }}
          >
            {skel({ width: 52, height: 52, borderRadius: '50%', flex: 'none' })}
            {skel({ height: 14, borderRadius: 6, flex: 1 })}
            {skel({ width: 80, height: 14, borderRadius: 6 })}
            {skel({ width: 48, height: 24, borderRadius: 999 })}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Shimmer placeholder for the contributor panel while it loads. */
export function ContributorPanelSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 420 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        {skel({ width: 40, height: 40, borderRadius: '50%' })}
        {skel({ width: 120, height: 16, borderRadius: 6 })}
      </div>
      {skel({ width: 132, height: 132, borderRadius: '50%', margin: '0 auto' })}
      {skel({ height: 12, borderRadius: 6 })}
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {skel({ width: 160, height: 12, borderRadius: 6 })}
          {skel({ height: 6, borderRadius: 999 })}
        </div>
      ))}
    </div>
  )
}

/** Empty/error state — shown when the backend returns no contributors. */
export function ContributorEmpty({ message, panel = false }: { message?: string; panel?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        textAlign: 'center',
        padding: panel ? '40px 20px' : '72px 24px',
        color: C.faint,
      }}
    >
      <span style={{ ...FONT.subtitle, color: C.dim }}>No contributor data yet</span>
      <span style={{ ...FONT.caption, color: C.faint, maxWidth: 420 }}>
        {message ?? 'Contributor stats appear once there is translation activity in this project.'}
      </span>
    </div>
  )
}

// ── Theme host for the real Tolgee module entries (/contributor*) ─────────────
// Mirrors the dashboard/panel chrome: follow the host theme in the iframe (OS
// when standalone) and keep the iframe sized to content. Wide vs narrow only
// changes the standalone fallback background; the content sets its own width.
export function ThemeHost({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Inside the Tolgee iframe, default to LIGHT and follow ONLY the host theme
  // (via onThemeChanged below) — never the OS, or a dark-mode OS would paint our
  // cards dark over a light host. Standalone preview follows the OS.
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    STANDALONE && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )

  // Standalone preview follows the OS; the iframe follows the host (below).
  useEffect(() => {
    if (!STANDALONE) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = mode
    if (STANDALONE) applyHostTheme(tolgeeHostTheme(mode))
  }, [mode])

  // Inside Tolgee: track the host theme and resize the iframe to our content.
  useEffect(() => {
    if (STANDALONE) return
    const app = createTolgeeApp()
    const offTheme = app.onThemeChanged((t) => {
      if (!t) return
      applyHostTheme(t)
      setMode(t.mode)
    })
    const el = ref.current
    const observer = el ? new ResizeObserver(() => app.resize(el.scrollHeight)) : null
    if (el && observer) observer.observe(el)
    return () => {
      offTheme()
      observer?.disconnect()
      app.dispose()
    }
  }, [])

  const theme = useMemo(() => buildTolgeeTheme(mode), [mode])
  return (
    <ThemeProvider theme={theme}>
      <div
        ref={ref}
        style={{
          background: STANDALONE ? C.canvas : 'transparent',
          minHeight: STANDALONE ? '100vh' : undefined,
          fontFamily: SANS,
          color: C.text,
        }}
      >
        {children}
      </div>
    </ThemeProvider>
  )
}

// Shared card style for both views.
export const cardStyle: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  boxShadow: '0 1px 3px rgba(20,30,50,0.04)',
}
