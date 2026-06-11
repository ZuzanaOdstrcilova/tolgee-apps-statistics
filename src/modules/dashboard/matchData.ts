import { useEffect, useMemo, useState } from 'react'

/**
 * Data layer for the dashboard's "AI translation accuracy" tab. Fetches real
 * match scores from our server's `GET /api/match` (computed there via the
 * install API key — see server/match.ts).
 *
 * Fetching is done ONE LANGUAGE AT A TIME and aggregated as each response
 * lands, so the dashboard can render progressively (a language's bar appears
 * the moment its scores are ready, while the rest still compute). The response
 * shape mirrors `MatchResponse` in server/match.ts.
 */

export type BucketKey = 'b100' | 'b9990' | 'b8980' | 'b7970' | 'bno'

export type BucketAgg = { words: number; keys: number; langs: number }

export type MatchTotals = {
  buckets: Record<BucketKey, BucketAgg>
  reviewedWords: number
  reviewedKeys: number
  notReviewedWords: number
  notReviewedKeys: number
  langCount: number
}

export type MatchPerLang = {
  tag: string
  name: string
  flag: string
  total: number
  b100: number
  b9990: number
  b8980: number
  b7970: number
  bno: number
  notReviewed: number
  b100_pct: number
  b9990_pct: number
  b8980_pct: number
  b7970_pct: number
  bno_pct: number
  notReviewed_pct: number
}

export type MatchResponse = {
  ok: true
  range: RangeParam
  generatedAt: string
  totals: MatchTotals
  avgMatchScore: number
  reviewedPct: number
  perLang: MatchPerLang[]
}

type RangeParam = 'last1min' | 'last5min' | 'last1h' | 'today' | 'last7' | 'last30' | 'all'

/** UI period label → /api/match `range` query value. */
export const RANGE_TO_PARAM: Record<string, RangeParam> = {
  'All time': 'all',
  'Last minute': 'last1min',
  'Last 5 minutes': 'last5min',
  'Last hour': 'last1h',
  Today: 'today',
  'Last week': 'last7',
  'Last 30 days': 'last30',
}

/** Period labels in display order (for the dashboard + panel pickers). */
export const RANGE_LABELS = Object.keys(RANGE_TO_PARAM)

/**
 * `{origin}/projects/{id}` — base for deep-linking into Tolgee's own pages
 * (opened in a new tab). The apps host (the iframe's parent, read from
 * `document.referrer`) serves the project pages too. Empty if unavailable.
 */
export const tolgeeProjectUrl = (projectId?: number): string => {
  if (projectId == null) return ''
  try {
    const origin = document.referrer ? new URL(document.referrer).origin : ''
    return origin ? `${origin}/projects/${projectId}` : ''
  } catch {
    return ''
  }
}

/** A counter that bumps whenever the window regains focus — include it in an
 *  effect's deps to refetch after the user returns from a Tolgee editor tab. */
export function useFocusKey(): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const bump = () => setKey((k) => k + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [])
  return key
}

const zeroBuckets = (): Record<BucketKey, BucketAgg> => ({
  b100: { words: 0, keys: 0, langs: 0 },
  b9990: { words: 0, keys: 0, langs: 0 },
  b8980: { words: 0, keys: 0, langs: 0 },
  b7970: { words: 0, keys: 0, langs: 0 },
  bno: { words: 0, keys: 0, langs: 0 },
})

const BUCKET_KEYS: BucketKey[] = ['b100', 'b9990', 'b8980', 'b7970', 'bno']

const emptyTotals = (): MatchTotals => ({
  buckets: zeroBuckets(),
  reviewedWords: 0,
  reviewedKeys: 0,
  notReviewedWords: 0,
  notReviewedKeys: 0,
  langCount: 0,
})

export type MatchAgg = {
  perLang: MatchPerLang[]
  totals: MatchTotals
  avgMatchScore: number
  reviewedPct: number
}

/** Combine per-language responses (in the given tag order) into one aggregate. */
const combine = (ordered: MatchResponse[]): MatchAgg => {
  const totals = emptyTotals()
  let scoreWeighted = 0
  const perLang: MatchPerLang[] = []
  for (const r of ordered) {
    for (const k of BUCKET_KEYS) {
      totals.buckets[k].words += r.totals.buckets[k].words
      totals.buckets[k].keys += r.totals.buckets[k].keys
      totals.buckets[k].langs += r.totals.buckets[k].langs
    }
    totals.reviewedWords += r.totals.reviewedWords
    totals.reviewedKeys += r.totals.reviewedKeys
    totals.notReviewedWords += r.totals.notReviewedWords
    totals.notReviewedKeys += r.totals.notReviewedKeys
    totals.langCount += r.totals.langCount
    scoreWeighted += r.avgMatchScore * r.totals.reviewedWords
    perLang.push(...r.perLang)
  }
  const denom = totals.reviewedWords + totals.notReviewedWords
  return {
    perLang,
    totals,
    avgMatchScore: totals.reviewedWords === 0 ? 0 : Math.round(scoreWeighted / totals.reviewedWords),
    reviewedPct: denom === 0 ? 0 : Math.round((100 * totals.reviewedWords) / denom),
  }
}

export type UseMatchData = MatchAgg & {
  /** Tags still computing — render skeletons for these. */
  pendingTags: string[]
  loading: boolean
  error: string | null
}

/**
 * Fetches /api/match per selected language and aggregates progressively.
 * Re-runs whenever the filters change or `generateKey` is bumped (the
 * "Generate" button). Disabled (returns empty) in the standalone preview,
 * which uses the dashboard's built-in mock instead.
 */
export function useMatchData(
  projectId: number | undefined,
  langs: string[],
  rangeLabel: string,
  enabled: boolean,
  generateKey: number
): UseMatchData {
  const rangeParam = RANGE_TO_PARAM[rangeLabel] ?? 'last30'
  const langKey = langs.join(',')
  const [responses, setResponses] = useState<Record<string, MatchResponse>>({})
  const [pending, setPending] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || projectId == null || langs.length === 0) {
      setResponses({})
      setPending([])
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setResponses({})
    setError(null)
    setPending(langs.slice())

    for (const tag of langs) {
      fetch(`/api/match?projectId=${projectId}&langs=${tag}&range=${rangeParam}`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: MatchResponse) => {
          if (ctrl.signal.aborted) return
          if (d && d.ok) setResponses((prev) => ({ ...prev, [tag]: d }))
          setPending((prev) => prev.filter((t) => t !== tag))
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return // superseded by a newer fetch
          if (e instanceof Error && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : String(e))
          setPending((prev) => prev.filter((t) => t !== tag))
        })
    }
    return () => ctrl.abort()
    // langKey/rangeParam capture langs+range; generateKey forces a refetch.
  }, [enabled, projectId, langKey, rangeParam, generateKey])

  const agg = useMemo(
    () => combine(langs.map((t) => responses[t]).filter(Boolean) as MatchResponse[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [responses, langKey]
  )

  return { ...agg, pendingTags: pending, loading: pending.length > 0, error }
}
