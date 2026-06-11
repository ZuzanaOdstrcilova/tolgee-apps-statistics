import type { Express, Request, Response } from 'express'
import { decodeContextToken } from '@tolgee/apps-sdk/server'
import { getContributors } from '../contributors'
import { tolgeeReady } from '../tolgeeApi'

/**
 * GET /api/contributors?projectId=        → the whole team (Member raw signals)
 * GET /api/contributors/me?projectId=     → the calling user's own card
 *
 * The team is computed from the project activity log (see contributors.ts).
 * `/me` identifies the caller by decoding the iframe context token it forwards
 * in `X-Tolgee-Context` (the install X-API-Key auth has no user identity).
 */
export const registerContributorsRoute = (app: Express): void => {
  const requireProject = (req: Request, res: Response): number | null => {
    if (!tolgeeReady()) {
      res.status(503).json({ ok: false, error: 'install record missing — run `npm run register`' })
      return null
    }
    const projectId = Number(req.query.projectId)
    if (!Number.isFinite(projectId)) {
      res.status(400).json({ ok: false, error: 'projectId query param required' })
      return null
    }
    return projectId
  }

  app.get('/api/contributors', async (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (projectId === null) return
    try {
      res.json({ ok: true, members: await getContributors(projectId) })
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get('/api/contributors/me', async (req: Request, res: Response) => {
    const projectId = requireProject(req, res)
    if (projectId === null) return
    const token = req.header('X-Tolgee-Context')
    let userId: number | undefined
    try {
      if (token) userId = decodeContextToken(token).userId
    } catch {
      // fall through → no identity
    }
    if (userId === undefined) {
      res.status(401).json({ ok: false, error: 'missing or invalid X-Tolgee-Context token' })
      return
    }
    try {
      const member = (await getContributors(projectId)).find((m) => m.id === userId) ?? null
      res.json({ ok: true, member })
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
