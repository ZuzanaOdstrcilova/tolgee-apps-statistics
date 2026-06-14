import { useEffect, useState } from 'react'

// Contributor stats — data model, tunable config, derived scores, and the hooks
// that fetch the real team/contributor from our /api/contributors backend.
//
// Concept (brief §1): roles aren't a fixed identity. The same person runs AI,
// post-edits, then reviews. We track contribution PER ACTION, not a job title.
// Each member has a contribution *mix*, a *trust tier* (how much review their
// work needs) and a single *trust score* (0..100, quality over full history).
//
// Trust, tier and the preliminary flag are ALWAYS DERIVED here from raw signals
// (never hard-coded per member) so the weights/thresholds below are the single
// place to tune them.

// ── Tunables ────────────────────────────────────────────────────────────────
// All weights, the volume curve, tier cut-offs and flags live here (brief §3,§9).
export const CONFIG = {
  // Trust = weighted average of five 0..100 components. Quality (clean +
  // survival + qaPass = 0.80) outweighs raw volume — speed never ranks alone.
  weights: { cleanRate: 0.3, survival: 0.3, qaPass: 0.2, volume: 0.15, breadth: 0.05 },
  // Volume score has a ceiling with diminishing returns: ~`target` strings ≈
  // full marks, so a huge backlog can't drown out quality.
  volumeTarget: 5000,
  // Breadth: each language adds this much, capped at 100.
  breadthPerLang: 25,
  // Tier cut-offs on the trust score. Configurable, not hard-coded in branches.
  tier: { trustedMin: 65, coreMin: 85 },
  // Fewer strings than this → trust is "preliminary" (sample too small).
  preliminaryBelow: 50,
  // Volume idle longer than this many days → "quiet", flagged with the accent.
  quietAfterDays: 30,
  // Badge thresholds — derived from the same raw signals as trust (single place
  // to tune; never hard-coded per member).
  badges: {
    workhorseVolumeScore: 70, // volumeScore ≥ 70 ≈ ~390+ strings (matches BADGE_HOWTO)
    polyglotLangs: 3,
    nativeVoiceStrings: 300,
    cleanHandsRate: 90,
    qaGhostPass: 95,
    guardianReviewMix: 40,
    aiTamerFixed: 200,
    magaMentions: 10, // joke demo: wrote the word "maga" this many times
  },
} as const

export type Tier = 'new' | 'trusted' | 'core'
export type MixKey = 'postedit' | 'scratch' | 'review'
/** Contribution mix — the three keys always sum to 100. */
export type Mix = Record<MixKey, number>
export type BadgeKey =
  | 'workhorse'
  | 'polyglot'
  | 'nativevoice'
  | 'cleanhands'
  | 'qaghost'
  | 'guardian'
  | 'aitamer'
  | 'maga'

/**
 * A member's RAW signals — what the backend would supply per string (brief §8).
 * Trust / tier / preliminary are NOT stored here; they're computed (see `score`).
 */
export type Member = {
  id: number
  name: string
  initials: string
  email?: string // Tolgee username; powers the member card's mailto link
  avatarUrl?: string // Tolgee user photo; absent → render initials
  langs: string[] // language codes the member works in
  /** Volume + mix per period window (keys: all, 30d, week, today, hour, min5, min). */
  windows?: Record<string, { strings: number; mix: Mix }>
  magaCount?: number // joke demo: times they wrote the word "maga"
  langFlags?: Record<string, string> // language tag → flag emoji (member card)
  // volume & activity
  strings: number // all strings over full history
  aiFixed: number // AI translations this person corrected
  lastActive: number // days since last work
  // quality — all 0..100
  cleanRate: number // accepted unchanged at review
  qaPass: number // didn't trigger any QA check
  survival: number // post-edits that passed a further review unchanged
  // composition
  mix: Mix
  badges: BadgeKey[]
}

/** A member plus the fields derived from CONFIG, ready to render. */
export type ScoredMember = Member & {
  trust: number
  tier: Tier
  preliminary: boolean
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n))

/** Diminishing-returns volume score, capped at 100 (brief §3). */
export const volumeScore = (strings: number): number =>
  clamp100((100 * Math.log(1 + strings)) / Math.log(1 + CONFIG.volumeTarget))

/** Breadth score from the number of languages, capped at 100. */
export const breadthScore = (langCount: number): number =>
  clamp100(langCount * CONFIG.breadthPerLang)

/**
 * Trust = weighted average of the five components (brief §3).
 *
 * Recency: the spec down-weights older work by `0.5 ^ (ageMonths / 12)`, but
 * that needs a per-string timestamp the backend doesn't expose yet — so for now
 * trust uses the full, unweighted history. // MOCK (recency weighting)
 */
