import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTolgeeApp,
  createTolgeeAppClient,
  type TolgeeApp,
  type TolgeeAppSelection,
} from '@tolgee/apps-sdk/browser'
import { ThemeProvider } from '@mui/material/styles'
import { buildTolgeeTheme } from '../../theme/tolgeeTheme'
import { PanelView, PanelSkeleton, toDonut, DONUT, type TipItem } from '../dashboard/matchView'
import { RANGE_TO_PARAM, type MatchResponse } from '../dashboard/matchData'

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
  // Period filter — applies immediately on change. Defaults to all time.
  const [range, setRange] = useState('All time')
  // Project languages (for base detection + name/flag of the focused language).
  const [langs, setLangs] = useState<{ tag: string; name: string; flag: string; base: boolean }[]>(
    []
  )
  // "Improve AI accuracy" statuses from /api/ai-context (undefined → mock).
  const [tips, setTips] = useState<TipItem[]>()

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
      const apiUrl =
        ctx.apiUrl || (document.referrer ? new URL(document.referrer).origin : '')
      if (!apiUrl) return
      createTolgeeAppClient({ ...ctx, apiUrl })
        .GET('/v2/projects/{projectId}/languages', {
          params: { path: { projectId: ctx.projectId }, query: { size: 1000 } },
        })
        .then(({ data }) => {
          const list = data?._embedded?.languages
          if (list)
            setLangs(
              list.map((l) => ({ tag: l.tag, name: l.name, flag: l.flagEmoji ?? '', base: l.base }))
            )
        })
        .catch(() => {})
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
  const focused = langs.find((l) => l.tag === tag)
  useEffect(() => {
    if (STANDALONE || projectId == null || !tag) {
      setMatch(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    const rangeParam = RANGE_TO_PARAM[range] ?? 'all'
    fetch(`/api/match?projectId=${projectId}&langs=${tag}&range=${rangeParam}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MatchResponse | null) => {
        setMatch(d && d.ok ? d : null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name !== 'AbortError') setLoading(false)
      })
    return () => ctrl.abort()
  }, [projectId, tag, range])

  const focusedIsBase = focused?.base === true

  // AI-context status for the "Improve AI accuracy" links (real /api/ai-context).
  useEffect(() => {
    if (STANDALONE || projectId == null) return
    const ctrl = new AbortController()
    fetch(`/api/ai-context?projectId=${projectId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          ok?: boolean
          descriptionSet?: boolean
          languageNotesSet?: number
          languageNotesTotal?: number
          customPrompt?: boolean
        } | null) => {
          if (!d || !d.ok) return
          setTips([
            {
              name: 'Project description',
              stat: d.descriptionSet ? 'Set' : 'Not set yet',
              icon: 'edit',
            },
            {
              name: 'Language notes',
              stat: `${d.languageNotesSet ?? 0} of ${d.languageNotesTotal ?? 0} set`,
              icon: 'edit',
            },
            {
              name: 'AI playground',
              stat: d.customPrompt ? 'Custom prompt' : 'Default prompt',
              icon: 'open',
            },
          ])
        }
      )
      .catch(() => {})
    return () => ctrl.abort()
  }, [projectId])

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
        range={range}
        onRangeChange={setRange}
        donutData={DONUT}
        notReviewedWords={436}
        avgScore={81.7}
        reviewedScore={62.8}
      />
    )
  } else if (!tag) {
    content = (
      <p className="panel-hint">Focus a translation to see its language's AI match scores.</p>
    )
  } else if (focusedIsBase) {
    content = <p className="panel-hint">No AI statistics for the base language.</p>
  } else if (loading && !match) {
    content = <PanelSkeleton />
  } else if (!match) {
    content = <p className="panel-hint">No AI match data for this language yet.</p>
  } else {
    const lang = match.perLang[0]
    content = (
      <PanelView
        flag={focused?.flag ?? lang?.flag ?? ''}
        name={focused?.name ?? lang?.name ?? tag}
        range={range}
        onRangeChange={setRange}
        donutData={toDonut(match.totals)}
        notReviewedWords={match.totals.notReviewedWords}
        avgScore={match.avgMatchScore}
        reviewedScore={match.reviewedPct}
        tips={tips}
      />
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <div ref={containerRef}>{content}</div>
    </ThemeProvider>
  )
}
