import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  createTolgeeApp,
  createTolgeeAppClient,
  type TolgeeApp,
  type TolgeeAppSelection,
} from '@tolgee/apps-sdk/browser'
import { Flag } from '../../lib/flag'
import { FONT, SANS } from '../../theme/typography'
import { ICON } from '../../theme/icons'
import { ThemeHost } from '../contributor/view'
import { PanelTabs } from '../toolsPanel'
import { ContributorPanel } from '../contributor/Panel'
import { useContributorMe, MOCK_MEMBER } from '../contributor/data'
import {
  COL,
  MatchBar,
  scoreColor,
  avgFromBuckets,
  type DonutSlice,
} from '../dashboard/matchView'
import type { MatchPerLang, MatchResponse } from '../dashboard/matchData'

const STANDALONE = window.parent === window

// The "empty" translation-tools panel (translation-tools-panel-empty): shown in
// the translations view when NO cell is selected. Unlike the per-cell panel
// (one focused language), this shows AI accuracy for ALL languages currently
// displayed in the view (selection.selectedLanguages, alpha.7) — one compact row
// per language — plus the same Contributor card.

type Lang = { tag: string; name: string; flag: string; base: boolean }

// A per-language row's score buckets as MatchBar slices (value + colour + name,
// the name shows in the segment's hover tooltip).
const rowSlices = (r: MatchPerLang): DonutSlice[] => [
  { name: '100% Match', value: r.b100, color: COL.c100, keys: 0, langs: 0 },
  { name: '99–90%', value: r.b9990, color: COL.c9990, keys: 0, langs: 0 },
  { name: '89–80%', value: r.b8980, color: COL.c8980, keys: 0, langs: 0 },
  { name: '79–70%', value: r.b7970, color: COL.c7970, keys: 0, langs: 0 },
  { name: 'Less than 70%', value: r.bno, color: COL.cno, keys: 0, langs: 0 },
]
const reviewedWordsOf = (r: MatchPerLang): number =>
  r.b100 + r.b9990 + r.b8980 + r.b7970 + r.bno

/** One language row: flag + name + avg score, with the match-score bar below. */
function LangRow({ r }: { r: MatchPerLang }) {
  const reviewed = reviewedWordsOf(r)
  const avg = avgFromBuckets(r)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Flag emoji={r.flag} size={ICON.sm} />
        <span style={{ ...FONT.label, color: COL.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.name}
        </span>
        {reviewed === 0 ? (
          <span style={{ ...FONT.micro, color: COL.faint }}>—</span>
        ) : (
          <span style={{ ...FONT.label, fontWeight: 700, color: scoreColor(avg) }}>{avg}%</span>
        )}
      </div>
      <MatchBar data={rowSlices(r)} notReviewedWords={r.notReviewed} />
    </div>
  )
}

// Loading placeholder mirroring the per-language list (shimmer via App.css .s-skel).
function AiListSkeleton() {
  const cell = (style: CSSProperties) => <div className="s-skel" style={style} aria-hidden />
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {cell({ width: 120, height: 13, borderRadius: 6 })}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {cell({ width: ICON.sm, height: ICON.sm, borderRadius: 4 })}
            {cell({ flex: 1, height: 12, borderRadius: 6 })}
            {cell({ width: 34, height: 12, borderRadius: 6 })}
          </div>
          {cell({ height: 16, borderRadius: 8 })}
        </div>
      ))}
    </div>
  )
}

