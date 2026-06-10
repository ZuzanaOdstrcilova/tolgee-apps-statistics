import express, { type Express, type Request, type Response } from 'express'
import { onWebhook, receiveWebhook } from '@tolgee/apps-sdk/server'
import { WEBHOOK_SECRET } from '../config'
import { store } from '../store'

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

  // Translation text edits → classify AI vs human authorship.
  onWebhook(payload, 'SET_TRANSLATIONS', (typed) => {
    const iso = isoTimestamp(typed.activityData?.timestamp)
    store.recordTranslationEdits(typed.activityData?.modifiedEntities?.Translation ?? [], iso)
  })

  // State transitions → REVIEWED credits the current author's "accuracy".
  onWebhook(payload, 'SET_TRANSLATION_STATE', (typed) => {
    const iso = isoTimestamp(typed.activityData?.timestamp)
    store.recordStateChanges(typed.activityData?.modifiedEntities?.Translation ?? [], iso)
  })

  // Key lifecycle counts.
  onWebhook(payload, 'CREATE_KEY', (typed) => {
    const keys = typed.activityData?.modifiedEntities?.Key?.length
    store.recordKeyCreated(keys ?? typed.activityData?.counts?.Key ?? 1)
  })
  onWebhook(payload, 'KEY_DELETE', (typed) => {
    // KEY_DELETE ships no modifiedEntities — fall back to the activity counts.
    store.recordKeyDeleted(typed.activityData?.counts?.Key ?? 1)
  })

  res.status(204).end()
}

const isoTimestamp = (ts: number | undefined): string =>
  typeof ts === 'number' ? new Date(ts).toISOString() : new Date().toISOString()