export function computeTrust(m: Member): number {
  const w = CONFIG.weights
  const score =
    w.cleanRate * m.cleanRate +
    w.survival * m.survival +
    w.qaPass * m.qaPass +
    w.volume * volumeScore(m.strings) +
    w.breadth * breadthScore(m.langs.length)
  return Math.round(score)
}

/** Tier from the trust score (cut-offs from CONFIG). */
export const tierOf = (trust: number): Tier =>
  trust >= CONFIG.tier.coreMin ? 'core' : trust >= CONFIG.tier.trustedMin ? 'trusted' : 'new'

/** Attach the derived trust / tier / preliminary / badges fields to a member. */
export const score = (m: Member): ScoredMember => {
  const trust = computeTrust(m)
  return {
    ...m,
    trust,
    tier: tierOf(trust),
    preliminary: m.strings < CONFIG.preliminaryBelow,
    badges: deriveBadges(m),
  }
}

// ── Range, filters, ranking ───────────────────────────────────────────────────
export type RangeKey = 'min' | 'min5' | 'hour' | 'today' | 'week' | '30d' | 'all'
/** Volume for the period window (falls back to all-time). Quality/trust never
 *  change with the range (brief §3 "Aktivita vs trust"). */
export const volumeFor = (m: Member, range: RangeKey): number =>
  m.windows?.[range]?.strings ?? m.strings

/** Contribution mix for the period window (falls back to all-time). */
export const mixFor = (m: Member, range: RangeKey): Mix =>
  m.windows?.[range]?.mix ?? m.mix

export type ActivityFilter = 'any' | MixKey
/** Activity filter: keep members who do this activity at all (mix share > 0).
 *  Doing other things too is fine — this just requires ≥1 of the selected kind. */
export const matchesActivity = (m: Member, f: ActivityFilter): boolean =>
  f === 'any' ? true : m.mix[f] > 0

export type TierFilter = 'all' | Tier
export type RankKey = 'trust' | 'volume' | 'cleanRate'

/** Rank members. Only "volume" respects the range; the rest use full history. */
export function rankMembers(
  members: ScoredMember[],
  rankBy: RankKey,
  range: RangeKey
): ScoredMember[] {
  const value = (m: ScoredMember): number => {
    switch (rankBy) {
      case 'volume':
        return volumeFor(m, range)
      case 'cleanRate':
        return m.cleanRate
      case 'trust':
      default:
        return m.trust
    }
  }
  return [...members].sort((a, b) => value(b) - value(a))
}

// ── Display metadata ──────────────────────────────────────────────────────────
// Mix / tier / community colours are data-viz constants (read on light & dark),
// mirroring how the match-score palette is handled elsewhere in the app.
export const MIX_META: { key: MixKey; label: string; color: string }[] = [
  { key: 'postedit', label: 'Post-edits AI', color: '#e6256b' },
  { key: 'scratch', label: 'Translates fresh', color: '#5cc0f0' },
  { key: 'review', label: 'Reviews', color: '#22c39a' },
]

export const TIER_META: Record<Tier, { label: string; color: string }> = {
  new: { label: 'New', color: '#8b91a0' },
  trusted: { label: 'Trusted', color: '#d8a008' },
  core: { label: 'Core', color: '#22c39a' },
}

/** Avatar fill. */
export const AVATAR_COLOR = '#3b4456'

export const BADGES: Record<BadgeKey, { label: string; glyph: string; note: string; color: string }> = {
  workhorse: { label: 'Heavy Lifter', glyph: '🏋️', note: 'High contribution volume', color: '#e6256b' },
  polyglot: { label: 'Polyglot', glyph: '🌍', note: 'Works across many languages', color: '#5cc0f0' },
  nativevoice: { label: 'Native Voice', glyph: '🗣️', note: 'Deep focus on one language', color: '#7c5cff' },
  cleanhands: { label: 'Spotless', glyph: '💎', note: 'Accepted without edits', color: '#22c39a' },
  qaghost: { label: 'QA Ninja', glyph: '🥷', note: 'Almost no QA checks triggered', color: '#14b8c4' },
  guardian: { label: 'Guardian', glyph: '🛡️', note: 'Catches and fixes the most issues', color: '#d8a008' },
  aitamer: { label: 'AI Fixer', glyph: '🤖', note: 'Strong at correcting machine output', color: '#ec407a' },
  maga: { label: 'MAGA', glyph: '🧢', note: 'Wrote the word “maga” 10+ times (just for fun)', color: '#e23b2e' },
}
// Badge tiers (bronze/silver/gold) aren't used yet — left for later (brief §6).
export const BADGE_ORDER = Object.keys(BADGES) as BadgeKey[]

