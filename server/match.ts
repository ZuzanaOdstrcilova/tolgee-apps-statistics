import {
  fetchHistory,
  fetchNotReviewedAi,
  fetchReviewedTranslations,
  getProjectLanguages,
  type ListedTranslation,
} from './tolgeeApi'
import {
  bucketOf,
  countWords,
  DEFAULT_SCORER,
  type BucketKey,
  type Scorer,
} from './similarity'
import { isAiModification } from './aiOrigin'

/**
 * The match pipeline reconstructs, per REVIEWED translation, the text the AI
 * last produced vs. the final reviewed text, scores their similarity, and
 * aggregates per language into the shape the dashboard renders.
 *
 * Data source: per-translation history (`/translations/{id}/history`), which
 * returns ordered revisions carrying text/auto/mtProvider/promptId/state. We
 * authenticate as the app (X-API-Key) — see tolgeeApi.ts.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type MatchRange =
  | 'last1min'
  | 'last5min'
  | 'last1h'
  | 'today'
  | 'last7'
  | 'last30'
  | 'all'


// ---- Per-translation cache -------------------------------------------------

type MatchEntry = {
  /** hash(currentText)+state — unchanged ⇒ skip the history HTTP call. */
  marker: string
  aiText: string
  finalText: string
  score: number
  words: number
  lang: string
  /** unix ms the translation reached REVIEWED (0 if unknown). */
  reviewedAt: number
  /** false ⇒ purely human, excluded from AI accuracy. */
  isAi: boolean
}

const cache = new Map<number, MatchEntry>()

const djb2 = (s: string): number => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h
}
const makeMarker = (text: string, state: string): string => `${djb2(text)}|${state}`

/** Drop a cached entry so the next compute refetches its history. */
export const invalidateMatch = (translationId: number): void => {
  cache.delete(translationId)
}

// ---- Concurrency-limited fetch --------------------------------------------

