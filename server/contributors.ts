import {
  fetchActivity,
  fetchAliveTranslations,
  fetchQaIssueTranslationIds,
  tolgeeBaseUrl,
  type ActivityRevision,
} from './tolgeeApi'
import { isAiModification, wasAiBeforeModification } from './aiOrigin'

/**
 * Contributor stats pipeline. ONE linear pass over the project activity log
 * (which is the whole project history, author-stamped) yields every raw signal
 * the contributor views need — no per-translation history N+1. The app derives
 * trust / tier / badges from these via its CONFIG; we only supply raw signals.
 *
 * Quality signals (cleanRate, survival, qaPass) are reconstructed from review
 * outcomes in the same pass + one cheap QA-filter call per language. They're
 * honest but coarse — refine the exact definitions later.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Raw per-contributor signals — matches the app's `Member` (minus the fields
 *  the app derives: trust/tier/preliminary, and badges which are derived too). */
export type ContributorMember = {
  id: number
  name: string
  initials: string
  /** Email (Tolgee username) for the mailto link in the member card. */
  email?: string
  /** Absolute avatar URL from Tolgee (large), or undefined → fall back to initials. */
  avatarUrl?: string
  langs: string[]
  /** Language tag → flag emoji (for the member card's flags). */
  langFlags: Record<string, string>
  strings: number
  aiFixed: number
  lastActive: number
  cleanRate: number
  qaPass: number
  survival: number
  /** How many times the word "maga" appears in this person's translations (joke demo badge). */
  magaCount: number
  mix: { postedit: number; scratch: number; review: number }
  /** Volume + mix per period window (keys: all, 30d, week, today, hour, min5, min). */
  windows: Record<string, { strings: number; mix: { postedit: number; scratch: number; review: number } }>
  badges: string[]
}

// Count occurrences of the word "maga" (case-insensitive) in a translation,
// for the joke "MAGA" badge. Word-boundaried so "magazine" doesn't count.
const countMaga = (text: unknown): number =>
  typeof text === 'string' ? (text.match(/\bmaga\b/gi)?.length ?? 0) : 0

const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((100 * part) / whole)

// Period windows the dashboard offers, by max age in ms (keyed like the client's
// RangeKey). 'all' isn't here — it uses the lifetime totals.
export const RANGE_MS: Record<string, number> = {
  min: 60_000,
  min5: 5 * 60_000,
  hour: 60 * 60_000,
  today: 24 * 60 * 60_000,
  week: 7 * MS_PER_DAY,
  '30d': 30 * MS_PER_DAY,
}
const WINDOW_KEYS = Object.keys(RANGE_MS)
type WinCounts = { s: number; pe: number; sc: number; re: number }
const newWin = (): Record<string, WinCounts> =>
  Object.fromEntries(WINDOW_KEYS.map((k) => [k, { s: 0, pe: 0, sc: 0, re: 0 }]))

// Per-author running tallies during the activity walk.
type Acc = {
  id: number
  name: string
  langs: Set<string>
  langFlags: Map<string, string>
  strings: number
  postedit: number
  scratch: number
  review: number
  // Same metrics bucketed into each period window (strings + post/scratch/review).
  win: Record<string, WinCounts>
  aiFixed: number
  lastActive: number
  // quality
  reviewedEdits: number
  cleanEdits: number
  reviewedPostedits: number
  cleanPostedits: number
  owned: Set<number> // translations where this author is the current human text-setter
}

const newAcc = (id: number, name: string): Acc => ({
  id,
  name,
  langs: new Set(),
  langFlags: new Map(),
  strings: 0,
  postedit: 0,
  scratch: 0,
  review: 0,
  win: newWin(),
  aiFixed: 0,
  lastActive: 0,
  reviewedEdits: 0,
  cleanEdits: 0,
  reviewedPostedits: 0,
  cleanPostedits: 0,
  owned: new Set(),
})

/** One translation's most recent un-reviewed human edit, pending a review verdict. */
type Pending = { author: number; postedit: boolean }