/** Short "how you earn it" line per badge, tied to the CONFIG.badges thresholds. */
export const BADGE_HOWTO: Record<BadgeKey, string> = {
  workhorse: 'High contribution volume over their whole history (~400+ strings).',
  polyglot: `Works across ${CONFIG.badges.polyglotLangs}+ languages.`,
  nativevoice: `Deep focus on a single language (${CONFIG.badges.nativeVoiceStrings}+ strings).`,
  cleanhands: `${CONFIG.badges.cleanHandsRate}%+ of their work accepted without edits.`,
  qaghost: `${CONFIG.badges.qaGhostPass}%+ of their strings trigger no QA check.`,
  guardian: `${CONFIG.badges.guardianReviewMix}%+ of their work is reviewing others.`,
  aitamer: `Corrected ${CONFIG.badges.aiTamerFixed}+ AI translations.`,
  maga: `Use the word “maga” ${CONFIG.badges.magaMentions}+ times.`,
}

/**
 * Earned badges, DERIVED from raw signals (thresholds in CONFIG.badges) — same
 * principle as trust: never hard-coded per member, tuned in one place.
 */
export function deriveBadges(m: Member): BadgeKey[] {
  const b = CONFIG.badges
  const out: BadgeKey[] = []
  if (volumeScore(m.strings) >= b.workhorseVolumeScore) out.push('workhorse')
  if (m.langs.length >= b.polyglotLangs) out.push('polyglot')
  if (m.langs.length === 1 && m.strings >= b.nativeVoiceStrings) out.push('nativevoice')
  if (m.cleanRate >= b.cleanHandsRate) out.push('cleanhands')
  if (m.qaPass >= b.qaGhostPass) out.push('qaghost')
  if (m.mix.review >= b.guardianReviewMix) out.push('guardian')
  if (m.aiFixed >= b.aiTamerFixed) out.push('aitamer')
  if ((m.magaCount ?? 0) >= b.magaMentions) out.push('maga')
  return out
}

/**
 * How close (0..100) a member is to earning a badge, measured from the SAME raw
 * signal the badge is derived from (see `deriveBadges`). 100 = already earned.
 */
export function badgeProgress(m: Member, key: BadgeKey): number {
  const b = CONFIG.badges
  const ratio = (cur: number, target: number): number => clamp100(Math.round((100 * cur) / target))
  switch (key) {
    case 'workhorse':
      return ratio(volumeScore(m.strings), b.workhorseVolumeScore)
    case 'polyglot':
      return ratio(m.langs.length, b.polyglotLangs)
    // Native Voice needs a single language; with several, focusing isn't "near".
    case 'nativevoice':
      return m.langs.length <= 1 ? ratio(m.strings, b.nativeVoiceStrings) : 0
    case 'cleanhands':
      return ratio(m.cleanRate, b.cleanHandsRate)
    case 'qaghost':
      return ratio(m.qaPass, b.qaGhostPass)
    case 'guardian':
      return ratio(m.mix.review, b.guardianReviewMix)
    case 'aitamer':
      return ratio(m.aiFixed, b.aiTamerFixed)
    case 'maga':
      return ratio(m.magaCount ?? 0, b.magaMentions)
  }
}

/**
 * The unearned badge a member is NEAREST to earning (highest real progress),
 * with that progress and a short nudge (brief §5.6).
 */
export function closestBadge(m: ScoredMember): { key: BadgeKey; progress: number; nudge: string } | null {
  const unearned = BADGE_ORDER.filter((b) => !m.badges.includes(b))
  if (unearned.length === 0) return null
  const next = unearned.reduce((best, b) => (badgeProgress(m, b) > badgeProgress(m, best) ? b : best))
  const nudges: Record<BadgeKey, string> = {
    workhorse: 'keep translating — volume is building',
    polyglot: 'contribute in one more language',
    nativevoice: 'deepen focus on your main language',
    cleanhands: 'keep getting accepted without edits',
    qaghost: 'keep QA checks from triggering as you add strings',
    guardian: 'catch and fix more flagged issues',
    aitamer: 'correct more machine output',
    maga: 'write “maga” a few more times 🧢',
  }
  return { key: next, progress: badgeProgress(m, next), nudge: nudges[next] }
}

// ── Fetch hooks (real backend; no mock) ─────────────────────────────────────
// Raw signals come from /api/contributors; trust/tier/preliminary are derived
// here via `score`. Standalone (no projectId) → empty, never mock.

export type TeamState = {
  team: ScoredMember[]
  loading: boolean
  empty: boolean
  error: string | null
  reload: () => void
}

/** Bumps whenever the window regains focus — included in fetch deps so stats
 *  refresh after the user edits translations in Tolgee and returns to the tab. */
function useFocusKey(): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const bump = () => setKey((k) => k + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [])
  return key
}

