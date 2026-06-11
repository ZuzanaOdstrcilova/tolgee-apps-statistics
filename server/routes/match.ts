import type { Express, Request, Response } from 'express'
import { computeMatch, emptyMatch, type MatchRange } from '../match'
import { tolgeeReady } from '../tolgeeApi'

/**
 * GET /api/match?projectId=&langs=cs,de&range=today|last7|last30|all
 *
 * Serves AI-vs-reviewed match scores per language for the dashboard. The numbers
 * come from Tolgee's native `ai-match-stats` aggregate (see match.ts/tolgeeApi.ts);
 * authenticated server-side via the install X-API-Key, so the dashboard iframe
 * just reads the result. Inherits the SDK CORS headers applied in server/index.ts.
 *
 * Note: scoring is fixed word-level server-side now, so the old `scorer=word|char`
 * query param is accepted-but-ignored for backward compatibility.
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

    if (tags.length === 0) {
      res.json(emptyMatch(range))
      return
    }
    try {
      res.json(await computeMatch(projectId, tags, range))
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
