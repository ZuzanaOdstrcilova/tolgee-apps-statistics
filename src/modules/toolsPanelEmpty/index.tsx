import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createTolgeeApp, type TolgeeApp, type TolgeeAppSelection } from '@tolgee/apps-sdk/browser'
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
import type { MatchPerLang } from '../dashboard/matchData'

const STANDALONE = window.parent === window

// The "empty" translation-tools panel (translation-tools-panel-empty): shown in
// the translations view when NO cell is selected. Unlike the per-cell panel
// (one focused language), this shows AI accuracy for ALL languages currently
// displayed in the view (selection.selectedLanguages, alpha.7) — one compact row
// per language — plus the same Contributor card.

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

// Per-row loading placeholder: the flag + name show immediately (known), the
// score + bar shimmer until that language resolves (progressive rendering).
function LangRowSkeleton({ name, flag }: { name?: string; flag?: string }) {
  const cell = (style: CSSProperties) => <div className="s-skel" style={style} aria-hidden />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {flag ? <Flag emoji={flag} size={ICON.sm} /> : cell({ width: ICON.sm, height: ICON.sm, borderRadius: 4 })}
        {name ? (
          <span style={{ ...FONT.label, color: COL.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        ) : (
          cell({ flex: 1, height: 12, borderRadius: 6 })
        )}
        {cell({ width: 34, height: 12, borderRadius: 6 })}
      </div>
      {cell({ height: 16, borderRadius: 8 })}
    </div>
  )
}

// Shared style for the Generate/Regenerate button.
const regenBtn = (loading: boolean): CSSProperties => ({
  appearance: 'none',
  cursor: loading ? 'default' : 'pointer',
  ...FONT.micro,
  fontWeight: 600,
  color: loading ? COL.faint : COL.accent,
  background: 'transparent',
  border: `1px solid ${loading ? COL.line : COL.accent}`,
  borderRadius: 8,
  padding: '5px 12px',
})

// Idle state: the cache had nothing for these languages — wait for Generate
// (this panel never computes on its own).
function AiIdle({
  count,
  onRegenerate,
  loading,
}: {
  count: number
  onRegenerate: () => void
  loading: boolean
}) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...FONT.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          AI accuracy
        </span>
        <span style={{ ...FONT.micro, color: COL.dim }}>
          {count} {count === 1 ? 'language' : 'languages'} shown
        </span>
      </div>
      <p style={{ ...FONT.caption, color: COL.dim, margin: 0 }}>
        Generate AI match scores for the languages shown in this view.
      </p>
      <button type="button" onClick={onRegenerate} disabled={loading} style={{ alignSelf: 'flex-start', ...regenBtn(loading) }}>
        {loading ? 'Generating…' : 'Generate'}
      </button>
    </div>
  )
}

// Per-language load state: the resolved row (null = loaded but no data) + whether
// a fetch for this language is in flight (Regenerate).
type LangState = { row: MatchPerLang | null; loading: boolean }

