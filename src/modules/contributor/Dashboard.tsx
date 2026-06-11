import { useEffect, useMemo, useState } from 'react'
import { FormControl, MenuItem, Select, Tooltip as MuiTooltip } from '@mui/material'
import { LanguageSelect, type LangOption } from '../../lib/LanguageSelect'
import { Flag } from '../../lib/flag'
import { InfoTip, TipIcon } from '../dashboard/matchView'
import { FONT } from '../../theme/typography'
import { ICON } from '../../theme/icons'
import {
  BADGES,
  BADGE_ORDER,
  BADGE_HOWTO,
  CONFIG,
  matchesActivity,
  mixFor,
  rankMembers,
  volumeFor,
  type ActivityFilter,
  type RangeKey,
  type RankKey,
  type ScoredMember,
} from './data'
import {
  BadgeRow,
  C,
  MemberAvatar,
  ContributorEmpty,
  ContributorSkeleton,
  MixBar,
  MixLegend,
  TrustPill,
  cardStyle,
} from './view'

// Manager dashboard (brief §4): full team leaderboard. Range controls ONLY the
// volume column; trust & quality always use full history. Same data model and
// visual language as the contributor panel.

// "last active" → relative label; quiet (idle > CONFIG.quietAfterDays) is accented.
function lastActiveLabel(days: number): { text: string; quiet: boolean } {
  const quiet = days > CONFIG.quietAfterDays
  if (days <= 0) return { text: 'active today', quiet: false }
  if (days === 1) return { text: 'yesterday', quiet }
  if (days < 14) return { text: `${days}d ago`, quiet }
  if (days < 60) return { text: `${Math.round(days / 7)}w ago`, quiet }
  return { text: `${Math.round(days / 30)}mo ago`, quiet }
}

const RANK_LABEL: Record<RankKey, string> = {
  trust: 'Trust score',
  volume: 'Volume',
  cleanRate: 'Clean rate',
}

// AI-accuracy filter pattern: a small grey label ABOVE the control.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...FONT.micro, fontWeight: 600, color: C.dim }}>{label}</span>
      {children}
    </div>
  )
}

const MENU_PROPS = { disableScrollLock: true, slotProps: { paper: { style: { maxHeight: 320 } } } } as const

// Same Period options as the AI-accuracy dashboard, mapped to RangeKey windows.
const RANGE_BY_LABEL: Record<string, RangeKey> = {
  'Last minute': 'min',
  'Last 5 minutes': 'min5',
  'Last hour': 'hour',
  Today: 'today',
  'Last week': 'week',
  'Last 30 days': '30d',
  'All time': 'all',
}
const RANGES = Object.keys(RANGE_BY_LABEL)

// (i) for Trust: short, formatted explanation (not one dense paragraph).
function TrustTip() {
  return (
    <MuiTooltip
      arrow
      placement="bottom-start"
      slotProps={{ tooltip: { sx: { maxWidth: 260, p: 1.5 } } }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ ...FONT.micro }}>
            <b>Trust</b> — quality score 0–100 from a person’s whole history.
          </div>
          <div style={{ ...FONT.micro, opacity: 0.85, lineHeight: 1.5 }}>
            Mostly: work accepted unchanged, survives review, and passes QA.
          </div>
          <div style={{ ...FONT.micro, opacity: 0.85, lineHeight: 1.5 }}>
            A little: volume &amp; number of languages.
          </div>
          <div style={{ ...FONT.nano, opacity: 0.7 }}>The period filter never changes it.</div>
        </div>
      }
    >
      <span
        style={{ display: 'inline-flex', cursor: 'help' }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <TipIcon type="info" />
      </span>
    </MuiTooltip>
  )
}

// (i) for the Badges column: lists every badge with its name and how it's earned.
function BadgeLegendTip() {
  return (
    <MuiTooltip
      arrow
      placement="bottom-end"
      slotProps={{ tooltip: { sx: { maxWidth: 'none', p: 1.5 } } }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 320, padding: 4 }}>
          <div style={{ ...FONT.label, fontWeight: 700 }}>Badges &amp; how to earn them</div>
          {BADGE_ORDER.map((b) => (
            <div key={b} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <span style={{ fontSize: 30, lineHeight: 1, flex: 'none', width: 36, textAlign: 'center' }}>
                {BADGES[b].glyph}
              </span>
              <div>
                <div style={{ ...FONT.caption, fontWeight: 700 }}>{BADGES[b].label}</div>
                <div style={{ ...FONT.micro, opacity: 0.85, lineHeight: 1.4 }}>{BADGE_HOWTO[b]}</div>
              </div>
            </div>
          ))}
        </div>
      }
    >
      <span
        style={{ display: 'inline-flex', cursor: 'help' }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <TipIcon type="info" />
      </span>
    </MuiTooltip>
  )
}

