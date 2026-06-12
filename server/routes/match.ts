import type { Express, Request, Response } from 'express'
import { computeMatch, emptyMatch, type MatchRange, type MatchResponse } from '../match'
import { tolgeeReady } from '../tolgeeApi'
import { charLevenshteinScore, wordTokenScore } from '../similarity'

// Stale-while-revalidate response cache. Once a (project, langs, range, scorer)
// query is computed, identical requests are served from here INSTANTLY — even
// when stale — and a stale entry triggers a background recompute. So the demo is
// always fast (no cold 3s wait, no rate-limit failure shown to the user) and the
// numbers refresh on a later view ("can update later"). Only the very first load
// of a query computes synchronously, and we warm those up before the demo.
type CacheEntry = { body: MatchResponse; at: number; dirty: boolean; revalidating: boolean }
const responseCache = new Map<string, CacheEntry>()
// Auto-revalidate entries older than this even without an edit (belt-and-braces).
const FRESH_TTL = 600_000

/**
 * Mark cached responses STALE (called from webhooks when translations change).
 * They keep being served immediately; the next request refreshes them in the
 * background — so edits show up shortly without ever making a view go slow.
 */
export const invalidateMatchResponses = (): void => {
  for (const e of responseCache.values()) e.dirty = true
}

// Recompute a key in the background and swap the cache entry when done. Failures
// (e.g. a Tolgee rate-limit) keep the existing stale entry — never throws.
const revalidate = (
  key: string,
  projectId: number,
  tags: string[],
  range: MatchRange,
  scorer: typeof wordTokenScore
): void => {
  const e = responseCache.get(key)
  if (e?.revalidating) return // one in-flight refresh per key is enough
  if (e) e.revalidating = true
  computeMatch(projectId, tags, range, scorer)
    .then((body) => responseCache.set(key, { body, at: Date.now(), dirty: false, revalidating: false }))
    .catch(() => {
      const cur = responseCache.get(key)
      if (cur) cur.revalidating = false
    })
}

/**
 * GET /api/match?projectId=&langs=cs,de&range=today|last7|last30|all[&scorer=word|char]
 *
 * Computes real AI-vs-reviewed match scores per language for the dashboard.
 * Authenticated server-side via the install X-API-Key (see tolgeeApi.ts), so
 * the dashboard iframe just reads the aggregate. Inherits the SDK CORS headers
 * applied in server/index.ts.
 */
const RANGES: readonly MatchRange[] = [
  'last1min',
  'last5min',
  'last1h',
  'today',
  'last7',
  'last30',
  'all',
]

const normalizeRange = (raw: unknown): MatchRange => {
  const v = String(raw ?? 'last30')
  return (RANGES as readonly string[]).includes(v) ? (v as MatchRange) : 'last30'
}

export const registerMatchRoute = (app: Express): void => {
  app.get('/api/match', async (req: Request, res: Response) => {
    if (!tolgeeReady()) {
      res.status(503).json({ ok: false, error: 'install record missing — run `npm run register`' })
      return
    }
    const projectId = Number(req.query.projectId)
    if (!Number.isFinite(projectId)) {
      res.status(400).json({ ok: false, error: 'projectId query param required' })
      return
    }
    const tags = String(req.query.langs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const range = normalizeRange(req.query.range)
    const scorer = req.query.scorer === 'char' ? charLevenshteinScore : wordTokenScore

    if (tags.length === 0) {
      res.json(emptyMatch(range))
      return
    }
    const scorerName = req.query.scorer === 'char' ? 'char' : 'word'
    const key = `${projectId}|${[...tags].sort().join(',')}|${range}|${scorerName}`

    const hit = responseCache.get(key)
    if (hit) {
      // Always serve instantly. If stale (edited, or past the TTL), refresh in
      // the background so the next view is fresh — this view stays fast.
      res.json(hit.body)
      if (hit.dirty || Date.now() - hit.at >= FRESH_TTL) {
        revalidate(key, projectId, tags, range, scorer)
      }
      return
    }
    // First-ever load of this query → compute synchronously (warmed pre-demo).
    try {
      const body = await computeMatch(projectId, tags, range, scorer)
      responseCache.set(key, { body, at: Date.now(), dirty: false, revalidating: false })
      res.json(body)
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
