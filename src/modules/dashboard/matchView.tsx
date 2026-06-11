import type { CSSProperties } from 'react'
import { FormControl, MenuItem, Select, Tooltip as MuiTooltip } from '@mui/material'
import { Flag } from '../../lib/flag'
import { RANGE_LABELS } from './matchData'
import {
  PieChart,
  Pie,
  Cell,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts'
import type { BucketKey, MatchTotals } from './matchData'

// Shared match-score visual layer, reused by BOTH the dashboard tab and the
// translation tools panel. Owns the colour palette, the metric styles, the
// data-viz helpers, and the chart components (donut, gauges, legend, tips).

export const COL = {
  // Match-score data-viz palette — constant across light/dark (reads on both).
  c100: '#00C86C',
  c9990: '#5CD6B0',
  c8980: '#4FC3F7',
  c7970: '#1E88E5',
  cno: '#FF7A8F',
  // Chrome + accent — Tolgee's real palette via CSS variables (App.css).
  accent: 'var(--s-accent)',
  notReviewed: 'var(--s-not-reviewed)',
  text: 'var(--s-text)',
  dim: 'var(--s-dim)',
  faint: 'var(--s-faint)',
  line: 'var(--s-line)',
  lineSoft: 'var(--s-line-soft)',
  surface: 'var(--s-surface)',
  track: 'var(--s-track)',
  tipBg: 'var(--s-tip-bg)',
  tipText: 'var(--s-tip-text)',
} as const

export const SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

export type Bucket = { key: string; label: string; color: string }
export const BUCKETS: Bucket[] = [
  { key: 'b100', label: '100% Match', color: COL.c100 },
  { key: 'b9990', label: 'Match score 99-90%', color: COL.c9990 },
  { key: 'b8980', label: 'Match score 89-80%', color: COL.c8980 },
  { key: 'b7970', label: 'Match score 79-70%', color: COL.c7970 },
  { key: 'bno', label: 'Less than 70%', color: COL.cno },
  { key: 'notReviewed', label: 'Not reviewed', color: COL.notReviewed },
]

export type DonutSlice = {
  name: string
  value: number
  color: string
  keys: number
  langs: number
}

// Mock donut for the standalone preview (dashboard + panel tab).
export const DONUT: DonutSlice[] = [
  { name: '100% Match', value: 301, color: COL.c100, keys: 142, langs: 4 },
  { name: '99-90%', value: 276, color: COL.c9990, keys: 121, langs: 4 },
  { name: '89-80%', value: 126, color: COL.c8980, keys: 58, langs: 3 },
  { name: '79-70%', value: 75, color: COL.c7970, keys: 33, langs: 3 },
  { name: 'Less than 70%', value: 478, color: COL.cno, keys: 167, langs: 4 },
]
export const DONUT_TOTAL = DONUT.reduce((s, d) => s + d.value, 0)
export const DONUT_KEYS = DONUT.reduce((s, d) => s + d.keys, 0)

const DONUT_META: { key: BucketKey; name: string; color: string }[] = [
  { key: 'b100', name: '100% Match', color: COL.c100 },
  { key: 'b9990', name: '99-90%', color: COL.c9990 },
  { key: 'b8980', name: '89-80%', color: COL.c8980 },
  { key: 'b7970', name: '79-70%', color: COL.c7970 },
  { key: 'bno', name: 'Less than 70%', color: COL.cno },
]

/** Real /api/match totals → donut slices. */
export const toDonut = (t: MatchTotals): DonutSlice[] =>
  DONUT_META.map((d) => {
    const agg = t.buckets[d.key]
    return { name: d.name, value: agg.words, color: d.color, keys: agg.keys, langs: agg.langs }
  })

export const abbr = (n: number): string =>
  n >= 1e6
    ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M'
    : n >= 1e3
      ? (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'k'
      : '' + n

export const scoreColor = (pct: number): string =>
  pct >= 90 ? COL.c100 : pct >= 80 ? COL.c8980 : pct >= 70 ? COL.c7970 : COL.cno

export const avgFromBuckets = (c: {
  b100: number
  b9990: number
  b8980: number
  b7970: number
  bno: number
}): number => {
  const w = c.b100 + c.b9990 + c.b8980 + c.b7970 + c.bno
  if (!w) return 0
  return Math.round(
    (100 * c.b100 + 95 * c.b9990 + 85 * c.b8980 + 75 * c.b7970 + 55 * c.bno) / w
  )
}

const lighten = (hex: string, amt: number): string => {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(c + (255 - c) * amt)
  )
  return `#${((1 << 24) + (ch[0] << 16) + (ch[1] << 8) + ch[2]).toString(16).slice(1)}`
}

/** SVG <defs> of light→base gradients, one per hex colour. */
export function ColorGradients({
  prefix,
  items,
  direction = 'vertical',
}: {
  prefix: string
  items: { key: string; color: string }[]
  direction?: 'vertical' | 'horizontal'
}) {
  const coords =
    direction === 'horizontal'
      ? { x1: '1', y1: '0', x2: '0', y2: '0' }
      : { x1: '0', y1: '0', x2: '0', y2: '1' }
  return (
    <defs>
      {items
        .filter((it) => it.color.startsWith('#'))
        .map((it) => (
          <linearGradient key={it.key} id={`${prefix}-${it.key}`} {...coords}>
            <stop offset="0%" stopColor={lighten(it.color, 0.32)} />
            <stop offset="100%" stopColor={it.color} />
          </linearGradient>
        ))}
    </defs>
  )
}
export const gradFill = (prefix: string, key: string, color: string): string =>
  color.startsWith('#') ? `url(#${prefix}-${key})` : color

// Metric styles shared by the dashboard + panel.
export const M: Record<string, CSSProperties> = {
  metricCard: {
    background: COL.lineSoft,
    borderRadius: 12,
    padding: '18px 16px',
    display: 'flex',
    alignItems: 'center',
  },
  gaugeCard: {
    background: COL.lineSoft,
    borderRadius: 12,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gaugeCenter: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    fontSize: 22,
    fontWeight: 650,
    color: COL.text,
  },
  gaugeLabel: { fontSize: 12, color: COL.dim },
  donutCenter: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    pointerEvents: 'none',
  },
  donutCenterV: { fontSize: 22, fontWeight: 650, color: COL.text, lineHeight: 1 },
  donutCenterL: { fontSize: 10, color: COL.faint, marginTop: 3 },
  donutLegend: { display: 'flex', flexDirection: 'column', gap: 9 },
  lg: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COL.dim },
  dot: { width: 9, height: 9, borderRadius: '50%', flex: 'none', display: 'inline-block' },
  tips: {
    background: COL.surface,
    border: `1px solid ${COL.line}`,
    borderRadius: 12,
    padding: '20px 24px',
  },
  tipsHead: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 },
  tipsTitle: { color: COL.text, fontSize: 15, fontWeight: 600 },
  tipsHint: { color: COL.dim, fontSize: 12.5 },
  tipCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 16px',
    border: `1px solid ${COL.line}`,
    borderRadius: 10,
    background: COL.lineSoft,
    textDecoration: 'none',
  },
  tipHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tipName: { color: COL.accent, fontSize: 13.5, fontWeight: 600 },
  tipDesc: { color: COL.dim, fontSize: 12.5, lineHeight: 1.4 },
  tipStat: {
    color: COL.faint,
    fontSize: 11.5,
    fontWeight: 500,
    marginTop: 6,
    paddingTop: 8,
    borderTop: `1px solid ${COL.line}`,
  },
}