const GRID = '40px minmax(320px, 1.7fr) minmax(120px, 1.3fr) 116px 104px 104px 120px'

// The languages a member worked in, shown as flags (fixed 240px block, wraps).
// Falls back to a code chip when a language has no flag emoji.
function LangChips({ langs, flags }: { langs: string[]; flags?: Record<string, string> }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, width: 240 }}>
      {langs.map((l) => {
        const flag = flags?.[l]
        return flag ? (
          <span key={l} title={l.toUpperCase()} style={{ display: 'inline-flex' }}>
            <Flag emoji={flag} size={ICON.sm} />
          </span>
        ) : (
          <span
            key={l}
            style={{
              ...FONT.nano,
              fontWeight: 600,
              textTransform: 'uppercase',
              color: C.dim,
              background: C.lineSoft,
              border: `1px solid ${C.line}`,
              borderRadius: 4,
              padding: '1px 5px',
              letterSpacing: '0.04em',
            }}
          >
            {l}
          </span>
        )
      })}
    </span>
  )
}

function HeadCell({
  children,
  info,
  center = false,
}: {
  children?: React.ReactNode
  /** Optional explanation revealed via an (i) tooltip. */
  info?: string
  center?: boolean
}) {
  return (
    <div
      style={{
        ...FONT.nano,
        fontWeight: 600,
        color: C.faint,
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        justifyContent: center ? 'center' : 'flex-start',
      }}
    >
      {children}
      {info && <InfoTip text={info} />}
    </div>
  )
}

function Row({
  member,
  rank,
  range,
}: {
  member: ScoredMember
  rank: number
  range: RangeKey
}) {
  const top = rank === 1
  const active = lastActiveLabel(member.lastActive)
  const vol = volumeFor(member, range)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID,
        alignItems: 'center',
        gap: 14,
        padding: '20px 8px',
        borderTop: `1px solid ${C.line}`,
      }}
    >
      <div style={{ ...FONT.title, fontWeight: 700, color: top ? C.accent : C.faint, fontVariantNumeric: 'tabular-nums' }}>
        {String(rank).padStart(2, '0')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        <MemberAvatar member={member} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ ...FONT.label, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {member.name}
            </span>
            <span style={{ flex: 'none' }}>
              <TrustPill trust={member.trust} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9 }}>
            <LangChips langs={member.langs} flags={member.langFlags} />
          </div>
        </div>
      </div>

      <div>
        <MixBar mix={mixFor(member, range)} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ ...FONT.label, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
          {vol.toLocaleString('en-US')}
        </div>
        <div style={{ ...FONT.nano, color: active.quiet ? C.accent : C.faint, marginTop: 2, fontWeight: active.quiet ? 600 : 400 }}>
          {active.text}
        </div>
      </div>

      <div>
        <div style={{ ...FONT.micro, color: C.text, marginBottom: 5, fontVariantNumeric: 'tabular-nums' }}>
          {member.cleanRate}%
        </div>
        <div style={{ width: 88 }}>
          <MeterClean value={member.cleanRate} />
        </div>
      </div>

      <div>
        <div style={{ ...FONT.micro, color: C.text, marginBottom: 5, fontVariantNumeric: 'tabular-nums' }}>
          {member.qaPass}%
        </div>
        <div style={{ width: 88 }}>
          <MeterClean value={member.qaPass} />
        </div>
      </div>

      <div>
        <BadgeRow badges={member.badges} />
      </div>
    </div>
  )
}

// Thin clean-rate meter coloured by the value (reuses the green→amber scale).
function MeterClean({ value }: { value: number }) {
  const color = value >= 85 ? '#22c39a' : value >= 70 ? '#d8a008' : '#e6256b'
  return (
    <div style={{ height: 6, borderRadius: 999, background: C.track, overflow: 'hidden' }}>
      <div style={{ width: `${value}%`, height: '100%', borderRadius: 999, background: color }} />
    </div>
  )
}

