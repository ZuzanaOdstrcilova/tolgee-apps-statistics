import { readFileSync } from 'node:fs'
import { INSTALL_FILE, TOLGEE_URL } from './config'

/**
 * Server-to-Tolgee REST access. The app authenticates with the install
 * `clientSecret` as an `X-API-Key` header — the credential `npm run register`
 * wrote to `.tolgee-dev/install.json`. Effective permissions are the app's
 * granted scopes (translations.view, keys.view, activity.view), so the server
 * can read translations + per-translation history for any enabled project
 * WITHOUT forwarding the iframe's context token.
 */

type InstallRecord = { tolgeeUrl?: string; clientSecret?: string }

let cachedSecret: string | null = null
let cachedUrl: string | null = null

const readInstall = (): { secret: string; url: string } | null => {
  if (cachedSecret && cachedUrl) return { secret: cachedSecret, url: cachedUrl }
  try {
    const parsed = JSON.parse(readFileSync(INSTALL_FILE, 'utf8')) as InstallRecord
    if (!parsed.clientSecret) return null
    cachedSecret = parsed.clientSecret
    cachedUrl = parsed.tolgeeUrl ?? TOLGEE_URL
    return { secret: cachedSecret, url: cachedUrl }
  } catch {
    return null
  }
}

export const tolgeeReady = (): boolean => readInstall() !== null

/** The Tolgee instance base URL (to absolutise relative paths like avatars). */
export const tolgeeBaseUrl = (): string | null => readInstall()?.url ?? null