export function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
  const data = [{ name: label, value, fill: color }]
  return (
    <div style={M.gaugeCard}>
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <RadialBarChart
          width={140}
          height={140}
          innerRadius="78%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: COL.track }} dataKey="value" cornerRadius={20} />
        </RadialBarChart>
        <div style={M.gaugeCenter}>{value}%</div>
      </div>
      <div style={M.gaugeLabel}>{label}</div>
    </div>
  )
}

// Project-wide totals tooltip (hovering anywhere on the donut, incl. center).
function DonutTotals({
  totalWords,
  totalKeys,
  langCount,
}: {
  totalWords: number
  totalKeys: number
  langCount: number
}) {
  const rows: [string, string][] = [
    ['Words', totalWords.toLocaleString('en-US')],
    ['Keys', totalKeys.toLocaleString('en-US')],
    ['Languages', String(langCount)],
  ]
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 700 }}>AI translations · total</div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid rgba(128,128,128,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rows.map(([label, val]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1, opacity: 0.85 }}>{label}</span>
            <b>{val}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Just the donut chart (ring + center label + totals tooltip). */
export function Donut({
  data,
  totalWords,
  totalKeys,
  langCount,
  size = 150,
}: {
  data: DonutSlice[]
  totalWords: number
  totalKeys: number
  langCount: number
  size?: number
}) {
  return (
    <MuiTooltip
      arrow
      placement="top"
      title={<DonutTotals totalWords={totalWords} totalKeys={totalKeys} langCount={langCount} />}
      slotProps={{ tooltip: { sx: { p: 1.5, maxWidth: 'none' } } }}
    >
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <PieChart width={size} height={size}>
          <ColorGradients
            prefix="gd"
            items={data.map((d, i) => ({ key: String(i), color: d.color }))}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={size * 0.327}
            outerRadius={size * 0.5}
            startAngle={90}
            endAngle={-270}
            stroke={COL.surface}
            strokeWidth={1}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={gradFill('gd', String(i), d.color)} />
            ))}
          </Pie>
        </PieChart>
        <div style={M.donutCenter}>
          <div style={M.donutCenterV}>{abbr(totalWords)}</div>
          <div style={M.donutCenterL}>words</div>
        </div>
      </div>
    </MuiTooltip>
  )
}