export function ContributorDashboard({
  team,
  languages = [],
  loading = false,
  empty = false,
}: {
  team: ScoredMember[]
  /** Project languages (name + base) for the Languages filter — same as AI accuracy. */
  languages?: LangOption[]
  loading?: boolean
  empty?: boolean
}) {
  // Period mirrors AI accuracy's full range list. Volume only has two buckets
  // (30-day vs all-time), so any range shorter than All time uses the 30-day
  // figure until the backend exposes finer windows.
  const [periodLabel, setPeriodLabel] = useState('All time')
  const range: RangeKey = RANGE_BY_LABEL[periodLabel] ?? 'all'
  const [activity, setActivity] = useState<ActivityFilter>('any')
  const [rankBy, setRankBy] = useState<RankKey>('trust')

  // Languages filter mirrors AI accuracy: selected = non-base tags, default ALL.
  const selectableTags = useMemo(
    () => languages.filter((l) => !l.base).map((l) => l.tag),
    [languages]
  )
  const [langSel, setLangSel] = useState<string[]>([])
  // Default to all non-base once project languages are known (resets if they change).
  useEffect(() => setLangSel(selectableTags), [selectableTags])

  const allLangsSelected = selectableTags.length > 0 && langSel.length === selectableTags.length
  // Active only on a partial selection; "All languages" (or no project langs) = no filter.
  const langFilterActive = selectableTags.length > 0 && !allLangsSelected

  const rows = useMemo(() => {
    const filtered = team.filter(
      (m) =>
        matchesActivity(m, activity) &&
        (!langFilterActive || m.langs.some((l) => langSel.includes(l)))
    )
    return rankMembers(filtered, rankBy, range)
  }, [team, activity, rankBy, range, langSel, langFilterActive])

  // Any translating/reviewing in the selected period? (mix is empty when none).
  const hasContribution = rows.some((m) => {
    const mx = mixFor(m, range)
    return mx.postedit + mx.scratch + mx.review > 0
  })

  if (loading) return <ContributorSkeleton />
  if (empty || team.length === 0) return <ContributorEmpty />

  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: '0 8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0 16px' }}>
        <h1 style={{ ...FONT.pageTitle, color: C.text, margin: 0 }}>Contributors</h1>
        <span
          style={{
            ...FONT.micro,
            fontWeight: 500,
            color: C.dim,
            background: C.lineSoft,
            padding: '3px 9px',
            borderRadius: 999,
          }}
        >
          {periodLabel}
        </span>
      </div>

      {/* Filters — AI-accuracy style: label above, MUI dropdowns in a card */}
      <div
        style={{
          ...cardStyle,
          padding: '18px 20px',
          marginBottom: 10,
          display: 'flex',
          gap: 22,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <Field label="Languages">
          <LanguageSelect languages={languages} value={langSel} onChange={setLangSel} minWidth={200} />
        </Field>

        <Field label="Activity">
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <Select
              value={activity}
              onChange={(e) => setActivity(e.target.value as ActivityFilter)}
              MenuProps={MENU_PROPS}
            >
              <MenuItem value="any">Any</MenuItem>
              <MenuItem value="postedit">Post-edits AI</MenuItem>
              <MenuItem value="scratch">Translates fresh</MenuItem>
              <MenuItem value="review">Reviews</MenuItem>
            </Select>
          </FormControl>
        </Field>

        <Field label="Period">
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              MenuProps={MENU_PROPS}
            >
              {RANGES.map((o) => (
                <MenuItem key={o} value={o}>
                  {o}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Field>

        <Field label="Rank by">
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={rankBy}
              onChange={(e) => setRankBy(e.target.value as RankKey)}
              MenuProps={MENU_PROPS}
            >
              {(Object.keys(RANK_LABEL) as RankKey[]).map((k) => (
                <MenuItem key={k} value={k}>
                  {RANK_LABEL[k]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Field>
      </div>

      {/* Leaderboard */}
      <div style={{ ...cardStyle, padding: '6px 16px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '12px 8px 8px' }}>
          <HeadCell>Rank</HeadCell>
          <HeadCell>Member · Trust <TrustTip /></HeadCell>
          <HeadCell info="How this person's work splits across post-editing AI, translating from scratch, and reviewing others' work.">
            Contribution
          </HeadCell>
          <HeadCell center>Volume (strings)</HeadCell>
          <HeadCell info="Clean rate — share of their work accepted without any change at review.">Clean</HeadCell>
          <HeadCell info="QA pass — share of their strings that triggered no QA check.">QA</HeadCell>
          <HeadCell>Badges <BadgeLegendTip /></HeadCell>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...FONT.caption, color: C.faint, textAlign: 'center', padding: '28px 0' }}>
            No contributors match these filters.
          </div>
        ) : !hasContribution ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '32px 0' }}>
            <div style={{ ...FONT.subtitle, color: C.dim }}>No contribution in this period</div>
            <div style={{ ...FONT.caption, color: C.faint }}>
              Nobody translated or reviewed in “{periodLabel}”. Try a longer period.
            </div>
          </div>
        ) : (
          rows.map((m, i) => <Row key={m.id} member={m} rank={i + 1} range={range} />)
        )}
      </div>

      {/* Legend */}
      <div style={{ margin: '16px 4px 32px' }}>
        <MixLegend />
      </div>
    </section>
  )
}