/** The whole team for the dashboard. `projectId` undefined (standalone) → empty. */
export function useContributors(projectId: number | undefined): TeamState {
  const focusKey = useFocusKey()
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)
  const [state, setState] = useState<Omit<TeamState, 'reload'>>({
    team: [],
    loading: projectId != null,
    empty: false,
    error: null,
  })
  useEffect(() => {
    if (projectId == null) {
      setState({ team: [], loading: false, empty: true, error: null })
      return
    }
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(`/api/contributors?projectId=${projectId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { ok?: boolean; members?: Member[]; error?: string }) => {
        if (!d.ok || !d.members) throw new Error(d.error ?? 'no data')
        const team = d.members.map(score)
        setState({ team, loading: false, empty: team.length === 0, error: null })
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        // An error is NOT "no data": keep whatever we last loaded (so a transient
        // Tolgee rate-limit / hiccup doesn't blank the view) and surface the error.
        setState((s) => ({
          team: s.team,
          loading: false,
          empty: false,
          error: e instanceof Error ? e.message : String(e),
        }))
      })
    return () => ctrl.abort()
  }, [projectId, focusKey, reloadKey])
  return { ...state, reload }
}

export type MeState = { member: ScoredMember | null; loading: boolean; error: string | null }

/** The calling user's own card for the panel. Needs the iframe context `token`
 *  so the server can identify the user (install auth has no user identity). */
export function useContributorMe(projectId: number | undefined, token: string | undefined): MeState {
  const focusKey = useFocusKey()
  const [state, setState] = useState<MeState>({ member: null, loading: projectId != null && !!token, error: null })
  useEffect(() => {
    if (projectId == null || !token) {
      setState({ member: null, loading: false, error: null })
      return
    }
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(`/api/contributors/me?projectId=${projectId}`, {
      headers: { 'X-Tolgee-Context': token },
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { ok?: boolean; member?: Member | null; error?: string }) => {
        if (!d.ok) throw new Error(d.error ?? 'no data')
        setState({ member: d.member ? score(d.member) : null, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setState({ member: null, loading: false, error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [projectId, token, focusKey])
  return state
}

// ── Dummy data — STANDALONE local preview ONLY ──────────────────────────────
// The real app fetches from /api/contributors; this is so the views are
// demoable locally (no backend). Avatars use pravatar so the photo shows too.
const dummy = (
  id: number,
  name: string,
  img: number,
  langs: string[],
  strings: number,
  strings30: number,
  aiFixed: number,
  lastActive: number,
  cleanRate: number,
  qaPass: number,
  survival: number,
  mix: Mix
): Member => ({
  id,
  name,
  initials: name.split(' ').slice(0, 2).map((w) => w[0]).join(''),
  email: `${name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`,
  avatarUrl: `https://i.pravatar.cc/96?img=${img}`,
  langs,
  langFlags: Object.fromEntries(langs.map((t) => [t, DUMMY_FLAGS[t] ?? ''])),
  strings,
  windows: { all: { strings, mix }, '30d': { strings: strings30, mix } },
  aiFixed,
  lastActive,
  cleanRate,
  qaPass,
  survival,
  mix,
  badges: [],
})

const DUMMY_FLAGS: Record<string, string> = {
  sv: '🇸🇪', no: '🇳🇴', da: '🇩🇰', fi: '🇫🇮', sk: '🇸🇰', cs: '🇨🇿',
  pl: '🇵🇱', en: '🇬🇧', fr: '🇫🇷', it: '🇮🇹', ja: '🇯🇵',
}

export const MOCK_TEAM: Member[] = [
  dummy(1, 'Sara Lind', 5, ['sv', 'no', 'da', 'fi'], 2950, 700, 880, 4, 95, 97, 92, { postedit: 40, scratch: 35, review: 25 }),
  dummy(2, 'Lucia Varga', 32, ['sk', 'cs', 'pl'], 4820, 980, 1230, 2, 91, 96, 89, { postedit: 65, scratch: 20, review: 15 }),
  dummy(3, 'Tomáš Novák', 12, ['cs', 'en'], 1340, 410, 360, 0, 78, 92, 85, { postedit: 30, scratch: 5, review: 65 }),
  dummy(4, 'Émile Roche', 14, ['fr'], 6200, 0, 1510, 150, 84, 88, 80, { postedit: 45, scratch: 40, review: 15 }),
  dummy(5, 'Marco Bianchi', 53, ['it', 'en'], 980, 210, 240, 7, 72, 80, 74, { postedit: 35, scratch: 5, review: 60 }),
  dummy(6, 'Yuki Tanaka', 60, ['ja'], 340, 40, 210, 95, 74, 80, 71, { postedit: 25, scratch: 65, review: 10 }),
]

export const MOCK_SCORED: ScoredMember[] = MOCK_TEAM.map(score)
export const MOCK_MEMBER: ScoredMember = MOCK_SCORED[1]
