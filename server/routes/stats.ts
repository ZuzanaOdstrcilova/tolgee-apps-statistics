import type { Express, Request, Response } from 'express'
import { store } from '../store'

/**
 * Read-only JSON endpoints consumed by the iframe modules:
 *  - GET /api/stats          → project-wide aggregate for the dashboard
 *  - GET /api/state?ids=1,2  → per-translation standing for the tools panel
 *
 * Both inherit the SDK CORS headers applied in server/index.ts, so the
 * webapp (a different origin) can read them.
 */
export const registerStatsRoute = (app: Express): void => {
  app.get('/api/stats', (_req: Request, res: Response) => {
    res.json(store.getSummary())
  })

  app.get('/api/state', (req: Request, res: Response) => {
    res.json({ records: store.getRecords(parseIds(req.query.ids)) })
  })
}

const parseIds = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
