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

export type HistoryRevision = {
  timestamp: number
  revisionType: string
  modifications: Record<string, { old?: unknown; new?: unknown }>
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

type HistoryResponse = { _embedded?: { revisions?: HistoryRevision[] } }

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

/** Translations currently in the REVIEWED state for a language. */
export const fetchReviewedTranslations = (
  projectId: number,
  tag: string
): Promise<ListedTranslation[]> =>
  pageTranslations(
    projectId,
    tag,
    (qs) => qs.append('filterState', `${tag},REVIEWED`),
    (t) => t.state === 'REVIEWED'
  )

/**
 * AI-translated cells that are NOT yet reviewed — the "Not reviewed" bucket.
 * `filterAutoTranslatedInLang` returns still-auto translations; we keep the
 * ones that haven't reached REVIEWED.
 */
export const fetchNotReviewedAi = (
  projectId: number,
  tag: string
): Promise<ListedTranslation[]> =>
  pageTranslations(
    projectId,
    tag,
    (qs) => qs.append('filterAutoTranslatedInLang', tag),
    (t) => t.state !== 'REVIEWED'
  )

const HISTORY_PAGE_SIZE = 100

/** Ordered revisions for one translation (newest → oldest, as Tolgee returns). */
export const fetchHistory = async (
  projectId: number,
  translationId: number
): Promise<HistoryRevision[]> => {
  const qs = new URLSearchParams({ size: String(HISTORY_PAGE_SIZE), page: '0' })
  const json = await tolgeeFetch<HistoryResponse>(
    `/v2/projects/${projectId}/translations/${translationId}/history`,
    qs
  )
  return json._embedded?.revisions ?? []
}
