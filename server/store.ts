import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAiModification } from './aiOrigin'

/**
 * Live per-translation standing, fed by webhooks and read by the translations
 * tools panel via `/api/state`. (The dashboard's project-wide metrics come from
 * the on-demand match pipeline in match.ts, not from here.)
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '.data')
const DATA_FILE = join(DATA_DIR, 'stats.json')

/** Who authored the current text of a translation. */
export type Origin = 'ai' | 'human'

/** One translation cell's current standing, surfaced in the tools panel. */
export type TranslationRecord = {
  origin: Origin
  reviewed: boolean
  /** ISO timestamp of the last edit we recorded. */
  updatedAt: string
}

/**
 * A modified Translation entity as it appears on SET_TRANSLATIONS /
 * SET_TRANSLATION_STATE webhook payloads — a structural subset of the SDK's
 * typed entity, so the typed arrays pass straight in.
 */
export type TranslationEntity = {
  entityId: number
  modifications?: {
    auto?: { new?: unknown }
    mtProvider?: { new?: unknown }
    promptId?: { new?: unknown }
    state?: { new?: unknown }
    text?: { new?: unknown }
  }
}

type Data = { records: Record<string, TranslationRecord> }

const load = (): Data => {
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<Data>
    return { records: parsed.records ?? {} }
  } catch {
    return { records: {} }
  }
}

const data: Data = load()

const persist = (): void => {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.warn('[store] failed to persist records:', err)
  }
}

/** Record text edits from a SET_TRANSLATIONS event. */
const recordTranslationEdits = (
  entities: ReadonlyArray<TranslationEntity>,
  iso: string
): void => {
  let changed = false
  for (const entity of entities) {
    const mods = entity.modifications
    // Only text changes set authorship; pure metadata flips arrive separately.
    if (!mods?.text) continue
    data.records[String(entity.entityId)] = {
      origin: isAiModification(mods) ? 'ai' : 'human',
      reviewed: false, // new text supersedes any prior review
      updatedAt: iso,
    }
    changed = true
  }
  if (changed) persist()
}

/** Record state transitions from a SET_TRANSLATION_STATE event. */
const recordStateChanges = (
  entities: ReadonlyArray<TranslationEntity>,
  iso: string
): void => {
  let changed = false
  for (const entity of entities) {
    const next = entity.modifications?.state?.new
    if (typeof next !== 'string') continue
    const id = String(entity.entityId)
    const rec = data.records[id]
    if (next === 'REVIEWED') {
      if (!rec?.reviewed) {
        data.records[id] = { origin: rec?.origin ?? 'human', reviewed: true, updatedAt: iso }
        changed = true
      }
    } else if (rec?.reviewed) {
      rec.reviewed = false // re-opened after review
      changed = true
    }
  }
  if (changed) persist()
}

const getRecords = (ids: ReadonlyArray<string>): Record<string, TranslationRecord> => {
  const out: Record<string, TranslationRecord> = {}
  for (const id of ids) {
    const rec = data.records[id]
    if (rec) out[id] = rec
  }
  return out
}

export const store = {
  recordTranslationEdits,
  recordStateChanges,
  getRecords,
}
