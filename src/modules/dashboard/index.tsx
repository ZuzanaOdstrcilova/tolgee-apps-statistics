import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  ListItemText,
  MenuItem,
  Select,
  Tooltip as MuiTooltip,
  type SelectChangeEvent,
} from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { createTolgeeApp, createTolgeeAppClient } from '@tolgee/apps-sdk/browser'
import { buildTolgeeTheme } from '../../theme/tolgeeTheme'
import { Flag } from '../../lib/flag'
import { useMatchData, type BucketKey, type MatchResponse, type MatchTotals } from './matchData'

// The dashboard filters use Tolgee-themed MUI components. The heavier
// Design-kit showcase is still lazy-loaded so its extra components stay out
// of the initial dashboard chunk.
const ComponentsShowcase = lazy(() => import('./ComponentsShowcase'))
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  Rectangle,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// Visual-only redesign of the dashboard's first tab ("AI translation
// accuracy"), built on recharts. Data is static dummy for now — wiring it
// to /api/stats is a later step once the backend exposes match scores.

const COL = {
  // Match-score data-viz palette — constant across light/dark (reads on both).
  c100: '#00C86C',
  c9990: '#5CD6B0',
  c8980: '#4FC3F7',
  c7970: '#1E88E5',
  cno: '#FF7A8F',
  // Chrome + accent — mapped to Tolgee's real palette via CSS variables
  // (light + dark in App.css), following the host via prefers-color-scheme.
  // Tolgee does not inject its tokens at runtime, so we mirror their values.
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

const SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

// The mock "Tolgee" top bar only makes sense in the standalone local
// preview — inside the Tolgee iframe the host already renders its own
// chrome, so we'd be duplicating it. Embedded in Tolgee: hide it.
const STANDALONE = window.parent === window

const RANGES = [
  'Last minute',
  'Last 5 minutes',
  'Last hour',
  'Today',
  'Last week',
  'Last 30 days',
  'All time',
]
const ALL = '__all__'

/** A project language. `flag` is Tolgee's per-language emoji; `base` marks
 *  the project base language (excluded from AI match-score charts). */
type Lang = { tag: string; name: string; flag: string; base: boolean }

// Mock languages for the standalone local preview (always mock data there).
const MOCK_LANGS: Lang[] = [
  { tag: 'en', name: 'English', flag: '🇬🇧', base: true },
  { tag: 'de', name: 'German', flag: '🇩🇪', base: false },
  { tag: 'cs', name: 'Czech', flag: '🇨🇿', base: false },
  { tag: 'fr', name: 'French', flag: '🇫🇷', base: false },
  { tag: 'es', name: 'Spanish', flag: '🇪🇸', base: false },
]

/**
 * Project languages for the filter. In the standalone preview: mock. Inside
 * the Tolgee iframe: the project's REAL languages (incl. flag emoji) via the
 * typed SDK client. Falls back to mock if the call fails.
 *
 * Note: on apps.preview the init `apiUrl` arrives empty, so we fall back to
 * the parent (referrer) origin as the API base.
 */
function useProjectLanguages(): { languages: Lang[]; projectId: number | undefined } {
  // In the iframe, start empty so we don't fetch /api/match for MOCK tags
  // before the project's real languages arrive; standalone always uses mock.
  const [languages, setLanguages] = useState<Lang[]>(STANDALONE ? MOCK_LANGS : [])
  const [projectId, setProjectId] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (STANDALONE) return
    let active = true
    const app = createTolgeeApp()
    app.context.then((ctx) => {
      if (active) setProjectId(ctx.projectId)
      const apiUrl =
        ctx.apiUrl || (document.referrer ? new URL(document.referrer).origin : '')
      if (!apiUrl) return
      const client = createTolgeeAppClient({ ...ctx, apiUrl })
      client
        .GET('/v2/projects/{projectId}/languages', {
          params: { path: { projectId: ctx.projectId }, query: { size: 1000 } },
        })
        .then(({ data }) => {
          const list = data?._embedded?.languages
          if (active && list?.length) {
            setLanguages(
              list.map((l) => ({
                tag: l.tag,
                name: l.name,
                flag: l.flagEmoji ?? '',
                base: l.base,
              }))
            )
          }
        })
        .catch(() => {})
    })
    return () => {
      active = false
      app.dispose()
    }
  }, [])
  return { languages, projectId }
}

// Subtle/light chip shown next to the page title (mirrors the DS subtle chip).
const SUBTLE_CHIP = {
  height: 22,
  fontSize: 12,
  fontWeight: 500,
  bgcolor: 'var(--s-line-soft)',
  color: 'text.secondary',
  border: 'none',
} as const