const runPool = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const out = new Array<R>(items.length)
  let idx = 0
  const worker = async (): Promise<void> => {
    while (idx < items.length) {
      const i = idx++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
  return out
}

// ---- Resolve one reviewed translation -------------------------------------

const resolveEntry = async (
  projectId: number,
  t: ListedTranslation,
  scorer: Scorer
): Promise<MatchEntry> => {
  const marker = makeMarker(t.text, t.state)
  const cached = cache.get(t.translationId)
  if (cached && cached.marker === marker) return cached

  const revs = await fetchHistory(projectId, t.translationId)
  const ordered = [...revs].reverse() // oldest → newest

  // Walk forward, carrying the running text so AI revisions that only flip
  // metadata (text.new undefined) still resolve to the text AI left in place.
  // We measure "what AI produced vs what the human approved", so the relevant
  // AI text is the most recent AI output AT OR BEFORE the final review — not a
  // later AI re-run, and not an AI revision the reviewer never saw.
  let currentText = ''
  let lastAiText: string | null = null // most recent AI output seen so far
  let aiTextAtReview: string | null = null // lastAiText captured at each review
  let reviewedAt = 0
  let sawReview = false
  for (const r of ordered) {
    const m = r.modifications ?? {}
    if (typeof m.text?.new === 'string') currentText = m.text.new
    if (isAiModification(m)) lastAiText = currentText
    if (m.state?.new === 'REVIEWED') {
      reviewedAt = r.timestamp
      aiTextAtReview = lastAiText
      sawReview = true
    }
  }

  // Prefer the AI text as of the last review. If no REVIEWED transition is in
  // the fetched history (reviewed-at-create, or it scrolled past page 0), fall
  // back to the most recent AI text + the newest revision timestamp.
  const aiText = sawReview ? aiTextAtReview : lastAiText
  if (!sawReview && ordered.length > 0) {
    reviewedAt = ordered[ordered.length - 1].timestamp
  }

  const finalText = t.text
  // Only count it as AI work when we actually reconstructed the AI text. An
  // empty aiText against a non-empty final means the AI output predates the
  // recorded history — we can't compare, so exclude rather than score a false 0%.
  const isAi = aiText !== null && (aiText !== '' || finalText === '')

  const entry: MatchEntry = {
    marker,
    aiText: aiText ?? '',
    finalText,
    score: isAi ? scorer(aiText as string, finalText) : 0,
    words: countWords(finalText),
    lang: t.tag,
    reviewedAt,
    isAi,
  }
  cache.set(t.translationId, entry)
  return entry
}

// ---- Aggregation -----------------------------------------------------------

type Buckets = Record<BucketKey, number>
const emptyBuckets = (): Buckets => ({ b100: 0, b9990: 0, b8980: 0, b7970: 0, bno: 0 })

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

const MS_PER_MIN = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MIN

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

const pct = (part: number, total: number): number =>
  total === 0 ? 0 : (part / total) * 100

const buildRow = (
  tag: string,
  name: string,
  flag: string,
  b: Buckets,
  notReviewed: number
): MatchLangRow => {
  const total = b.b100 + b.b9990 + b.b8980 + b.b7970 + b.bno + notReviewed
  return {
    tag,
    name,
    flag,
    total,
    ...b,
    notReviewed,
    b100_pct: pct(b.b100, total),
    b9990_pct: pct(b.b9990, total),
    b8980_pct: pct(b.b8980, total),
    b7970_pct: pct(b.b7970, total),
    bno_pct: pct(b.bno, total),
    notReviewed_pct: pct(notReviewed, total),
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

export const computeMatch = async (
  projectId: number,
  tags: readonly string[],
  range: MatchRange,
  scorer: Scorer = DEFAULT_SCORER
): Promise<MatchResponse> => {
  const langs = await getProjectLanguages(projectId)
  const start = rangeStartMs(range)

  const totalBuckets = zeroBucketAggs()
  const bucketLangs: Record<BucketKey, Set<string>> = {
    b100: new Set(), b9990: new Set(), b8980: new Set(), b7970: new Set(), bno: new Set(),
  }
  const langsWithReviewedAi = new Set<string>()
  let reviewedWordsAll = 0
  let reviewedKeysAll = 0
  let notReviewedWordsAll = 0
  let notReviewedKeysAll = 0
  let scoreSum = 0
  let wordSum = 0
  const perLang: MatchLangRow[] = []

  for (const tag of tags) {
    const lang = langs.byTag.get(tag)
    if (!lang || lang.base) continue // base language has no AI translations

    const reviewed = await fetchReviewedTranslations(projectId, tag)
    // Isolate per-translation failures: one bad /history fetch (deleted row,
    // transient 5xx, non-JSON body) drops just that entry, never the request.
    const entries = await runPool(reviewed, 8, (t) =>
      resolveEntry(projectId, t, scorer).catch((err) => {
        console.warn(`[match] history failed for translation ${t.translationId}:`, err)
        return null
      })
    )
    const notReviewed = await fetchNotReviewedAi(projectId, tag)
    const notReviewedWords = notReviewed.reduce((s, t) => s + countWords(t.text), 0)

    const b = emptyBuckets()
    let reviewedKeys = 0
    for (const e of entries) {
      if (!e || !e.isAi) continue // failed fetch or purely human → not AI's work
      if (e.reviewedAt < start) continue // outside the selected time range
      const key = bucketOf(e.score)
      b[key] += e.words
      totalBuckets[key].words += e.words
      totalBuckets[key].keys += 1
      bucketLangs[key].add(tag)
      reviewedKeys += 1
      scoreSum += e.score * e.words
      wordSum += e.words
    }

    const reviewedWords = b.b100 + b.b9990 + b.b8980 + b.b7970 + b.bno
    reviewedWordsAll += reviewedWords
    reviewedKeysAll += reviewedKeys
    notReviewedWordsAll += notReviewedWords
    notReviewedKeysAll += notReviewed.length
    if (reviewedKeys > 0) langsWithReviewedAi.add(tag)

    perLang.push(buildRow(tag, lang.name, lang.flag, b, notReviewedWords))
  }

  for (const k of Object.keys(totalBuckets) as BucketKey[]) {
    totalBuckets[k].langs = bucketLangs[k].size
  }

  return {
    ok: true,
    range,
    generatedAt: new Date().toISOString(),
    totals: {
      buckets: totalBuckets,
      reviewedWords: reviewedWordsAll,
      reviewedKeys: reviewedKeysAll,
      notReviewedWords: notReviewedWordsAll,
      notReviewedKeys: notReviewedKeysAll,
      langCount: langsWithReviewedAi.size,
    },
    avgMatchScore: wordSum === 0 ? 0 : Math.round(scoreSum / wordSum),
    reviewedPct:
      reviewedWordsAll + notReviewedWordsAll === 0
        ? 0
        : Math.round((100 * reviewedWordsAll) / (reviewedWordsAll + notReviewedWordsAll)),
    perLang,
  }
}
