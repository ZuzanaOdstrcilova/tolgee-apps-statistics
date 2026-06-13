import {
  fetchAiMatchLanguages,
  fetchAiMatchSummary,
  type AiMatchBucket,
} from './tolgeeApi'

/**
 * The match pipeline used to reconstruct AI-vs-reviewed scores itself by walking
 * per-translation history (an N+1 over `/translations/{id}/history`). That work
 * now lives in Tolgee: `GET /v2/projects/{id}/ai-match-stats[/languages]` returns
 * the pre-aggregated, word-weighted result with the time range pushed into SQL.
 *
 * This module is now a thin adapter: it calls those two endpoints and maps them
 * into the `MatchResponse` shape the dashboard already renders, so the frontend
 * is unchanged. No history fetches, no per-translation cache, no scoring here.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_MIN = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MIN

export type MatchRange =
  | 'last1min'
  | 'last5min'
  | 'last1h'
  | 'today'
  | 'last7'
  | 'last30'
  | 'all'

export type BucketKey = 'b100' | 'b9990' | 'b8980' | 'b7970' | 'bno'

export type MatchLangRow = {
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

/** Per-bucket aggregate for the donut: word count, key (translation) count,
 *  and how many distinct languages contribute. */
export type BucketAgg = { words: number; keys: number; langs: number }

export type MatchTotals = {
  /** The 5 score buckets (reviewed AI translations only). */
  buckets: Record<BucketKey, BucketAgg>
  reviewedWords: number
  reviewedKeys: number
  notReviewedWords: number
  notReviewedKeys: number
  /** Distinct non-base languages with ≥1 reviewed AI translation. */
  langCount: number
}

export type MatchResponse = {
  ok: true
  range: MatchRange
  generatedAt: string
  totals: MatchTotals
  avgMatchScore: number
  reviewedPct: number
  perLang: MatchLangRow[]
}

/** Start of the selected window as epoch ms (0 = all time), end is always now. */
const rangeStartMs = (range: MatchRange): number => {
  const now = Date.now()
  switch (range) {
    case 'last1min':
      return now - MS_PER_MIN
    case 'last5min':
      return now - 5 * MS_PER_MIN
    case 'last1h':
      return now - MS_PER_HOUR
    case 'today':
      return now - (now % MS_PER_DAY)
    case 'last7':
      return now - 7 * MS_PER_DAY
    case 'last30':
      return now - 30 * MS_PER_DAY
    case 'all':
      return 0
  }
}

const zeroBucketAggs = (): Record<BucketKey, BucketAgg> => ({
  b100: { words: 0, keys: 0, langs: 0 },
  b9990: { words: 0, keys: 0, langs: 0 },
  b8980: { words: 0, keys: 0, langs: 0 },
  b7970: { words: 0, keys: 0, langs: 0 },
  bno: { words: 0, keys: 0, langs: 0 },
})

export const emptyMatch = (range: MatchRange): MatchResponse => ({
  ok: true,
  range,
  generatedAt: new Date().toISOString(),
  totals: {
    buckets: zeroBucketAggs(),
    reviewedWords: 0,
    reviewedKeys: 0,
    notReviewedWords: 0,
    notReviewedKeys: 0,
    langCount: 0,
  },
  avgMatchScore: 0,
  reviewedPct: 0,
  perLang: [],
})

const bucket = (b: AiMatchBucket): BucketAgg => ({ words: b.words, keys: b.keys, langs: b.langs })

/**
 * Fetch the native aggregate for the requested languages + range and map it to
 * the dashboard's `MatchResponse`. The base language is excluded by Tolgee, so
 * passing it simply yields no rows.
 */
export const computeMatch = async (
  projectId: number,
  tags: readonly string[],
  range: MatchRange
): Promise<MatchResponse> => {
  if (tags.length === 0) return emptyMatch(range)
  const reviewedAfter = rangeStartMs(range)

  const [summary, languages] = await Promise.all([
    fetchAiMatchSummary(projectId, tags, reviewedAfter),
    fetchAiMatchLanguages(projectId, tags, reviewedAfter),
  ])

  const perLang: MatchLangRow[] = languages.perLang.map((l) => ({
    tag: l.tag,
    name: l.name ?? '',
    flag: l.flag ?? '',
    total: l.total,
    b100: l.b100,
    b9990: l.b9990,
    b8980: l.b8980,
    b7970: l.b7970,
    bno: l.bno,
    notReviewed: l.notReviewed,
    b100_pct: l.b100Pct,
    b9990_pct: l.b9990Pct,
    b8980_pct: l.b8980Pct,
    b7970_pct: l.b7970Pct,
    bno_pct: l.bnoPct,
    notReviewed_pct: l.notReviewedPct,
  }))

  return {
    ok: true,
    range,
    generatedAt: new Date(summary.generatedAt ?? Date.now()).toISOString(),
    totals: {
      buckets: {
        b100: bucket(summary.b100),
        b9990: bucket(summary.b9990),
        b8980: bucket(summary.b8980),
        b7970: bucket(summary.b7970),
        bno: bucket(summary.bno),
      },
      reviewedWords: summary.reviewedWords,
      reviewedKeys: summary.reviewedKeys,
      notReviewedWords: summary.notReviewedWords,
      notReviewedKeys: summary.notReviewedKeys,
      langCount: summary.langCount,
    },
    avgMatchScore: summary.avgMatchScore,
    reviewedPct: summary.reviewedPct,
    perLang,
  }
}