type ThemeMode = 'light' | 'dark' | 'system'
const prefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

// Re-renders every `intervalMs` so relative timestamps ("3 min ago") stay live.
function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// "generated X ago": minutes/hours, then an absolute date for anything older.
const relTime = (fromMs: number, now: number): string => {
  const s = Math.max(0, Math.round((now - fromMs) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  return new Date(fromMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type Bucket = { key: string; label: string; color: string }
const BUCKETS: Bucket[] = [
  { key: 'b100', label: '100% Match', color: COL.c100 },
  { key: 'b9990', label: 'Match score 99-90%', color: COL.c9990 },
  { key: 'b8980', label: 'Match score 89-80%', color: COL.c8980 },
  { key: 'b7970', label: 'Match score 79-70%', color: COL.c7970 },
  { key: 'bno', label: 'Less than 70%', color: COL.cno },
  { key: 'notReviewed', label: 'Not reviewed', color: COL.notReviewed },
]

// `keys`/`langs` = how many keys / languages contribute to the slice.
type DonutSlice = { name: string; value: number; color: string; keys: number; langs: number }
const DONUT: DonutSlice[] = [
  { name: '100% Match', value: 301, color: COL.c100, keys: 142, langs: 4 },
  { name: '99-90%', value: 276, color: COL.c9990, keys: 121, langs: 4 },
  { name: '89-80%', value: 126, color: COL.c8980, keys: 58, langs: 3 },
  { name: '79-70%', value: 75, color: COL.c7970, keys: 33, langs: 3 },
  { name: 'Less than 70%', value: 478, color: COL.cno, keys: 167, langs: 4 },
]
const DONUT_TOTAL = DONUT.reduce((s, d) => s + d.value, 0)
const DONUT_KEYS = DONUT.reduce((s, d) => s + d.keys, 0)

type LangRow = {
  lang: string
  flag: string
  code: string
  total: number
  /** Weighted avg match score across this language's reviewed AI translations. */
  avg: number
  [bucketKey: string]: number | string
}

// Weighted average match score from the reviewed buckets (representative score
// per bucket); excludes "not reviewed".
const avgFromBuckets = (c: {
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

// Reviewed-bucket word count for a row. 0 ⇒ nothing reviewed yet (e.g. zh):
// the avg score is meaningless, so we show "—" instead of a misleading 0%.
const reviewedWordsOf = (row: LangRow): number =>
  Number(row.b100) + Number(row.b9990) + Number(row.b8980) + Number(row.b7970) + Number(row.bno)

// The match-score numbers per language aren't in the backend yet, so derive
// stable placeholder bucket values from the language tag — but the LANGUAGES
// themselves are the real, filtered project languages (passed in at render).
const seedFrom = (s: string): number =>
  [...s].reduce((acc, ch) => acc + ch.charCodeAt(0), 7)

const buildLangRow = (lang: Lang): LangRow => {
  const seed = seedFrom(lang.tag || lang.name)
  const v = [
    120 + ((seed * 7) % 360), // 100%
    80 + ((seed * 5) % 220), // 99-90
    40 + ((seed * 3) % 120), // 89-80
    20 + ((seed * 11) % 90), // 79-70
    50 + ((seed * 13) % 500), // no match
    100 + ((seed * 17) % 400), // not reviewed
  ]
  const total = v.reduce((a, b) => a + b, 0)
  // Flags live in the chart (Y-axis labels), not in the filter dropdown.
  const row: LangRow = {
    lang: lang.name,
    flag: lang.flag,
    code: lang.tag,
    total,
    avg: avgFromBuckets({ b100: v[0], b9990: v[1], b8980: v[2], b7970: v[3], bno: v[4] }),
  }
  BUCKETS.forEach((b, i) => {
    row[b.key] = v[i]
    row[b.key + '_pct'] = (v[i] / total) * 100
  })
  return row
}

// Map a real /api/match response onto the donut + per-language chart shapes.
const DONUT_META: { key: BucketKey; name: string; color: string }[] = [
  { key: 'b100', name: '100% Match', color: COL.c100 },
  { key: 'b9990', name: '99-90%', color: COL.c9990 },
  { key: 'b8980', name: '89-80%', color: COL.c8980 },
  { key: 'b7970', name: '79-70%', color: COL.c7970 },
  { key: 'bno', name: 'Less than 70%', color: COL.cno },
]

const toDonut = (t: MatchTotals): DonutSlice[] =>
  DONUT_META.map((d) => {
    const agg = t.buckets[d.key]
    return { name: d.name, value: agg.words, color: d.color, keys: agg.keys, langs: agg.langs }
  })

const toLangRow = (r: MatchResponse['perLang'][number]): LangRow => ({
  lang: r.name,
  flag: r.flag,
  code: r.tag,
  total: r.total,
  avg: avgFromBuckets({ b100: r.b100, b9990: r.b9990, b8980: r.b8980, b7970: r.b7970, bno: r.bno }),
  b100: r.b100,
  b9990: r.b9990,
  b8980: r.b8980,
  b7970: r.b7970,
  bno: r.bno,
  notReviewed: r.notReviewed,
  b100_pct: r.b100_pct,
  b9990_pct: r.b9990_pct,
  b8980_pct: r.b8980_pct,
  b7970_pct: r.b7970_pct,
  bno_pct: r.bno_pct,
  notReviewed_pct: r.notReviewed_pct,
})

const abbr = (n: number): string =>
  n >= 1e6
    ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M'
    : n >= 1e3
      ? (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'k'
      : '' + n

const scoreColor = (pct: number): string =>
  pct >= 90 ? COL.c100 : pct >= 80 ? COL.c8980 : pct >= 70 ? COL.c7970 : COL.cno

// Mix a hex colour toward white by `amt` (0..1) — used to build subtle
// top-lighter gradients that give the chart fills a bit of depth.
const lighten = (hex: string, amt: number): string => {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(c + (255 - c) * amt)
  )
  return `#${((1 << 24) + (ch[0] << 16) + (ch[1] << 8) + ch[2]).toString(16).slice(1)}`
}
// SVG <defs> of vertical light→base gradients, one per hex colour. Pass an
// id prefix; reference a fill as `url(#${prefix}-${key})`.
function ColorGradients({
  prefix,
  items,
  direction = 'vertical',
}: {
  prefix: string
  items: { key: string; color: string }[]
  /** 'horizontal' = right→light, left→base (for the long horizontal bars). */
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
const gradFill = (prefix: string, key: string, color: string): string =>
  color.startsWith('#') ? `url(#${prefix}-${key})` : color

// Shimmer primitive (animation in App.css `.s-skel`).
function Skel({ w, h, r = 8, style }: { w?: number | string; h: number; r?: number; style?: CSSProperties }) {
  return (
    <div
      className="s-skel"
      style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }}
      aria-hidden
    />
  )
}

// Donut + two gauges placeholder shown until the first language resolves.
function MetricSkeletons() {
  return (
    <>
      <div style={{ ...S.metricCard, gap: 18 }}>
        <Skel w={150} h={150} r={75} style={{ flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skel key={i} h={12} w={`${85 - i * 9}%`} />
          ))}
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} style={S.gaugeCard}>
          <Skel w={140} h={140} r={70} />
          <Skel w={90} h={11} style={{ marginTop: 4 }} />
        </div>
      ))}
    </>
  )
}

// One skeleton row per still-computing language (flag + name known, bar pending).
function LangBarSkeletons({ langs }: { langs: Lang[] }) {
  if (langs.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '8px 12px 8px 8px' }}>
      {langs.map((l) => (
        <div key={l.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
          <div
            style={{
              width: 108,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: COL.dim,
            }}
          >
            <Flag emoji={l.flag} size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.name}
            </span>
          </div>
          <Skel h={16} style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  )
}

// One row per selected language that was never machine-translated — there's no
// AI accuracy to measure, so we say so explicitly instead of drawing a bar.
function NoAiRows({ langs }: { langs: { tag: string; name: string; flag: string }[] }) {
  if (langs.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {langs.map((l) => (
        <div key={l.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 46 }}>
          <div
            style={{
              width: 116,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: COL.dim,
            }}
          >
            <Flag emoji={l.flag} size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.name}
            </span>
          </div>
          <span style={{ fontSize: 12, fontStyle: 'italic', color: COL.faint }}>
            Not translated by AI
          </span>
        </div>
      ))}
    </div>
  )
}

