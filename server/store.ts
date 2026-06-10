import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '.data')
const DATA_FILE = join(DATA_DIR, 'stats.json')

/** How many days of the daily timeline we keep / expose. */
export const TIMELINE_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Who authored the current text of a translation. */
export type Origin = 'ai' | 'human'

/** Per-author tallies used to derive an "accuracy" ratio. */
export type OriginStats = {
  /** Translations whose text this author wrote. */
  produced: number
  /** Author's translations that later reached the REVIEWED state. */
  approved: number
  /** AI translations a human had to rewrite (only meaningful for `ai`). */
  corrected: number
}

/** One translation cell's current standing, surfaced in the tools panel. */
export type TranslationRecord = {
  origin: Origin
  reviewed: boolean
  /** ISO timestamp of the last edit we recorded. */
  updatedAt: string
}

type Aggregate = {
  ai: OriginStats
  human: OriginStats
  keys: { created: number; deleted: number }
  /** day (YYYY-MM-DD, UTC) -> edits split by origin */
  timeline: Record<string, { ai: number; human: number }>
  /** translationId -> current standing */
  records: Record<string, TranslationRecord>
}

const emptyOrigin = (): OriginStats => ({ produced: 0, approved: 0, corrected: 0 })

const EMPTY: Aggregate = {
  ai: emptyOrigin(),
  human: emptyOrigin(),
  keys: { created: 0, deleted: 0 },
  timeline: {},
  records: {},
}

const load = (): Aggregate => {
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<Aggregate>
    return {
      ai: { ...emptyOrigin(), ...parsed.ai },
      human: { ...emptyOrigin(), ...parsed.human },
      keys: { created: 0, deleted: 0, ...parsed.keys },
      timeline: parsed.timeline ?? {},
      records: parsed.records ?? {},
    }
  } catch {
    return structuredClone(EMPTY)
  }
}

const data: Aggregate = load()

const persist = (): void => {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.warn('[store] failed to persist stats:', err)
  }
}

const dayKey = (iso: string): string => iso.slice(0, 10)

const isTruthy = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== false && v !== ''

/**
 * A single modified Translation entity as it appears on SET_TRANSLATIONS /
 * SET_TRANSLATION_STATE webhook payloads. Structurally a subset of the SDK's
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

/** AI if the edit flips `auto` on, names an MT provider, or carries a prompt id. */
const originOf = (mods: TranslationEntity['modifications']): Origin =>
  mods?.auto?.new === true || isTruthy(mods?.mtProvider?.new) || isTruthy(mods?.promptId?.new)
    ? 'ai'
    : 'human'

/** Record text edits from a SET_TRANSLATIONS event. */
const recordTranslationEdits = (
  entities: ReadonlyArray<TranslationEntity>,
  iso: string
): void => {
  let changed = false
  for (const entity of entities) {
    const mods = entity.modifications
    // Only count edits that actually changed the text; pure metadata flips
    // (state, outdated, …) arrive on their own events.
    if (!mods?.text) continue
    const id = String(entity.entityId)
    const origin = originOf(mods)
    const prev = data.records[id]

    // A human rewriting an AI translation is an AI "miss".
    if (prev?.origin === 'ai' && origin === 'human') data.ai.corrected++

    data[origin].produced++
    const day = dayKey(iso)
    const bucket = data.timeline[day] ?? { ai: 0, human: 0 }
    bucket[origin]++
    data.timeline[day] = bucket

    // New text supersedes any prior review.
    data.records[id] = { origin, reviewed: false, updatedAt: iso }
    changed = true
  }
  pruneTimeline()
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
      const origin = rec?.origin ?? 'human'
      if (!rec?.reviewed) {
        data[origin].approved++
        data.records[id] = { origin, reviewed: true, updatedAt: iso }
        changed = true
      }
    } else if (rec?.reviewed) {
      // Re-opened after review — no longer counts as standing-approved.
      rec.reviewed = false
      changed = true
    }
  }
  if (changed) persist()
}

const recordKeyCreated = (count: number): void => {
  data.keys.created += Math.max(1, count)
  persist()
}

const recordKeyDeleted = (count: number): void => {
  data.keys.deleted += Math.max(1, count)
  persist()
}

const pruneTimeline = (): void => {
  const cutoff = dayKey(new Date(Date.now() - TIMELINE_DAYS * MS_PER_DAY).toISOString())
  for (const day of Object.keys(data.timeline)) {
    if (day < cutoff) delete data.timeline[day]
  }
}

/** Build the trailing TIMELINE_DAYS window as an ordered array. */
const timelineSeries = (): { day: string; ai: number; human: number }[] => {
  const out: { day: string; ai: number; human: number }[] = []
  const todayMs = Date.now()
  for (let i = TIMELINE_DAYS - 1; i >= 0; i--) {
    const day = dayKey(new Date(todayMs - i * MS_PER_DAY).toISOString())
    const b = data.timeline[day] ?? { ai: 0, human: 0 }
    out.push({ day, ai: b.ai, human: b.human })
  }
  return out
}

export type StatsSummary = {
  ai: OriginStats & { accuracy: number | null }
  human: OriginStats & { accuracy: number | null }
  keys: { created: number; deleted: number }
  timeline: { day: string; ai: number; human: number }[]
  timelineDays: number
}

/** accuracy = approved / (approved + corrections), null when no signal yet. */
const accuracy = (s: OriginStats): number | null => {
  const denom = s.approved + s.corrected
  return denom === 0 ? null : s.approved / denom
}

const getSummary = (): StatsSummary => ({
  ai: { ...data.ai, accuracy: accuracy(data.ai) },
  human: { ...data.human, accuracy: accuracy(data.human) },
  keys: { ...data.keys },
  timeline: timelineSeries(),
  timelineDays: TIMELINE_DAYS,
})

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
  recordKeyCreated,
  recordKeyDeleted,
  getSummary,
  getRecords,
}
