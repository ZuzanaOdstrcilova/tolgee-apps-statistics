import { readFileSync } from 'node:fs'
import { INSTALL_FILE, TOLGEE_URL } from './config'

/**
 * Server-to-Tolgee REST access. The app authenticates with the install
 * `clientSecret` as an `X-API-Key` header — the credential `npm run register`
 * wrote to `.tolgee-dev/install.json`. Effective permissions are the app's
 * granted scopes, so the server can read the AI-match-stats aggregate for any
 * enabled project WITHOUT forwarding the iframe's context token.
 *
 * The match scores now come from Tolgee's native, pre-aggregated endpoint
 * `GET /v2/projects/{id}/ai-match-stats[/languages]` (scope: `translations.view`).
 * The old per-translation history N+1 is gone — Tolgee reconstructs and scores
 * server-side and pushes the time range into SQL.
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

// ---- Languages (for the AI-context links + pickers) ------------------------

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