function AiAllLanguages({
  tags,
  byTag,
  onRegenerate,
  computing = false,
}: {
  tags: string[]
  byTag: Record<string, LangState>
  onRegenerate?: () => void
  computing?: boolean
}) {
  const anyLoading = tags.some((t) => byTag[t]?.loading)
  const dataTags = tags.filter((t) => (byTag[t]?.row?.total ?? 0) > 0)
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...FONT.body, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          AI accuracy
        </span>
        <span style={{ ...FONT.micro, color: COL.dim }}>
          {tags.length} {tags.length === 1 ? 'language' : 'languages'} shown
        </span>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={computing}
            style={{ marginLeft: 'auto', ...regenBtn(computing) }}
          >
            {computing ? 'Loading…' : 'Regenerate'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tags.map((tag) => {
          const st = byTag[tag]
          if (st?.loading) {
            return <LangRowSkeleton key={tag} name={tag.toUpperCase()} />
          }
          if (st?.row && st.row.total > 0) return <LangRow key={tag} r={st.row} />
          return null // loaded, no AI data for this language → hide the row
        })}
        {!anyLoading && dataTags.length === 0 && (
          <p style={{ ...FONT.caption, color: COL.faint, margin: 0 }}>
            No AI-translated content for the languages shown in this view yet.
          </p>
        )}
      </div>

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
const MOCK_TAGS = MOCK_ROWS.map((r) => r.tag)
const MOCK_BY_TAG: Record<string, LangState> = Object.fromEntries(
  MOCK_ROWS.map((r) => [r.tag, { row: r, loading: false }])
)

function EmptyPanelContent() {
  const appRef = useRef<TolgeeApp | null>(null)
  const [projectId, setProjectId] = useState<number>()
  const [token, setToken] = useState<string>()
  const [selection, setSelection] = useState<TolgeeAppSelection>({})
  const [tab, setTab] = useState<'ai' | 'contributor'>('ai')
  // Per-language results. Open/refresh READS each language's cache (cacheOnly →
  // never computes → can't crash/rate-limit); Regenerate COMPUTES each language.
  // Rows share the per-language cache with the single panel + dashboard, so they
  // show up far more often, and render progressively as each language resolves.
  const [byTag, setByTag] = useState<Record<string, LangState>>({})
  const [computing, setComputing] = useState(false) // a Regenerate is in flight
  const [everComputed, setEverComputed] = useState(false)
  const [readDone, setReadDone] = useState(false) // initial cache read finished
  const targetTagsRef = useRef<string[]>([])
  const loadCtrlRef = useRef<AbortController | null>(null)

  // Context + live selection (which languages are shown in the view). We do NOT
  // fetch the project languages — the panel takes selection.selectedLanguages
  // directly, so it reads its cache the instant it mounts (no network round-trip
  // on every re-mount when switching from the dashboard). The server skips the
  // base language and the per-language match response already carries name/flag.
  useEffect(() => {
    if (STANDALONE) return
    const app = createTolgeeApp()
    appRef.current = app
    app.context.then((ctx) => {
      setProjectId(ctx.projectId)
      setToken(ctx.token)
      setSelection(ctx.selection)
    })
    const off = app.onSelectionChanged(setSelection)
    return () => {
      off()
      app.dispose()
      appRef.current = null
    }
  }, [])

  // The languages shown in the view. Base is harmless: the server returns no AI
  // data for it, so its row is simply hidden.
  const targetTags = useMemo(() => selection.selectedLanguages ?? [], [selection.selectedLanguages])

  const targetKey = targetTags.join(',')
  useEffect(() => {
    targetTagsRef.current = targetTags
  }, [targetTags])

  // Load each language separately. cacheOnly=true → pure cache READ (no compute,
  // can't crash/rate-limit); false → real COMPUTE (Regenerate). Aborts any
  // previous load; rows fill in progressively as each language resolves.
  const loadAll = (tags: string[], cacheOnly: boolean) => {
    loadCtrlRef.current?.abort()
    const ctrl = new AbortController()
    loadCtrlRef.current = ctrl
    if (!cacheOnly) {
      setComputing(true)
      setEverComputed(true)
      setByTag((prev) => {
        const next = { ...prev }
        for (const t of tags) next[t] = { row: prev[t]?.row ?? null, loading: true }
        return next
      })
    }
    void (async () => {
      for (const tag of tags) {
        if (ctrl.signal.aborted) return
        try {
          const url = `/api/match?projectId=${projectId}&langs=${tag}&range=all${cacheOnly ? '&cacheOnly=1' : ''}`
          const r = await fetch(url, { signal: ctrl.signal })
          const d: { ok?: boolean; perLang?: MatchPerLang[] } | null = r.ok ? await r.json() : null
          const row: MatchPerLang | null = d && d.ok ? d.perLang?.[0] ?? null : null
          setByTag((prev) => ({ ...prev, [tag]: { row, loading: false } }))
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return
          setByTag((prev) => ({ ...prev, [tag]: { row: prev[tag]?.row ?? null, loading: false } }))
        }
      }
      if (ctrl.signal.aborted) return
      if (cacheOnly) setReadDone(true)
      else setComputing(false)
    })()
  }

  // Reactive cache READ when the shown languages settle (no compute → safe).
  useEffect(() => {
    if (STANDALONE || projectId == null) return
    setReadDone(false)
    if (targetTags.length === 0) return
    loadAll(targetTags, true)
    return () => loadCtrlRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, targetKey])

  const onRegenerate = () => {
    if (projectId == null) return
    const tags = targetTagsRef.current
    if (tags.length > 0) loadAll(tags, false)
  }
  const me = useContributorMe(projectId, token)

  const anyData = targetTags.some((t) => (byTag[t]?.row?.total ?? 0) > 0)
  const anyLoading = targetTags.some((t) => byTag[t]?.loading)
  // Cache had nothing AND nothing computed yet → show the Generate prompt.
  const showIdle = readDone && !everComputed && !anyData && !anyLoading

  const aiContent = STANDALONE ? (
    <AiAllLanguages tags={MOCK_TAGS} byTag={MOCK_BY_TAG} computing={false} />
  ) : targetTags.length === 0 ? (
    <p style={{ padding: 16, ...FONT.caption, color: COL.faint }}>No languages shown in this view.</p>
  ) : showIdle ? (
    <AiIdle count={targetTags.length} onRegenerate={onRegenerate} loading={computing} />
  ) : (
    <AiAllLanguages
      tags={targetTags}
      byTag={byTag}
      onRegenerate={onRegenerate}
      computing={computing}
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