function AiAllLanguages({
  rows,
  count,
  onRegenerate,
  loading = false,
}: {
  rows: MatchPerLang[]
  count: number
  onRegenerate?: () => void
  loading?: boolean
}) {
  const withData = rows.filter((r) => r.total > 0)
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...FONT.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          AI accuracy
        </span>
        <span style={{ ...FONT.micro, color: COL.dim }}>
          {count} {count === 1 ? 'language' : 'languages'} shown
        </span>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={loading}
            style={{
              marginLeft: 'auto',
              appearance: 'none',
              cursor: loading ? 'default' : 'pointer',
              ...FONT.micro,
              fontWeight: 600,
              color: loading ? COL.faint : COL.accent,
              background: 'transparent',
              border: `1px solid ${loading ? COL.line : COL.accent}`,
              borderRadius: 8,
              padding: '4px 10px',
            }}
          >
            {loading ? 'Loading…' : 'Regenerate'}
          </button>
        )}
      </div>
      {withData.length === 0 ? (
        <p style={{ ...FONT.caption, color: COL.faint, margin: 0 }}>
          No AI-translated content for the languages shown in this view yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {withData.map((r) => (
            <LangRow key={r.tag} r={r} />
          ))}
        </div>
      )}
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', ...FONT.micro, color: COL.dim }}>
        {[
          ['100%', COL.c100],
          ['99–90', COL.c9990],
          ['89–80', COL.c8980],
          ['79–70', COL.c7970],
          ['<70', COL.cno],
          ['Not reviewed', COL.notReviewed],
        ].map(([label, c]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c as string, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// Mock per-language rows for the STANDALONE local preview.
const mockRow = (tag: string, name: string, flag: string, b: number[], nr: number): MatchPerLang => ({
  tag, name, flag,
  total: b.reduce((s, x) => s + x, 0) + nr,
  b100: b[0], b9990: b[1], b8980: b[2], b7970: b[3], bno: b[4], notReviewed: nr,
  b100_pct: 0, b9990_pct: 0, b8980_pct: 0, b7970_pct: 0, bno_pct: 0, notReviewed_pct: 0,
})
const MOCK_ROWS: MatchPerLang[] = [
  mockRow('de', 'German', '🇩🇪', [120, 60, 20, 10, 8], 40),
  mockRow('fr', 'French', '🇫🇷', [90, 80, 10, 5, 4], 30),
  mockRow('cs', 'Czech', '🇨🇿', [40, 30, 25, 15, 20], 60),
  mockRow('sk', 'Slovak', '🇸🇰', [20, 15, 10, 12, 25], 50),
]

function EmptyPanelContent() {
  const appRef = useRef<TolgeeApp | null>(null)
  const [projectId, setProjectId] = useState<number>()
  const [token, setToken] = useState<string>()
  const [selection, setSelection] = useState<TolgeeAppSelection>({})
  const [langs, setLangs] = useState<Lang[]>([])
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'ai' | 'contributor'>('ai')
  // Manual fetch: load once, then only on Regenerate — so the heavy all-language
  // compute doesn't refire on every selection change and trip Tolgee's rate limit.
  const [genKey, setGenKey] = useState(0)
  const targetTagsRef = useRef<string[]>([])
  const initedRef = useRef(false)

  // Context + live selection (which languages are shown in the view).
  useEffect(() => {
    if (STANDALONE) return
    const app = createTolgeeApp()
    appRef.current = app
    app.context.then((ctx) => {
      setProjectId(ctx.projectId)
      setToken(ctx.token)
      setSelection(ctx.selection)
      const apiUrl = ctx.apiUrl || (document.referrer ? new URL(document.referrer).origin : '')
      if (!apiUrl) return
      createTolgeeAppClient({ ...ctx, apiUrl })
        .GET('/v2/projects/{projectId}/languages', {
          params: { path: { projectId: ctx.projectId }, query: { size: 1000 } },
        })
        .then(({ data }) => {
          const list = data?._embedded?.languages
          if (list) setLangs(list.map((l) => ({ tag: l.tag, name: l.name, flag: l.flagEmoji ?? '', base: l.base })))
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

  // Target languages: the shown ones (minus base), else all non-base project langs.
  const baseTags = useMemo(() => new Set(langs.filter((l) => l.base).map((l) => l.tag)), [langs])
  const targetTags = useMemo(() => {
    const shown = selection.selectedLanguages
    const pick = shown && shown.length ? shown : langs.filter((l) => !l.base).map((l) => l.tag)
    return pick.filter((t) => !baseTags.has(t))
  }, [selection.selectedLanguages, langs, baseTags])

  // Keep the latest target languages without making them a fetch dependency.
  useEffect(() => {
    targetTagsRef.current = targetTags
  }, [targetTags])

  // Auto-load ONCE, when the languages first resolve. After that, refetch only
  // on the Regenerate button (selection changes update the list but don't fetch).
  useEffect(() => {
    if (!initedRef.current && targetTags.length > 0) {
      initedRef.current = true
      setGenKey((k) => k + 1)
    }
  }, [targetTags])

  // Fetch AI match for all target languages — only when genKey changes.
  useEffect(() => {
    if (STANDALONE || projectId == null || genKey === 0) return
    const tags = targetTagsRef.current
    if (tags.length === 0) {
      setMatch(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/match?projectId=${projectId}&langs=${tags.join(',')}&range=all`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MatchResponse | null) => {
        setMatch(d && d.ok ? d : null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name !== 'AbortError') setLoading(false)
      })
    return () => ctrl.abort()
  }, [projectId, genKey])

  const onRegenerate = () => setGenKey((k) => k + 1)
  const me = useContributorMe(projectId, token)

  const aiContent = STANDALONE ? (
    <AiAllLanguages rows={MOCK_ROWS} count={MOCK_ROWS.length} />
  ) : targetTags.length === 0 ? (
    <p style={{ padding: 16, ...FONT.caption, color: COL.faint }}>No languages shown in this view.</p>
  ) : loading && !match ? (
    <AiListSkeleton />
  ) : (
    <AiAllLanguages
      rows={match?.perLang ?? []}
      count={targetTags.length}
      onRegenerate={onRegenerate}
      loading={loading}
    />
  )

  return (
    <div style={{ fontFamily: SANS, color: COL.text }}>
      <PanelTabs value={tab} onChange={setTab} />
      {tab === 'ai' ? (
        aiContent
      ) : (
        <ContributorPanel
          member={STANDALONE ? MOCK_MEMBER : me.member}
          loading={STANDALONE ? false : me.loading}
        />
      )}
    </div>
  )
}

export default function ToolsPanelEmpty() {
  return (
    <ThemeHost>
      <EmptyPanelContent />
    </ThemeHost>
  )
}