/** Bucket legend: name (bold) + word count. */
export function DonutLegend({ data }: { data: DonutSlice[] }) {
  // Hide buckets with no words (e.g. a language with no 89-80% matches).
  const shown = data.filter((d) => d.value > 0)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 20px' }}>
      {shown.map((d, i) => (
        <span key={i} style={M.lg}>
          <span style={{ ...M.dot, background: d.color }} />
          <span style={{ flex: 1, color: COL.text }}>{d.name}</span>
          <span style={{ color: COL.dim }}>{d.value} words</span>
        </span>
      ))}
    </div>
  )
}

/** A single horizontal stacked bar (the per-language chart, one row): score
 *  buckets + "not reviewed", proportional widths, rounded outer ends, subtle
 *  left→right gradient — matching the dashboard's "Match score by language". */
export function MatchBar({
  data,
  notReviewedWords,
}: {
  data: DonutSlice[]
  notReviewedWords: number
}) {
  const segs = [
    ...data.map((d) => ({ value: d.value, color: d.color })),
    { value: notReviewedWords, color: COL.notReviewed },
  ].filter((s) => s.value > 0)
  const total = segs.reduce((s, x) => s + x.value, 0)
  if (total === 0) {
    return <div style={{ fontSize: 12, fontStyle: 'italic', color: COL.faint }}>No AI data yet</div>
  }
  return (
    <div style={{ display: 'flex', height: 16, gap: 1.5, width: '100%' }}>
      {segs.map((s, i) => {
        const first = i === 0
        const last = i === segs.length - 1
        return (
          <div
            key={i}
            style={{
              flexGrow: s.value,
              flexBasis: 0,
              minWidth: 3,
              background: s.color.startsWith('#')
                ? `linear-gradient(90deg, ${s.color}, ${lighten(s.color, 0.3)})`
                : s.color,
              borderTopLeftRadius: first ? 6 : 0,
              borderBottomLeftRadius: first ? 6 : 0,
              borderTopRightRadius: last ? 6 : 0,
              borderBottomRightRadius: last ? 6 : 0,
            }}
          />
        )
      })}
    </div>
  )
}

/** Dashboard's left card: donut + legend side by side. */
export function MatchDonut(props: {
  data: DonutSlice[]
  totalWords: number
  totalKeys: number
  langCount: number
}) {
  return (
    <div style={{ ...M.metricCard, gap: 18 }}>
      <Donut {...props} />
      <DonutLegend data={props.data} />
    </div>
  )
}

export function TipIcon({ type }: { type: 'open' | 'edit' | 'info' }) {
  const p = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: COL.faint,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (type === 'info') {
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    )
  }
  if (type === 'open') {
    return (
      <svg {...p}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
      </svg>
    )
  }
  return (
    <svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

// `short` is the compact right-aligned status used by the panel's simplified tips.
const TIPS: {
  name: string
  desc: string
  stat: string
  short: string
  icon: 'open' | 'edit'
}[] = [
  {
    name: 'Project description',
    desc: 'Describe your project and brand so AI matches your tone, terminology and style.',
    stat: 'Set · updated 3 days ago',
    short: 'Set',
    icon: 'edit',
  },
  {
    name: 'Language notes',
    desc: 'Set tone, formality and terminology per language.',
    stat: '3 of 5 languages set · updated 12 Jan',
    short: '3 of 5 set',
    icon: 'edit',
  },
  {
    name: 'AI playground',
    desc: 'Fine-tune and test your translation prompt on real data.',
    stat: 'Default prompt · last run 5 days ago',
    short: 'Default prompt',
    icon: 'open',
  },
]

/** Simplified "Improve AI accuracy" — compact rows (name + short status +
 *  icon), no descriptions or cards. Used in the narrow tools panel. */
export type TipItem = { name: string; stat: string; icon: 'open' | 'edit' | 'info' }

export function ImproveAiTipsCompact({ tips = TIPS }: { tips?: TipItem[] }) {
  return (
    <div style={{ marginTop: 6, borderTop: `1px solid ${COL.line}`, paddingTop: 16 }}>
      <div style={{ ...M.tipsTitle, marginBottom: 4 }}>Improve AI accuracy</div>
      {tips.map((t, i) => (
        <a
          key={t.name}
          href="#"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '11px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${COL.line}`,
            textDecoration: 'none',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ color: COL.text, fontSize: 13.5, fontWeight: 500 }}>{t.name}</div>
            <div style={{ color: COL.dim, fontSize: 11.5, marginTop: 2 }}>{t.stat}</div>
          </div>
          <TipIcon type={t.icon} />
          <TipIcon type="info" />
        </a>
      ))}
    </div>
  )
}

