import type { Express, Request, Response } from 'express'
import { fetchAiContext, tolgeeReady } from '../tolgeeApi'

/**
 * GET /api/ai-context?projectId=
 *
 * Status of the project's AI context (project description, per-language notes,
 * custom prompt) for the panel's "Improve AI accuracy" links. Authenticated
 * server-side via the install X-API-Key; needs the `prompts.view` scope.
 */
export const registerAiContextRoute = (app: Express): void => {
  app.get('/api/ai-context', async (req: Request, res: Response) => {
    if (!tolgeeReady()) {
      res.status(503).json({ ok: false, error: 'install record missing — run `npm run register`' })
      return
    }
    const projectId = Number(req.query.projectId)
    if (!Number.isFinite(projectId)) {
      res.status(400).json({ ok: false, error: 'projectId query param required' })
      return
    }
    try {
      res.json({ ok: true, ...(await fetchAiContext(projectId)) })
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
