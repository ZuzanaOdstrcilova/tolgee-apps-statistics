import express, { type Express, type Request, type Response } from 'express'
import { onWebhook, receiveWebhook } from '@tolgee/apps-sdk/server'
import { WEBHOOK_SECRET } from '../config'
import { store } from '../store'
import { invalidateContributors } from '../contributors'

export const registerWebhookRoute = (app: Express): void => {
  // express.text keeps the body verbatim — the SDK verifier needs the raw
  // bytes Tolgee signed, not a parsed object.
  app.post(
    '/webhook',
    express.text({ type: 'application/json', limit: '5mb' }),
    handleWebhook
  )
}

const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  const raw = typeof req.body === 'string' ? req.body : ''
  const result = await receiveWebhook({
    rawBody: raw,
    signatureHeader: req.header('Tolgee-Signature'),
    secret: WEBHOOK_SECRET,
  })
  if (!result.ok) {
    res.status(result.status).json({ error: result.error })
    return
  }
  const payload = result.payload

  // Translation text edits → classify AI vs human authorship for the tools panel
  // and recompute contributor stats. (Match stats no longer cache here — they read
  // Tolgee's native ai-match-stats aggregate on demand, so nothing to invalidate.)
  onWebhook(payload, 'SET_TRANSLATIONS', (typed) => {
    const iso = isoTimestamp(typed.activityData?.timestamp)
    const ents = typed.activityData?.modifiedEntities?.Translation ?? []
    store.recordTranslationEdits(ents, iso)
    invalidateContributors() // contributor stats changed too
  })

  // State transitions → keep the tools panel's per-cell reviewed flag current and
  // refresh contributor stats.
  onWebhook(payload, 'SET_TRANSLATION_STATE', (typed) => {
    const iso = isoTimestamp(typed.activityData?.timestamp)
    const ents = typed.activityData?.modifiedEntities?.Translation ?? []
    store.recordStateChanges(ents, iso)
    invalidateContributors()
  })

  // Deleting a key removes its translations → recompute contributor stats. Match
  // stats self-correct (the native endpoint re-reads the activity log on demand).
  onWebhook(payload, 'KEY_DELETE', () => {
    invalidateContributors()
  })

  res.status(204).end()
}

const isoTimestamp = (ts: number | undefined): string =>
  typeof ts === 'number' ? new Date(ts).toISOString() : new Date().toISOString()
