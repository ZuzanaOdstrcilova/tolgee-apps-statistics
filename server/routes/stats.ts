import type { Express, Request, Response } from 'express'
import { store } from '../store'

/**
 * Per-translation standing for the translations tools panel:
 *  - GET /api/state?ids=1,2  → { records: { <id>: {origin, reviewed, updatedAt} } }
 *
 * Inherits the SDK CORS headers applied in server/index.ts. (The dashboard's
 * project-wide metrics live on /api/match — see routes/match.ts.)
 */
export const registerStatsRoute = (app: Express): void => {
  app.get('/api/state', (req: Request, res: Response) => {
    res.json({ records: store.getRecords(parseIds(req.query.ids)) })
  })
}

const parseIds = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
