import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTolgeeApp,
  createTolgeeAppClient,
  type TolgeeApp,
  type TolgeeAppSelection,
} from '@tolgee/apps-sdk/browser'
import { ThemeProvider } from '@mui/material/styles'
import { applyHostTheme, buildTolgeeTheme, tolgeeHostTheme } from '../../theme/tolgeeTheme'
import { PanelView, PanelSkeleton, SANS, toDonut, DONUT, type TipItem } from '../dashboard/matchView'
import {
  RANGE_TO_PARAM,
  tolgeeProjectUrl,
  useFocusKey,
  type MatchResponse,
} from '../dashboard/matchData'
import { ContributorPanel } from '../contributor/Panel'
import { useContributorMe, MOCK_MEMBER } from '../contributor/data'
import { FONT } from '../../theme/typography'

const STANDALONE = window.parent === window

// Translation tools panel: AI match-score summary for the focused language,
// over ALL TIME. Reuses the dashboard's match components (matchView/PanelView)
// and our /api/match endpoint. Standalone preview shows mock data.
export default function ToolsPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<TolgeeApp | null>(null)
  const [selection, setSelection] = useState<TolgeeAppSelection>({})
  const [projectId, setProjectId] = useState<number>()
  // Iframe context token — lets the server identify the current user for /me.
  const [token, setToken] = useState<string>()
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  // Two stats in one panel, switched by a tab (mirrors the dashboard).
  const [panelTab, setPanelTab] = useState<'ai' | 'contributor'>('ai')
  // The calling user's own contributor card (real /api/contributors/me).
  const me = useContributorMe(projectId, token)
  // Period filter — applies immediately on change. Defaults to all time.
  const [range, setRange] = useState('All time')
  // Project languages (for base detection + name/flag of the focused language).
  const [langs, setLangs] = useState<{ tag: string; name: string; flag: string; base: boolean }[]>(
    []
  )
  // "Improve AI accuracy" statuses from /api/ai-context (undefined → mock).
  const [tips, setTips] = useState<TipItem[]>()

  // In the Tolgee iframe: follow the HOST theme (set below via onThemeChanged).
  // Standalone preview: follow the OS light/dark.
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  useEffect(() => {
    if (!STANDALONE) return // iframe follows the host theme, not the OS
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setMode(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = mode
    // Standalone has no host: drive the same --tg-color-* path with a mock
    // palette (the iframe gets the real one from the host via onThemeChanged).
    if (STANDALONE) applyHostTheme(tolgeeHostTheme(mode))
  }, [mode])
  const theme = useMemo(() => buildTolgeeTheme(mode), [mode])

  useEffect(() => {
    if (STANDALONE) return
    const app = createTolgeeApp()
    appRef.current = app
    app.context.then((ctx) => {
      setProjectId(ctx.projectId)
      setToken(ctx.token)
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
    const offTheme = app.onThemeChanged((t) => {
      if (!t) return // host may not send a theme (pre-alpha.7) — keep default
      applyHostTheme(t) // sets --tg-color-*, [data-tg-theme], color-scheme
      setMode(t.mode)
    })
    return () => {
      off()
      offTheme()
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
  // Refetched when the user returns from a Tolgee editor tab.
  const focusKey = useFocusKey()
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
          const base = tolgeeProjectUrl(projectId)
          const ctxUrl = base ? `${base}/ai/context-data` : undefined
          const promptsUrl = base ? `${base}/ai/prompts` : undefined
          setTips([
            {
              name: 'Project description',
              desc: 'Describe your project and brand so AI matches your tone, terminology and style.',
              stat: d.descriptionSet ? 'Is set' : 'Not set yet',
              icon: 'open',
              href: ctxUrl,
            },
            {
              name: 'Language notes',
              desc: 'Set tone, formality and terminology per language.',
              stat: `${d.languageNotesSet ?? 0} of ${d.languageNotesTotal ?? 0} set`,
              icon: 'open',
              href: ctxUrl,
            },
            {
              name: 'AI playground',
              desc: 'Fine-tune and test your translation prompt on real data.',
              stat: d.customPrompt ? 'Custom prompt' : 'Default prompt',
              icon: 'open',
              href: promptsUrl,
            },
          ])
        }
      )
      .catch(() => {})
    return () => ctrl.abort()
  }, [projectId, focusKey])

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
      <div ref={containerRef} style={{ fontFamily: SANS, color: 'var(--s-text)' }}>
        <PanelTabs value={panelTab} onChange={setPanelTab} />
        {panelTab === 'ai' ? (
          content
        ) : (
          <ContributorPanel
            member={STANDALONE ? MOCK_MEMBER : me.member}
            loading={STANDALONE ? false : me.loading}
          />
        )}
      </div>
    </ThemeProvider>
  )
}

// Compact two-tab switcher for the narrow panel (AI accuracy / Contributor).
function PanelTabs({
  value,
  onChange,
}: {
  value: 'ai' | 'contributor'
  onChange: (v: 'ai' | 'contributor') => void
}) {
  const tabs = [
    ['ai', 'AI accuracy'],
    ['contributor', 'Contributor'],
  ] as const
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: '6px 16px 0',
        borderBottom: '1px solid var(--s-line)',
      }}
    >
      {tabs.map(([id, label]) => {
        const on = value === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-selected={on}
            role="tab"
            style={{
              appearance: 'none',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              ...FONT.micro,
              fontWeight: 600,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              color: on ? 'var(--s-accent)' : 'var(--s-dim)',
              padding: '8px 8px 10px',
              position: 'relative',
            }}
          >
            {label}
            {on && (
              <span
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  bottom: -1,
                  height: 2,
                  background: 'var(--s-accent)',
                  borderRadius: 2,
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