export const computeContributors = async (projectId: number): Promise<ContributorMember[]> => {
  const now = Date.now()

  const [revisions, alive] = await Promise.all([
    fetchActivity(projectId),
    fetchAliveTranslations(projectId), // id → current text (also the alive-set)
  ])
  // Activity comes newest-first; build timelines oldest→newest.
  revisions.sort((a, b) => a.timestamp - b.timestamp)

  const accs = new Map<number, Acc>()
  const acc = (id: number, name: string): Acc => {
    let a = accs.get(id)
    if (!a) accs.set(id, (a = newAcc(id, name)))
    return a
  }

  // Per-translation walk state: whether the current text is AI, and the pending
  // human edit awaiting a review outcome. We group events by translation id.
  const base = tolgeeBaseUrl()
  const avatars = new Map<number, string>() // author id → relative avatar path (large)
  const emails = new Map<number, string>() // author id → email (Tolgee username)
  const currentIsAi = new Map<number, boolean>()
  const pending = new Map<number, Pending>()
  const ownerTag = new Map<number, string>() // translation id → its language tag

  const settleSuperseded = (entityId: number) => {
    // A prior un-reviewed human edit was overwritten → counts as "needed change".
    const p = pending.get(entityId)
    if (!p) return
    const a = accs.get(p.author)
    if (a) {
      a.reviewedEdits++
      if (p.postedit) a.reviewedPostedits++
    }
    pending.delete(entityId)
  }

  for (const rev of revisions as ActivityRevision[]) {
    for (const t of rev.translations) {
      const entityId = t.entityId

      // Capture identity (avatar/email) from EVERY event, BEFORE the alive-skip —
      // a contributor's photo shouldn't disappear just because some of their work
      // was on since-deleted keys.
      const authorId = rev.author?.id
      const authorName = rev.author?.name ?? rev.author?.username ?? ''
      if (authorId !== undefined) {
        const avatarPath = rev.author?.avatar?.large
        const username = rev.author?.username
        if (avatarPath) avatars.set(authorId, avatarPath)
        if (username?.includes('@')) emails.set(authorId, username)
      }

      // Skip STATS for translations that no longer exist (deleted keys).
      if (!alive.has(entityId)) continue
      const mods = t.modifications ?? {}
      const tag = t.relations?.language?.data?.tag
      const flag = t.relations?.language?.data?.flagEmoji
      if (tag) ownerTag.set(entityId, tag)
      const hasText = 'text' in mods
      const reviewedNow = mods.state?.new === 'REVIEWED'
      const evAi = isAiModification(mods)

      if (hasText) {
        if (evAi) {
          // AI (re)wrote the text — drop any pending human edit (never reviewed).
          pending.delete(entityId)
          currentIsAi.set(entityId, true)
        } else if (authorId !== undefined && !rev.author?.deleted) {
          // Human text edit. First, supersede a different author's pending edit.
          const prev = pending.get(entityId)
          if (prev && prev.author !== authorId) settleSuperseded(entityId)

          const a = acc(authorId, authorName)
          // Post-edit if the text was AI either in a revision we already saw, OR
          // per this edit's `old` markers (catches batch-MT'd text the activity
          // log doesn't expand per-translation).
          const postedit = currentIsAi.get(entityId) === true || wasAiBeforeModification(mods)
          a.strings++
          if (postedit) {
            a.postedit++
            a.aiFixed++
          } else {
            a.scratch++
          }
          const age = now - rev.timestamp
          for (const k of WINDOW_KEYS) {
            if (age <= RANGE_MS[k]) {
              const w = a.win[k]
              w.s++
              if (postedit) w.pe++
              else w.sc++
            }
          }
          // Languages are credited ONLY for actual translation work (this human
          // text-edit branch) — reviewing a language never adds it. Tolgee's
          // per-user language permissions aren't readable by the app (the users
          // endpoint requires a super-JWT), so "languages they translated in" is
          // the closest available proxy for "their languages".
          if (tag) {
            a.langs.add(tag)
            if (flag) a.langFlags.set(tag, flag)
          }
          a.lastActive = Math.max(a.lastActive, rev.timestamp)
          // ownership for qaPass — reassign from any previous owner
          for (const o of accs.values()) o.owned.delete(entityId)
          a.owned.add(entityId)

          pending.set(entityId, { author: authorId, postedit })
          currentIsAi.set(entityId, false)
        }
      }

      if (reviewedNow) {
        const p = pending.get(entityId)
        if (p) {
          const a = accs.get(p.author)
          if (a) {
            a.reviewedEdits++
            a.cleanEdits++
            if (p.postedit) {
              a.reviewedPostedits++
              a.cleanPostedits++
            }
          }
          pending.delete(entityId)
        }
        if (authorId !== undefined && !rev.author?.deleted) {
          const a = acc(authorId, authorName)
          a.review++
          const age = now - rev.timestamp
          for (const k of WINDOW_KEYS) if (age <= RANGE_MS[k]) a.win[k].re++
          a.lastActive = Math.max(a.lastActive, rev.timestamp)
        }
      }
    }
  }

  // qaPass: one cheap QA-filter call per language that has owned translations.
  const tags = new Set<string>()
  for (const a of accs.values()) for (const id of a.owned) {
    const tg = ownerTag.get(id)
    if (tg) tags.add(tg)
  }
  const qaIssues = new Map<string, Set<number>>()
  await Promise.all(
    [...tags].map(async (tg) => {
      try {
        qaIssues.set(tg, await fetchQaIssueTranslationIds(projectId, tg))
      } catch {
        qaIssues.set(tg, new Set())
      }
    })
  )

  const members: ContributorMember[] = []
  for (const a of accs.values()) {
    // Skip pure-system rows with no real contribution.
    if (a.strings === 0 && a.review === 0) continue
    const actions = a.postedit + a.scratch + a.review
    let withIssue = 0
    for (const id of a.owned) if (qaIssues.get(ownerTag.get(id) ?? '')?.has(id)) withIssue++
    const avatarPath = avatars.get(a.id)
    members.push({
      id: a.id,
      name: a.name || `User ${a.id}`,
      initials: initialsOf(a.name || `U${a.id}`),
      email: emails.get(a.id),
      avatarUrl: avatarPath && base ? `${base}${avatarPath}` : undefined,
      langs: [...a.langs].sort(),
      langFlags: Object.fromEntries(a.langFlags),
      strings: a.strings,
      aiFixed: a.aiFixed,
      lastActive: a.lastActive ? Math.floor((now - a.lastActive) / MS_PER_DAY) : 9999,
      cleanRate: pct(a.cleanEdits, a.reviewedEdits),
      qaPass: a.owned.size === 0 ? 100 : pct(a.owned.size - withIssue, a.owned.size),
      survival: pct(a.cleanPostedits, a.reviewedPostedits),
      // Count "maga" in the CURRENT text of the translations this person owns —
      // so it reflects live state (editing the word out, or deleting the key,
      // lowers it). Free: `alive` already holds every current translation's text.
      magaCount: [...a.owned].reduce((s, id) => s + countMaga(alive.get(id)), 0),
      mix: {
        postedit: pct(a.postedit, actions),
        scratch: pct(a.scratch, actions),
        review: pct(a.review, actions),
      },
      // Per-period volume + mix: 'all' uses lifetime totals, the rest each window.
      windows: {
        all: {
          strings: a.strings,
          mix: {
            postedit: pct(a.postedit, actions),
            scratch: pct(a.scratch, actions),
            review: pct(a.review, actions),
          },
        },
        ...Object.fromEntries(
          WINDOW_KEYS.map((k) => {
            const w = a.win[k]
            const tot = w.pe + w.sc + w.re
            return [
              k,
              {
                strings: w.s,
                mix: {
                  postedit: pct(w.pe, tot),
                  scratch: pct(w.sc, tot),
                  review: pct(w.re, tot),
                },
              },
            ]
          })
        ),
      },
      badges: [], // derived in the app later (brief §6)
    })
  }
  return members
}

// ---- Short-lived cache (the activity walk is the cost) ---------------------

type Cached = { at: number; members: ContributorMember[] }
const cache = new Map<number, Cached>()
const TTL = 60_000

export const getContributors = async (projectId: number): Promise<ContributorMember[]> => {
  const hit = cache.get(projectId)
  if (hit && Date.now() - hit.at < TTL) return hit.members
  const members = await computeContributors(projectId)
  cache.set(projectId, { at: Date.now(), members })
  return members
}

/** Drop the cache so the next /api/contributors recomputes. Called from
 *  webhooks when translations change/are deleted (no projectId → clear all). */
export const invalidateContributors = (projectId?: number): void => {
  if (projectId === undefined) cache.clear()
  else cache.delete(projectId)
}