// recharts hands custom tooltips a loosely-typed payload; narrow per use.
type TipEntry = { value: number; name?: string; payload?: LangRow }
type TipProps = { active?: boolean; payload?: TipEntry[] }

function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
  const data = [{ name: label, value, fill: color }]
  return (
    <div style={S.gaugeCard}>
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
        <div style={S.gaugeCenter}>{value}%</div>
      </div>
      <div style={S.gaugeLabel}>{label}</div>
    </div>
  )
}

function MatchDonut({
  data,
  totalWords,
  totalKeys,
  langCount,
}: {
  data: DonutSlice[]
  totalWords: number
  totalKeys: number
  langCount: number
}) {
  return (
    <div style={{ ...S.metricCard, gap: 18 }}>
      <MuiTooltip
        arrow
        placement="top"
        title={<DonutTotals totalWords={totalWords} totalKeys={totalKeys} langCount={langCount} />}
        slotProps={{ tooltip: { sx: { p: 1.5, maxWidth: 'none' } } }}
      >
        <div style={{ position: 'relative', width: 150, height: 150, flex: 'none' }}>
          <PieChart width={150} height={150}>
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
              innerRadius={49}
              outerRadius={75}
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
          <div style={S.donutCenter}>
            <div style={S.donutCenterV}>{abbr(totalWords)}</div>
            <div style={S.donutCenterL}>words</div>
          </div>
        </div>
      </MuiTooltip>
      <div style={S.donutLegend}>
        {data.map((d, i) => (
          <span key={i} style={S.lg}>
            <span style={{ ...S.dot, background: d.color }} />
            <b style={{ flex: 1, color: COL.text }}>{d.name}</b>
            <span style={{ color: COL.dim }}>{d.value} words</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// Project-wide totals shown when hovering anywhere on the donut (ring AND
// the center hole) — total words, keys, and languages excluding base. Rendered
// as an MUI Tooltip title so the whole donut area is hoverable.
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

function LangTip({ active, payload }: TipProps) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0].payload
  if (!row) return null
  return (
    <div style={{ ...S.tip, minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        <Flag emoji={row.flag} size={16} />
        <span style={{ flex: 1 }}>{row.lang}</span>
        <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
          {row.total.toLocaleString('en-US')} words
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
        <span style={{ flex: 1 }}>Avg match score</span>
        {reviewedWordsOf(row) === 0 ? (
          <b style={{ color: COL.dim }}>—</b>
        ) : (
          <b style={{ color: scoreColor(row.avg) }}>{row.avg}%</b>
        )}
      </div>
      <div
        style={{
          marginTop: 11,
          paddingTop: 11,
          borderTop: '1px solid rgba(128,128,128,0.28)',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {BUCKETS.map((b) => {
          const val = Number(row[b.key])
          const pct = Number(row[b.key + '_pct'])
          return val > 0 ? (
            <span key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{ width: 9, height: 9, borderRadius: 2, background: b.color, flex: 'none' }}
              />
              <span style={{ flex: 1 }}>{b.label}</span>
              <span style={{ fontWeight: 600 }}>
                {val.toLocaleString('en-US')} · {pct.toFixed(1)}%
              </span>
            </span>
          ) : null
        })}
      </div>
    </div>
  )
}

const BUCKET_ORDER = BUCKETS.map((b) => b.key)

// Custom stacked-bar segment: rounds only the OUTER ends of the whole bar —
// the leftmost present segment gets left corners, the rightmost present one
// gets right corners, inner joints stay square. Computed per row (from which
// buckets are non-zero) so it's correct even when edge buckets are empty
// (e.g. a language that's 100% "not reviewed").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarSegment(props: any) {
  const { x, y, width, height, fill, stroke, strokeWidth, payload, dataKey } = props
  const key = String(dataKey).replace('_pct', '')
  const present = BUCKET_ORDER.filter((k) => Number(payload?.[k + '_pct']) > 0)
  const isFirst = present[0] === key
  const isLast = present[present.length - 1] === key
  const r = 4
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      radius={[isFirst ? r : 0, isLast ? r : 0, isLast ? r : 0, isFirst ? r : 0]}
    />
  )
}

// Y-axis tick: Twemoji flag + language name (via foreignObject so we can
// use the same <img>-based flag Tolgee renders).
function LangAxisTick({
  x,
  y,
  name,
  flags,
}: {
  x: number
  y: number
  name: string
  flags: Map<string, string>
}) {
  return (
    <foreignObject x={x - 116} y={y - 10} width={112} height={20}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 20,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--s-text)',
        }}
      >
        <Flag emoji={flags.get(name) ?? ''} size={16} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      </div>
    </foreignObject>
  )
}

function LangBars({ data }: { data: LangRow[] }) {
  const flags = new Map(data.map((r) => [r.lang, r.flag]))
  if (data.length === 0) {
    return (
      <p className="dash-empty" style={{ color: COL.faint, fontSize: 13, padding: '12px 0' }}>
        No languages selected.
      </p>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={data.length * 46 + 16}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
      >
        <ColorGradients prefix="gb" items={BUCKETS} direction="horizontal" />
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="lang"
          width={116}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tick={(props: any) => (
            <LangAxisTick
              x={Number(props.x) || 0}
              y={Number(props.y) || 0}
              name={String(props.payload?.value ?? '')}
              flags={flags}
            />
          )}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<LangTip />}
          cursor={{ fill: 'rgba(0,0,0,.03)' }}
          wrapperStyle={{ zIndex: 1000 }}
        />
        {BUCKETS.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key + '_pct'}
            stackId="a"
            fill={gradFill('gb', b.key, b.color)}
            barSize={14}
            stroke={COL.surface}
            strokeWidth={1}
            shape={<BarSegment />}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={S.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

function Filters({
  languages,
  langs,
  setLangs,
  range,
  setRange,
  onGenerate,
  loading,
}: {
  languages: Lang[]
  langs: string[]
  setLangs: (v: string[]) => void
  range: string
  setRange: (v: string) => void
  onGenerate: () => void
  loading: boolean
}) {
  // Selectable languages first; the base language goes last (shown but
  // disabled — no AI, excluded from charts; it's purely informative).
  const ordered = [...languages].sort((a, b) => Number(a.base) - Number(b.base))
  const selectableTags = languages.filter((l) => !l.base).map((l) => l.tag)
  const allSelected = selectableTags.length > 0 && langs.length === selectableTags.length

  const onLangs = (e: SelectChangeEvent<string[]>) => {
    const value = e.target.value as string[]
    if (value.includes(ALL)) {
      setLangs(selectableTags) // "All languages" selects every non-base language
      return
    }
    const next = value.filter((v) => v !== ALL)
    if (next.length === 0) return // rule: at least one language must stay selected
    setLangs(next)
  }

  return (
    <div style={S.filters}>
      <div style={S.filterFields}>
        <Field label="Languages">
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <Select
              multiple
              displayEmpty
              value={langs}
              onChange={onLangs}
              renderValue={(sel) => {
                const s = sel as string[]
                if (allSelected) return 'All languages'
                if (s.length === 0) return 'None'
                return s.join(', ') // tags only — flags live in the charts
              }}
            >
              <MenuItem value={ALL}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={langs.length > 0 && !allSelected}
                />
                <ListItemText primary="All languages" />
              </MenuItem>
              <Divider />
              {ordered.map((l) =>
                l.base ? (
                  <MenuItem key={l.tag} value={l.tag} disabled>
                    <Checkbox checked={false} disabled />
                    <ListItemText
                      disableTypography
                      primary={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
                          {l.name}
                          <Chip label="base" size="small" />
                        </span>
                      }
                    />
                  </MenuItem>
                ) : (
                  <MenuItem key={l.tag} value={l.tag}>
                    <Checkbox checked={langs.includes(l.tag)} />
                    <ListItemText primary={l.name} />
                  </MenuItem>
                )
              )}
            </Select>
          </FormControl>
        </Field>
        <Field label="Period">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((o) => (
                <MenuItem key={o} value={o}>
                  {o}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Field>
      </div>
      <Button variant="contained" onClick={onGenerate} disabled={loading}>
        {loading ? 'Generating…' : 'Generate'}
      </Button>
    </div>
  )
}

function TipIcon({ type }: { type: 'open' | 'edit' }) {
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

export default function App() {
  const [tab, setTab] = useState<'pretrans' | 'translator' | 'components'>('pretrans')
  const { languages, projectId } = useProjectLanguages()
  const [langs, setLangs] = useState<string[]>([])
  const [range, setRange] = useState('Last 30 days')
  // "Applied" filters = the query the shown statistics were generated for.
  // Editing langs/range does NOT refetch — the dashboard remembers the last
  // generated stats until the user clicks Generate.
  const [appliedLangs, setAppliedLangs] = useState<string[]>([])
  const [appliedRange, setAppliedRange] = useState('Last 30 days')
  // Default to all NON-BASE languages once known (base has no AI), and
  // auto-generate once so the dashboard isn't empty on first load.
  useEffect(() => {
    const def = languages.filter((l) => !l.base).map((l) => l.tag)
    setLangs(def)
    setAppliedLangs(def)
  }, [languages])
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Real match data from our server (skipped in the standalone preview, which
  // uses the built-in mock), for the APPLIED filters. genKey forces a recompute.
  const [genKey, setGenKey] = useState(0)
  const { perLang, totals, avgMatchScore, reviewedPct, pendingTags, loading, error } =
    useMatchData(projectId, appliedLangs, appliedRange, !STANDALONE, genKey)

  // Generate: apply the live filters and force a recompute.
  const onGenerate = () => {
    setAppliedLangs(langs)
    setAppliedRange(range)
    setGenKey((k) => k + 1)
  }

  // When the shown statistics were generated (for the "generated X ago" badge).
  const [generatedAt, setGeneratedAt] = useState<number>(() => Date.now())
  const wasLoading = useRef(false)
  useEffect(() => {
    if (wasLoading.current && !loading) setGeneratedAt(Date.now())
    wasLoading.current = loading
  }, [loading])
  useEffect(() => {
    setGeneratedAt(Date.now())
  }, [genKey])
  const now = useNow()

  // The "Match score by language" chart shows the currently filtered
  // (selected) languages — mock in standalone, real /api/match data in Tolgee.
  // Resolved languages render immediately; still-computing ones show skeletons.
  const langData = useMemo<LangRow[]>(() => {
    if (STANDALONE) {
      return languages.filter((l) => !l.base && appliedLangs.includes(l.tag)).map(buildLangRow)
    }
    // Chart shows languages that HAVE AI content (reviewed buckets and/or a
    // grey "not reviewed" segment, e.g. zh). Languages never machine-translated
    // (total 0) are listed separately as "Not translated by AI" (see noAiLangs).
    return perLang.filter((r) => appliedLangs.includes(r.tag) && r.total > 0).map(toLangRow)
  }, [languages, appliedLangs, perLang])

  // Selected languages that have NO AI translations at all → shown as a labeled
  // row instead of an empty/grey bar.
  const noAiLangs = STANDALONE
    ? []
    : perLang
        .filter((r) => appliedLangs.includes(r.tag) && r.total === 0)
        .map((r) => ({ tag: r.tag, name: r.name, flag: r.flag }))

  // Languages still being computed → rendered as skeleton rows below the bars.
  const pendingLangs = STANDALONE
    ? []
    : pendingTags
        .map((tag) => languages.find((l) => l.tag === tag))
        .filter((l): l is Lang => Boolean(l))

  // Donut + gauge inputs: mock in standalone, real aggregates in Tolgee.
  const donutData = STANDALONE ? DONUT : toDonut(totals)
  const donutWords = STANDALONE ? DONUT_TOTAL : totals.reviewedWords
  const donutKeys = STANDALONE ? DONUT_KEYS : totals.reviewedKeys
  // Totals reflect exactly the selected languages (the applied filter).
  const selectedCount = STANDALONE ? languages.filter((l) => !l.base).length : appliedLangs.length
  const donutLangs = selectedCount
  const avgScore = STANDALONE ? 81.7 : avgMatchScore
  const reviewedScore = STANDALONE ? 62.8 : reviewedPct

  // Big donut/gauge skeletons only WHILE loading with nothing resolved yet —
  // so a finished-but-empty (or failed) run doesn't shimmer forever.
  const noDataYet = !STANDALONE && loading && perLang.length === 0
  // Every fetch failed and nothing resolved → surface the error, not a spinner.
  const showError = !STANDALONE && !loading && Boolean(error) && perLang.length === 0

  // Theme mode. Default follows the OS (Tolgee's "system"); the Design-kit
  // toggle can override it. Drives both the MUI theme and the CSS-variable
  // chrome (via a data-theme attribute) so the whole app previews together.
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [osMode, setOsMode] = useState<'light' | 'dark'>(prefersDark)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setOsMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const mode = themeMode === 'system' ? osMode : themeMode
  const theme = useMemo(() => buildTolgeeTheme(mode), [mode])
  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])

  // Inside the Tolgee iframe, ask the host to size the iframe to our
  // content height so there's no inner scrollbar. The observer keeps it in
  // sync as charts mount/fonts load. Skipped in standalone (no host).
  useEffect(() => {
    if (STANDALONE) return
    const el = rootRef.current
    if (!el) return
    const app = createTolgeeApp()
    const observer = new ResizeObserver(() => app.resize(el.scrollHeight))
    observer.observe(el)
    return () => {
      observer.disconnect()
      app.dispose()
    }
  }, [])

  return (
    <ThemeProvider theme={theme}>
    <div
      ref={rootRef}
      style={{
        // In the Tolgee iframe: transparent so the host background shows
        // through. In the standalone preview: paint Tolgee's own page
        // background (canvas token, light/dark-aware) so the dark mode is
        // actually visible instead of the browser's white.
        background: STANDALONE ? 'var(--s-canvas)' : 'transparent',
        minHeight: STANDALONE ? '100vh' : undefined,
        fontFamily: SANS,
        color: COL.text,
      }}
    >
      {STANDALONE && (
        <header style={S.header}>
          <div style={{ ...S.wrap, ...S.topbar }}>
            <span style={S.crumb}>Tolgee Apps · Statistiky</span>
          </div>
        </header>
      )}

      {STANDALONE && (
        <div style={S.tabsbar}>
          <div style={{ ...S.wrap, ...S.tabsrow }} role="tablist">
            {(
              [
                ['pretrans', 'AI translation accuracy'],
                ['translator', 'Translator Accuracy'],
                ['components', 'Design kit'],
              ] as const
            ).map(([id, label]) => {
              const on = tab === id
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(id)}
                  style={tabStyle(on)}
                >
                  {label}
                  {on && <span style={S.tabUnderline} />}
                </button>
              )
            })}
            <ModeToggle value={themeMode} onChange={setThemeMode} />
          </div>
        </div>
      )}

      <main style={S.wrap}>
        {tab === 'pretrans' ? (
          <section>
            <div style={S.titlerow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={S.h1}>AI translation accuracy</h1>
                <Chip
                  label={`Period: ${appliedRange} · Generated ${relTime(generatedAt, now)}`}
                  size="small"
                  sx={SUBTLE_CHIP}
                />
              </div>
            </div>

            <Filters
              {...{ languages, langs, setLangs, range, setRange }}
              onGenerate={onGenerate}
              loading={loading}
            />

            <div style={S.block}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: COL.text }}>
                  AI translations approved by reviewers
                </div>
                <div style={{ fontSize: 12.5, color: COL.dim, marginTop: 3, lineHeight: 1.5 }}>
                  Totals for the {selectedCount} selected{' '}
                  {selectedCount === 1 ? 'language' : 'languages'}.{' '}
                  <b style={{ color: COL.text }}>Match</b> compares the text AI produced with the
                  final reviewer-approved text — 100% means the reviewer kept it unchanged.
                </div>
              </div>
              <div style={S.metricrow}>
                {noDataYet ? (
                  <MetricSkeletons />
                ) : showError ? (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      border: `1px solid ${COL.line}`,
                      borderRadius: 12,
                      padding: '20px 22px',
                      color: COL.dim,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                    }}
                  >
                    <span>Couldn’t load match data: {error}</span>
                    <Button variant="outlined" size="small" onClick={onGenerate}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    <MatchDonut
                      data={donutData}
                      totalWords={donutWords}
                      totalKeys={donutKeys}
                      langCount={donutLangs}
                    />
                    <Gauge value={avgScore} label="Avg match score" color={scoreColor(avgScore)} />
                    <Gauge value={reviewedScore} label="Reviewed" color={COL.c100} />
                  </>
                )}
              </div>

              <div style={{ ...S.sub, marginTop: 8 }}>Match score by language</div>
              {langData.length > 0 && <LangBars data={langData} />}
              <LangBarSkeletons langs={pendingLangs} />
              <NoAiRows langs={noAiLangs} />
              {!loading && !showError && langData.length === 0 && noAiLangs.length === 0 && (
                <p
                  className="dash-empty"
                  style={{ color: COL.faint, fontSize: 13, padding: '12px 0' }}
                >
                  No AI-translated reviewed content for the selected languages and period.
                </p>
              )}

              <div style={S.chartLegend}>
                {BUCKETS.map((b) => (
                  <span key={b.key} style={S.lgInline}>
                    <span style={{ ...S.lgline, background: b.color }} />
                    {b.label}
                  </span>
                ))}
              </div>
            </div>

            <div style={S.tips}>
              <div style={S.tipsHead}>
                <span style={S.tipsTitle}>Improve AI accuracy</span>
                <span style={S.tipsHint}>
                  Better context means higher match scores and less manual editing.
                </span>
              </div>
              <div style={S.tipsRow}>
                <a href="#" style={S.tipCard}>
                  <span style={S.tipHead}>
                    <span style={S.tipName}>Project description</span>
                    <TipIcon type="edit" />
                  </span>
                  <span style={S.tipDesc}>
                    Describe your project and brand so AI matches your tone, terminology and
                    style.
                  </span>
                  <span style={S.tipStat}>Set · updated 3 days ago</span>
                </a>
                <a href="#" style={S.tipCard}>
                  <span style={S.tipHead}>
                    <span style={S.tipName}>Notes for individual languages</span>
                    <TipIcon type="open" />
                  </span>
                  <span style={S.tipDesc}>Set tone, formality and terminology per language.</span>
                  <span style={S.tipStat}>3 of 5 languages set · updated 12 Jan</span>
                </a>
                <a href="#" style={S.tipCard}>
                  <span style={S.tipHead}>
                    <span style={S.tipName}>AI playground</span>
                    <TipIcon type="open" />
                  </span>
                  <span style={S.tipDesc}>
                    Fine-tune and test your translation prompt on real data.
                  </span>
                  <span style={S.tipStat}>Default prompt · last run 5 days ago</span>
                </a>
              </div>
            </div>
          </section>
        ) : tab === 'components' ? (
          <Suspense
            fallback={
              <section style={S.titlerow}>
                <h1 style={S.h1}>Loading…</h1>
              </section>
            }
          >
            <ComponentsShowcase />
          </Suspense>
        ) : (
          <section style={S.titlerow}>
            <h1 style={S.h1}>
              Translator accuracy <span style={S.h1dim}>· coming soon</span>
            </h1>
          </section>
        )}
      </main>
    </div>
    </ThemeProvider>
  )
}

// Light / Dark / System preview switch — standalone Design-kit chrome only.
function ModeToggle({
  value,
  onChange,
}: {
  value: ThemeMode
  onChange: (m: ThemeMode) => void
}) {
  const opts: [ThemeMode, string][] = [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System'],
  ]
  return (
    <div style={S.modeToggle}>
      {opts.map(([m, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          style={modeBtnStyle(value === m)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const modeBtnStyle = (on: boolean): CSSProperties => ({
  appearance: 'none',
  border: 'none',
  background: on ? COL.accent : 'transparent',
  color: on ? '#fff' : COL.dim,
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 7,
  cursor: 'pointer',
})

// Matches Tolgee's tabs: uppercase, 14px/500, pink active + indicator.
const tabStyle = (on: boolean): CSSProperties => ({
  appearance: 'none',
  background: 'none',
  border: 'none',
  color: on ? COL.accent : COL.dim,
  fontFamily: SANS,
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
  padding: '10px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  position: 'relative',
})

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1200, margin: '0 auto', padding: '0 32px' },
  header: { background: 'transparent' },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, height: 60 },
  logo: {
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '-0.02em',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: 'linear-gradient(135deg,#4b53d6,#11b886)',
    display: 'inline-block',
  },
  crumb: { fontSize: 16, fontWeight: 600 },

  tabsbar: { background: 'transparent' },
  tabsrow: { display: 'flex', alignItems: 'center', gap: 4, height: 52 },
  modeToggle: {
    marginLeft: 'auto',
    display: 'flex',
    gap: 2,
    padding: 3,
    borderRadius: 9,
    background: COL.lineSoft,
  },
  tabUnderline: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: -1,
    height: 2,
    background: COL.accent,
    borderRadius: 2,
  },

  titlerow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '26px 0 18px',
  },
  h1: { fontSize: 24, fontWeight: 400, color: COL.text, margin: 0 },
  h1dim: { color: COL.faint, fontWeight: 500 },
  btnPrimary: {
    background: COL.accent,
    border: `1px solid ${COL.accent}`,
    color: '#fff',
    fontFamily: SANS,
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 14px',
    borderRadius: 8,
    cursor: 'pointer',
  },

  filters: {
    background: COL.surface,
    border: `1px solid ${COL.line}`,
    borderRadius: 12,
    padding: '18px 20px',
    marginBottom: 22,
    display: 'flex',
    gap: 22,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  filterFields: { display: 'flex', gap: 22, alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: COL.dim },
  select: {
    appearance: 'none',
    border: `1px solid ${COL.line}`,
    background: COL.surface,
    borderRadius: 8,
    fontFamily: SANS,
    fontSize: 13,
    color: COL.text,
    padding: '8px 30px 8px 12px',
    minWidth: 180,
    cursor: 'pointer',
  },

  block: {
    background: COL.surface,
    border: `1px solid ${COL.line}`,
    borderRadius: 12,
    padding: '22px 24px',
    marginBottom: 22,
  },
  tips: {
    background: COL.surface,
    border: `1px solid ${COL.line}`,
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 22,
  },
  tipsHead: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 },
  tipsTitle: { color: COL.text, fontSize: 15, fontWeight: 600 },
  tipsHint: { color: COL.dim, fontSize: 12.5 },
  tipsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 },
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
  sub: { fontSize: 13.5, color: COL.dim, fontWeight: 600, marginBottom: 14 },

  metricrow: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    gap: 12,
    marginBottom: 26,
  },
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

  chartLegend: {
    display: 'flex',
    gap: 22,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    fontSize: 12.5,
    color: COL.dim,
  },
  lgInline: { display: 'flex', alignItems: 'center', gap: 7 },
  lgline: { width: 16, height: 3, borderRadius: 2, display: 'inline-block' },

  tip: {
    background: COL.tipBg,
    color: COL.tipText,
    fontSize: 12.5,
    padding: '12px 14px',
    borderRadius: 11,
    lineHeight: 1.5,
    boxShadow: '1px 1px 6px rgba(0,0,0,0.25)',
    position: 'relative',
    zIndex: 10,
  },
}
