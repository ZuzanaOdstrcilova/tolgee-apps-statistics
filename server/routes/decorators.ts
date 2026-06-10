import type { Express, Request, Response } from 'express'
import type { DecoratorsResponse } from '@tolgee/apps-sdk/server'

/**
 * Dynamic decorators endpoint. The Tolgee webapp POSTs the key/language rows
 * currently in view; you return icon decorations to render alongside the native
 * row icons.
 *
 * Statistics is a read-only analytics app — it does not decorate individual
 * rows, so this returns no items. (Per-cell AI/human standing is surfaced in
 * the translation tools panel instead.)
 */
export const registerDecoratorsRoute = (app: Express): void => {
  app.post('/decorators', (_req: Request, res: Response) => {
    const response: DecoratorsResponse = { items: [] }
    res.json(response)
  })
}
