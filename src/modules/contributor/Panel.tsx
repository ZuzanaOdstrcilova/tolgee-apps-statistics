import { useState } from 'react'
import { FormControl, MenuItem, Select } from '@mui/material'
import { FONT } from '../../theme/typography'
import {
  BADGES,
  BADGE_ORDER,
  TIER_META,
  volumeFor,
  type RangeKey,
  type ScoredMember,
} from './data'
import {
  BadgeIcon,
  C,
  MemberAvatar,
  ContributorEmpty,
  ContributorPanelSkeleton,
  MeterBar,
  MixBar,
  MixLegend,
} from './view'

// Contributor panel (brief §5): a compact card beside the editor, one person,
// same data as the dashboard. Width ~320–420px. Vertical stack:
// header → trust ring → how-you-work → stats → badges → closest badge.

function StatRow({
  label,
  value,
  meter,
  meterColor,
}: {
  label: string
  value: string
  meter?: number
  meterColor?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ ...FONT.caption, color: C.dim }}>{label}</span>
        <span style={{ ...FONT.label, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      {meter !== undefined && <MeterBar value={meter} color={meterColor} />}
    </div>
  )
}

const RANGE_OPTS: { value: RangeKey; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

export function ContributorPanel({
  member,
  loading = false,
}: {
  member: ScoredMember | null
  loading?: boolean
}) {
  const [range, setRange] = useState<RangeKey>('all')
  if (loading) return <ContributorPanelSkeleton />
  if (!member) return <ContributorEmpty panel message="Your contributor stats appear once you have translation activity in this project." />
  const cleanColor = member.cleanRate >= 85 ? '#22c39a' : member.cleanRate >= 70 ? '#d8a008' : '#e6256b'
  const trustColor =
    TIER_META[member.trust >= 85 ? 'core' : member.trust >= 65 ? 'trusted' : 'new'].color
  const unearned = BADGE_ORDER.filter((b) => !member.badges.includes(b))

  return (
    <div
      style={{
        fontFamily: 'inherit',
        color: C.text,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth: 420,
      }}
    >
      {/* Header: bigger photo + trust score + earned badges (compact) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <MemberAvatar member={member} size={76} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ ...FONT.display, fontSize: 34, lineHeight: 1, color: trustColor }}>
              {member.trust}
            </span>
            <span style={{ ...FONT.micro, fontWeight: 700, color: trustColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Trust score
            </span>
          </div>
        </div>
      </div>

      {/* Earned badges */}
      {member.badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: -6 }}>
          {member.badges.map((b) => (
            <BadgeIcon key={b} badge={b} earned size={36} />
          ))}
        </div>
      )}

      {/* How you work */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ ...FONT.micro, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          How you work
        </span>
        <MixBar mix={member.mix} height={12} />
        <MixLegend mix={member.mix} withPct />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ ...FONT.label, color: C.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {volumeFor(member, range).toLocaleString('en-US')}{' '}
            <span style={{ ...FONT.label, fontWeight: 700, color: C.dim }}>strings</span>
          </span>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              MenuProps={{ disableScrollLock: true, slotProps: { paper: { style: { maxHeight: 280 } } } }}
            >
              {RANGE_OPTS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        <StatRow
          label="Accepted without edits"
          value={`${member.cleanRate}%`}
          meter={member.cleanRate}
          meterColor={cleanColor}
        />
        <StatRow
          label="Post-edits that survived review"
          value={`${member.survival}%`}
          meter={member.survival}
          meterColor="#22c39a"
        />
        <StatRow label="AI translations you fixed" value={member.aiFixed.toLocaleString('en-US')} />
      </div>

      {/* Badges still to earn (greyed) */}
      {unearned.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
          <span style={{ ...FONT.micro, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Badges to earn
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {unearned.map((b) => (
              <span key={b} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 58 }}>
                <BadgeIcon badge={b} earned={false} size={40} />
                <span style={{ ...FONT.nano, color: C.faint, textAlign: 'center', lineHeight: 1.2 }}>
                  {BADGES[b].label}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