const tolgeeFetch = async <T>(path: string, qs?: URLSearchParams): Promise<T> => {
  const cred = readInstall()
  if (!cred) throw new Error('install record missing — run `npm run register`')
  const url = `${cred.url}${path}${qs ? `?${qs.toString()}` : ''}`
  const res = await fetch(url, { headers: { 'X-API-Key': cred.secret } })
  if (!res.ok) {
    throw new Error(`Tolgee ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return (await res.json()) as T
}

// ---- Types ----------------------------------------------------------------

export type ProjectLang = {
  id: number
  tag: string
  name: string
  flag: string
  base: boolean
}

export type ProjectLanguages = {
  baseTag: string
  list: ProjectLang[]
  byTag: Map<string, ProjectLang>
}

export type ListedTranslation = {
  translationId: number
  tag: string
  text: string
  state: string
  auto: boolean
  mtProvider?: string
}

// ---- Raw response shapes (narrow subset of the OpenAPI models) -------------

type LanguagesResponse = {
  _embedded?: {
    languages?: Array<{
      id: number
      tag: string
      name: string
      base: boolean
      flagEmoji?: string
    }>
  }
}

type TranslationView = {
  id?: number
  text?: string | null
  state?: string
  auto?: boolean
  mtProvider?: string | null
}

type KeysResponse = {
  nextCursor?: string
  _embedded?: {
    keys?: Array<{ translations?: Record<string, TranslationView | undefined> }>
  }
}

// ---- Fetchers --------------------------------------------------------------

const langCache = new Map<number, Promise<ProjectLanguages>>()

/** Languages for a project, cached for the process lifetime. */
export const getProjectLanguages = (projectId: number): Promise<ProjectLanguages> => {
  const cached = langCache.get(projectId)
  if (cached) return cached
  const pending = (async (): Promise<ProjectLanguages> => {
    const qs = new URLSearchParams({ size: '1000' })
    const json = await tolgeeFetch<LanguagesResponse>(
      `/v2/projects/${projectId}/languages`,
      qs
    )
    const raw = json._embedded?.languages ?? []
    const list: ProjectLang[] = raw.map((l) => ({
      id: l.id,
      tag: l.tag,
      name: l.name,
      flag: l.flagEmoji ?? '',
      base: l.base,
    }))
    const base = list.find((l) => l.base)
    return {
      baseTag: base?.tag ?? '',
      list,
      byTag: new Map(list.map((l) => [l.tag, l] as const)),
    }
  })()
  langCache.set(projectId, pending)
  return pending.catch((err) => {
    langCache.delete(projectId)
    throw err
  })
}

const PAGE_SIZE = 200
const MAX_PAGES = 1000

/** Cursor-page a translations query, collecting one language column. */
const pageTranslations = async (
  projectId: number,
  tag: string,
  extra: (qs: URLSearchParams) => void,
  keep: (t: ListedTranslation) => boolean
): Promise<ListedTranslation[]> => {
  const out: ListedTranslation[] = []
  let cursor: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams()
    qs.append('languages', tag)
    qs.set('size', String(PAGE_SIZE))
    if (cursor) qs.set('cursor', cursor)
    extra(qs)
    const json = await tolgeeFetch<KeysResponse>(
      `/v2/projects/${projectId}/translations`,
      qs
    )
    const keys = json._embedded?.keys ?? []
    for (const k of keys) {
      const t = k.translations?.[tag]
      if (!t || typeof t.id !== 'number') continue
      const row: ListedTranslation = {
        translationId: t.id,
        tag,
        text: t.text ?? '',
        state: t.state ?? '',
        auto: t.auto === true,
        mtProvider: t.mtProvider ?? undefined,
      }
      if (keep(row)) out.push(row)
    }
    cursor = json.nextCursor
    if (!cursor || keys.length === 0) break
  }
  return out
}

/**
 * Every translation that CURRENTLY exists in the project (all languages, any
 * state) → `id → current text`. Contributor stats are reconstructed from the
 * activity log, which is append-only — deleting a key leaves its historical
 * events behind. Intersecting with this map drops contributions to deleted
 * strings, and the current text lets us derive state-based signals (e.g. the
 * "maga" count) from what's live now, not from old revisions.
 */
export const fetchAliveTranslations = async (projectId: number): Promise<Map<number, string>> => {
  // Request EVERY language explicitly — without `languages` the endpoint returns
  // only a subset, which would drop live work in the other languages.
  const { list } = await getProjectLanguages(projectId)
  const tags = list.map((l) => l.tag)
  const out = new Map<number, string>()
  if (tags.length === 0) return out
  let cursor: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams()
    qs.set('languages', tags.join(','))
    qs.set('size', String(PAGE_SIZE))
    if (cursor) qs.set('cursor', cursor)
    const json = await tolgeeFetch<KeysResponse>(`/v2/projects/${projectId}/translations`, qs)
    const keys = json._embedded?.keys ?? []
    for (const k of keys) {
      for (const t of Object.values(k.translations ?? {})) {
        if (t && typeof t.id === 'number') out.set(t.id, t.text ?? '')
      }
    }
    cursor = json.nextCursor
    if (!cursor || keys.length === 0) break
  }
  return out
}

// ---- Activity log (contributor stats) -------------------------------------

/** Author of an activity revision. `id` is null for system/import events. */
export type ActivityAuthor = {
  id?: number
  name?: string
  username?: string
  deleted?: boolean
  /** Avatar paths are relative to the Tolgee instance — see `tolgeeBaseUrl`. */
  avatar?: { large?: string; thumbnail?: string }
}

/** A Translation entity as it appears inside an activity revision: the changed
 *  fields (text/state/auto/…) plus its language via `relations`. */
export type ActivityTranslation = {
  entityId: number
  modifications?: Record<string, { old?: unknown; new?: unknown }>
  relations?: {
    language?: { data?: { tag?: string; name?: string; flagEmoji?: string } }
    key?: { data?: { name?: string } }
  }
}

/** One activity revision — author, type, timestamp, and changed translations. */
export type ActivityRevision = {
  author?: ActivityAuthor
  type: string
  timestamp: number
  translations: ActivityTranslation[]
}

type ActivityResponse = {
  _embedded?: {
    activities?: Array<{
      author?: ActivityAuthor
      type?: string
      timestamp?: number
      modifiedEntities?: { Translation?: ActivityTranslation[] }
    }>
  }
  page?: { totalPages?: number; number?: number }
}

const ACTIVITY_PAGE_SIZE = 100
const ACTIVITY_MAX_PAGES = 200 // ≤20k revisions; the activity log is the project history

/**
 * The full project activity log (oldest matters as much as newest, so we page
 * all of it). Each revision carries the author + the translations it touched —
 * everything the contributor pipeline needs in ONE linear pass, no per-string
 * history N+1.
 */
export const fetchActivity = async (projectId: number): Promise<ActivityRevision[]> => {
  const out: ActivityRevision[] = []
  for (let page = 0; page < ACTIVITY_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ size: String(ACTIVITY_PAGE_SIZE), page: String(page) })
    const json = await tolgeeFetch<ActivityResponse>(`/v2/projects/${projectId}/activity`, qs)
    const acts = json._embedded?.activities ?? []
    for (const a of acts) {
      out.push({
        author: a.author,
        type: a.type ?? 'UNKNOWN',
        timestamp: a.timestamp ?? 0,
        translations: a.modifiedEntities?.Translation ?? [],
      })
    }
    const total = json.page?.totalPages ?? 1
    if (page + 1 >= total || acts.length === 0) break
  }
  return out
}

/**
 * Translation ids that currently have at least one open QA issue, per language.
 * Cheap (one paged list per language with `filterHasQaIssuesInLang`) — used to
 * derive each contributor's qaPass without per-translation calls.
 */
export const fetchQaIssueTranslationIds = async (
  projectId: number,
  tag: string
): Promise<Set<number>> => {
  const ids = new Set<number>()
  const rows = await pageTranslations(
    projectId,
    tag,
    (qs) => qs.append('filterHasQaIssuesInLang', tag),
    () => true
  )
  for (const r of rows) ids.add(r.translationId)
  return ids
}

// ---- AI match stats (native Tolgee aggregate) ------------------------------

/** One score bucket on the project summary: word/key/contributing-language counts. */
export type AiMatchBucket = { words: number; keys: number; langs: number }

/** `GET /v2/projects/{id}/ai-match-stats` — project-wide summary. */
export type AiMatchSummary = {
  projectId: number
  reviewedAfter: number | null
  reviewedBefore: number | null
  /** epoch ms of the last materialized refresh (null if never). */
  generatedAt: number | null
  /** false while a huge project's first-time backfill is still catching up. */
  upToDate: boolean
  b100: AiMatchBucket
  b9990: AiMatchBucket
  b8980: AiMatchBucket
  b7970: AiMatchBucket
  bno: AiMatchBucket
  reviewedWords: number
  reviewedKeys: number
  notReviewedWords: number
  notReviewedKeys: number
  langCount: number
  avgMatchScore: number
  reviewedPct: number
}

/** One row of `GET /v2/projects/{id}/ai-match-stats/languages`. */
export type AiMatchLangRow = {
  tag: string
  name: string | null
  flag: string | null
  total: number
  b100: number
  b9990: number
  b8980: number
  b7970: number
  bno: number
  notReviewed: number
  avgMatchScore: number
  b100Pct: number
  b9990Pct: number
  b8980Pct: number
  b7970Pct: number
  bnoPct: number
  notReviewedPct: number
}

export type AiMatchLanguages = {
  generatedAt: number | null
  perLang: AiMatchLangRow[]
}

/** Shared query string: repeatable `languages` + optional epoch-ms range bounds. */
const matchStatsQuery = (
  tags: readonly string[],
  reviewedAfter?: number,
  reviewedBefore?: number
): URLSearchParams => {
  const qs = new URLSearchParams()
  for (const tag of tags) qs.append('languages', tag)
  // 0 / undefined ⇒ "all time" ⇒ omit the bound entirely.
  if (reviewedAfter && reviewedAfter > 0) qs.set('reviewedAfter', String(reviewedAfter))
  if (reviewedBefore && reviewedBefore > 0) qs.set('reviewedBefore', String(reviewedBefore))
  return qs
}

export const fetchAiMatchSummary = (
  projectId: number,
  tags: readonly string[],
  reviewedAfter?: number,
  reviewedBefore?: number
): Promise<AiMatchSummary> =>
  tolgeeFetch<AiMatchSummary>(
    `/v2/projects/${projectId}/ai-match-stats`,
    matchStatsQuery(tags, reviewedAfter, reviewedBefore)
  )

export const fetchAiMatchLanguages = (
  projectId: number,
  tags: readonly string[],
  reviewedAfter?: number,
  reviewedBefore?: number
): Promise<AiMatchLanguages> =>
  tolgeeFetch<AiMatchLanguages>(
    `/v2/projects/${projectId}/ai-match-stats/languages`,
    matchStatsQuery(tags, reviewedAfter, reviewedBefore)
  )

// ---- AI context (for the "Improve AI accuracy" panel links) ---------------

export type AiContext = {
  /** Project-level AI description set? */
  descriptionSet: boolean
  /** Languages with an AI note set, and total (non-base) languages. */
  languageNotesSet: number
  languageNotesTotal: number
  /** A custom (saved) AI prompt exists (vs. the default). */
  customPrompt: boolean
}

/** Reads the project's AI-context settings (needs the `prompts.view` scope).
 *  Each call is defensive — a failure for one part degrades to "not set". */
export const fetchAiContext = async (projectId: number): Promise<AiContext> => {
  const safe = async <T>(path: string): Promise<T | null> => {
    try {
      return await tolgeeFetch<T>(path)
    } catch {
      return null
    }
  }
  const [proj, langCust, prompts, langs] = await Promise.all([
    safe<{ description?: string }>(`/v2/projects/${projectId}/ai-prompt-customization`),
    safe<{ _embedded?: { promptCustomizations?: { description?: string }[] } }>(
      `/v2/projects/${projectId}/language-ai-prompt-customizations`
    ),
    safe<{ _embedded?: { prompts?: unknown[] } }>(`/v2/projects/${projectId}/prompts`),
    getProjectLanguages(projectId).catch(() => null),
  ])
  const notes = langCust?._embedded?.promptCustomizations ?? []
  const notesSet = notes.filter((n) => Boolean(n.description && n.description.trim())).length
  const total = langs ? langs.list.filter((l) => !l.base).length : notes.length
  return {
    descriptionSet: Boolean(proj?.description && proj.description.trim()),
    languageNotesSet: notesSet,
    languageNotesTotal: total,
    customPrompt: (prompts?._embedded?.prompts ?? []).length > 0,
  }
}
