import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTolgeeApp,
  type TolgeeApp,
  type TolgeeAppSelection,
} from '@tolgee/apps-sdk/browser'
import { ThemeProvider } from '@mui/material/styles'
import { buildTolgeeTheme } from '../../theme/tolgeeTheme'
import {
  PanelView,
  toDonut,
  DONUT,
  DONUT_TOTAL,
  DONUT_KEYS,
} from '../dashboard/matchView'
import type { MatchResponse } from '../dashboard/matchData'

const STANDALONE = window.parent === window

// Translation tools panel: AI match-score summary for the focused language,
// over ALL TIME. Reuses the dashboard's match components (matchView/PanelView)
// and our /api/match endpoint. Standalone preview shows mock data.
export default function ToolsPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<TolgeeApp | null>(null)
  const [selection, setSelection] = useState<TolgeeAppSelection>({})
  const [projectId, setProjectId] = useState<number>()
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // Follow the OS light/dark (Tolgee's "system") for the MUI theme + CSS vars.
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])
  const theme = useMemo(() => buildTolgeeTheme(mode), [mode])

  useEffect(() => {
    if (STANDALONE) return
    const app = createTolgeeApp()
    appRef.current = app
    app.context.then((ctx) => {
      setProjectId(ctx.projectId)
      setSelection(ctx.selection)
    })
    const off = app.onSelectionChanged(setSelection)
    return () => {
      off()
      app.dispose()
      appRef.current = null
    }
  }, [])

  // Fetch real match scores for the focused language (all time).
  const tag = selection.languageTag
  useEffect(() => {
    if (STANDALONE || projectId == null || !tag) {
      setMatch(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/match?projectId=${projectId}&langs=${tag}&range=all`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MatchResponse | null) => {
        setMatch(d && d.ok ? d : null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name !== 'AbortError') setLoading(false)
      })
    return () => ctrl.abort()
  }, [projectId, tag])

  // Keep the host iframe sized to the content.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => appRef.current?.resize(el.scrollHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  let content
  if (STANDALONE) {
    content = (
      <PanelView
        flag="🇨🇿"
        name="Czech"
        scope="All time"
        donutData={DONUT}
        totalWords={DONUT_TOTAL}
        totalKeys={DONUT_KEYS}
        langCount={1}
        avgScore={81.7}
        reviewedScore={62.8}
      />
    )
  } else if (!tag) {
    content = (
      <p className="panel-hint">Focus a translation to see its language's AI match scores.</p>
    )
  } else if (loading && !match) {
    content = <p className="panel-hint">Loading…</p>
  } else if (!match) {
    content = <p className="panel-hint">No AI match data for this language yet.</p>
  } else {
    const lang = match.perLang[0]
    content = (
      <PanelView
        flag={lang?.flag ?? ''}
        name={lang?.name ?? tag}
        scope="All time"
        donutData={toDonut(match.totals)}
        totalWords={match.totals.reviewedWords}
        totalKeys={match.totals.reviewedKeys}
        langCount={match.totals.langCount}
        avgScore={match.avgMatchScore}
        reviewedScore={match.reviewedPct}
      />
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <div ref={containerRef}>{content}</div>
    </ThemeProvider>
  )
}
