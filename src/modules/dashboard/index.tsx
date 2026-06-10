import { useEffect, useMemo, useState } from 'react'
import {
  createTolgeeApp,
  createTolgeeAppClient,
  type TolgeeAppContext,
} from '@tolgee/apps-sdk/browser'

/** Mirror of the server's StatsSummary (server/store.ts). */
type OriginStats = {
  produced: number
  approved: number
  corrected: number
  accuracy: number | null
}
type StatsSummary = {
  ai: OriginStats
  human: OriginStats
  keys: { created: number; deleted: number }
  timeline: { day: string; ai: number; human: number }[]
  timelineDays: number
}

const POLL_MS = 5000
const AI_COLOR = '#7c5cff'
const HUMAN_COLOR = '#16a34a'

// Standalone dev: when the view is opened directly (not embedded in the
// Tolgee iframe), the host's `tolgee-app:init` message never arrives and
// `app.context` would hang forever on "Loading…". Detect that case and use
// a mock context so the dashboard renders against the local `/api/stats`.
const IS_STANDALONE_DEV = import.meta.env.DEV && window.parent === window
const DEV_CONTEXT: TolgeeAppContext = {
  token: 'dev',
  apiUrl: 'http://localhost',
  organizationId: 1,
  projectId: 1,
  selection: {},
  extra: {},
}

const pct = (v: number | null): string =>
  v == null ? '—' : `${Math.round(v * 100)}%`

export default function Dashboard() {
  const [ctx, setCtx] = useState<TolgeeAppContext | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (IS_STANDALONE_DEV) {
      setCtx(DEV_CONTEXT)
      return
    }
    const app = createTolgeeApp()
    app.context.then(setCtx)
    return () => app.dispose()
  }, [])

  // Project name via the typed SDK client — scoped by the install token.
  useEffect(() => {
    if (!ctx || IS_STANDALONE_DEV) return
    const tolgee = createTolgeeAppClient(ctx)
    tolgee
      .GET('/v2/projects/{projectId}', {
        params: { path: { projectId: ctx.projectId } },
      })
      .then(({ data }) => {
        if (data) setProjectName(data.name)
      })
  }, [ctx])

  // Aggregate stats from our own backend — polled so the demo feels live.
  useEffect(() => {
    let active = true
    const load = () => {
      fetch('/api/stats')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: StatsSummary) => {
          if (active) {
            setStats(data)
            setError(null)
          }
        })
        .catch((err) => {
          if (active) setError(String(err))
        })
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  if (!ctx || !stats) return <main>Loading…</main>

  return (
    <main className="dash">
      <header className="dash-head">
        <h1>Statistics</h1>
        <p className="dash-sub">
          AI vs. translator quality for{' '}
          <strong>{projectName ?? `project ${ctx.projectId}`}</strong>
        </p>
      </header>

      {error && <p className="dash-error">Couldn’t reach the stats server: {error}</p>}

      <section className="dash-gauges">
        <AccuracyCard label="AI accuracy" color={AI_COLOR} stats={stats.ai} />
        <AccuracyCard label="Translator accuracy" color={HUMAN_COLOR} stats={stats.human} />
      </section>

      <p className="dash-note">
        Accuracy = share of an author’s translations that were approved (reviewed) rather
        than corrected afterwards.
      </p>

      <section className="dash-cards">
        <Stat label="AI translations" value={stats.ai.produced} color={AI_COLOR} />
        <Stat label="Human translations" value={stats.human.produced} color={HUMAN_COLOR} />
        <Stat label="AI fixes by humans" value={stats.ai.corrected} />
        <Stat label="Keys created" value={stats.keys.created} />
        <Stat label="Keys deleted" value={stats.keys.deleted} />
      </section>

      <section className="dash-chart">
        <div className="dash-chart-head">
          <h2>Translation edits · last {stats.timelineDays} days</h2>
          <Legend />
        </div>
        <TimelineChart timeline={stats.timeline} />
      </section>
    </main>
  )
}

function AccuracyCard({
  label,
  color,
  stats,
}: {
  label: string
  color: string
  stats: OriginStats
}) {
  const ratio = stats.accuracy ?? 0
  return (
    <div className="gauge">
      <div className="gauge-top">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value" style={{ color }}>
          {pct(stats.accuracy)}
        </span>
      </div>
      <div className="gauge-track">
        <div
          className="gauge-fill"
          style={{ width: `${Math.round(ratio * 100)}%`, background: color }}
        />
      </div>
      <div className="gauge-foot">
        {stats.approved} approved · {stats.corrected} corrected
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="stat">
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function Legend() {
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: AI_COLOR }} /> AI
      </span>
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: HUMAN_COLOR }} /> Human
      </span>
    </div>
  )
}

const CHART_HEIGHT = 120
const BAR_GAP = 3

function TimelineChart({ timeline }: { timeline: StatsSummary['timeline'] }) {
  const max = useMemo(
    () => Math.max(1, ...timeline.map((d) => d.ai + d.human)),
    [timeline]
  )
  const total = timeline.reduce((s, d) => s + d.ai + d.human, 0)
  const barWidth = 100 / timeline.length

  if (total === 0) {
    return (
      <p className="dash-empty">
        No translation activity yet. Edit a few translations in this project — the chart
        updates within {POLL_MS / 1000}s.
      </p>
    )
  }

  return (
    <svg
      className="chart"
      viewBox={`0 0 100 ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${total} translation edits over the last ${timeline.length} days`}
    >
      {timeline.map((d, i) => {
        const aiH = (d.ai / max) * CHART_HEIGHT
        const humanH = (d.human / max) * CHART_HEIGHT
        const x = i * barWidth
        const w = barWidth - BAR_GAP / 10
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={CHART_HEIGHT - humanH}
              width={w}
              height={humanH}
              fill={HUMAN_COLOR}
            >
              <title>{`${d.day}: ${d.human} human`}</title>
            </rect>
            <rect
              x={x}
              y={CHART_HEIGHT - humanH - aiH}
              width={w}
              height={aiH}
              fill={AI_COLOR}
            >
              <title>{`${d.day}: ${d.ai} AI`}</title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}