export type FullTipItem = {
  name: string
  desc: string
  stat: string
  icon: 'open' | 'edit' | 'info'
}

/** "Improve AI accuracy" cards. `cols` = how many across; `tips` defaults to
 *  the built-in mock (pass real ones from /api/ai-context). */
export function ImproveAiTips({ cols = 3, tips = TIPS }: { cols?: number; tips?: FullTipItem[] }) {
  return (
    <div style={M.tips}>
      <div style={M.tipsHead}>
        <span style={M.tipsTitle}>Improve AI accuracy</span>
        <span style={M.tipsHint}>
          Better context means higher match scores and less manual editing.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
        {tips.map((t) => (
          <a key={t.name} href="#" style={M.tipCard}>
            <span style={M.tipHead}>
              <span style={M.tipName}>{t.name}</span>
              <TipIcon type={t.icon} />
            </span>
            <span style={M.tipDesc}>{t.desc}</span>
            <span style={M.tipStat}>{t.stat}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// Compact, single-column match summary for the translation tools panel (and
// the standalone "Panel" preview tab). Same building blocks as the dashboard,
// arranged vertically: language header → donut → gauges → legend → tips.
export function PanelView({
  flag,
  name,
  range,
  onRangeChange,
  donutData,
  notReviewedWords,
  avgScore,
  reviewedScore,
  tips,
}: {
  flag: string
  name: string
  /** Selected period (label) — the filter applies immediately on change. */
  range: string
  onRangeChange: (r: string) => void
  donutData: DonutSlice[]
  notReviewedWords: number
  avgScore: number
  reviewedScore: number
  /** "Improve AI accuracy" items; omitted → built-in mock. */
  tips?: TipItem[]
}) {
  return (
    <div
      style={{
        fontFamily: SANS,
        color: COL.text,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
          }}
        >
          AI accuracy
        </span>
        <span title={name} style={{ display: 'inline-flex' }}>
          <Flag emoji={flag} size={18} />
        </span>
        <FormControl size="small" sx={{ marginLeft: 'auto', minWidth: 140 }}>
          <Select
            value={range}
            onChange={(e) => onRangeChange(e.target.value)}
            // The panel is an auto-resized iframe; MUI's scroll-lock mutates
            // <body> on open, which retriggers the ResizeObserver and makes the
            // menu jump. Disable it and cap the menu height.
            MenuProps={{
              disableScrollLock: true,
              slotProps: { paper: { style: { maxHeight: 320 } } },
            }}
          >
            {RANGE_LABELS.map((o) => (
              <MenuItem key={o} value={o}>
                {o}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div
          style={{
            background: COL.lineSoft,
            borderRadius: 12,
            padding: '14px 16px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 700, color: scoreColor(avgScore) }}>
            {avgScore}%
          </div>
          <div style={{ fontSize: 12, color: COL.dim, marginTop: 2 }}>Avg match score</div>
        </div>
        <div
          style={{
            background: COL.lineSoft,
            borderRadius: 12,
            padding: '14px 16px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 700, color: COL.text }}>{reviewedScore}%</div>
          <div style={{ fontSize: 12, color: COL.dim, marginTop: 2 }}>Reviewed</div>
        </div>
      </div>
      <MatchBar data={donutData} notReviewedWords={notReviewedWords} />
      <DonutLegend data={donutData} />
      <ImproveAiTipsCompact tips={tips} />
    </div>
  )
}

// Loading placeholder mirroring PanelView's layout (shimmer via App.css .s-skel).
export function PanelSkeleton() {
  const cell = (style: CSSProperties) => <div className="s-skel" style={style} aria-hidden />
  return (
    <div
      style={{
        fontFamily: SANS,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {cell({ width: 18, height: 18, borderRadius: 4 })}
        {cell({ width: 90, height: 14, borderRadius: 6 })}
        {cell({ width: 120, height: 32, borderRadius: 8, marginLeft: 'auto' })}
      </div>
      {cell({ height: 16, borderRadius: 8 })}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {cell({ height: 70, borderRadius: 12 })}
        {cell({ height: 70, borderRadius: 12 })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 20px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="s-skel" style={{ height: 13, borderRadius: 6 }} aria-hidden />
        ))}
      </div>
    </div>
  )
}
