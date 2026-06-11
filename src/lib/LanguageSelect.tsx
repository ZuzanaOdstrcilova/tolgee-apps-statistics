import {
  Checkbox,
  Chip,
  Divider,
  FormControl,
  ListItemText,
  MenuItem,
  Select,
  type SelectChangeEvent,
} from '@mui/material'
import { FONT } from '../theme/typography'

// Shared "Languages" multi-select — the exact control from the AI-accuracy
// dashboard, reused by the contributor dashboard so both look/behave the same:
// language NAMES (not codes), the base language shown but disabled with a
// "base" chip, and a tri-state "All languages" row (select-all ↔ clear).
//
// `value` holds the selected non-base tags. Empty = "None"; all selectable
// tags selected = "All languages".

export type LangOption = { tag: string; name: string; base: boolean }

const ALL = '__all__'

export function LanguageSelect({
  languages,
  value,
  onChange,
  minWidth = 240,
}: {
  languages: LangOption[]
  value: string[]
  onChange: (tags: string[]) => void
  minWidth?: number
}) {
  // Selectable languages first; base last (shown but disabled — it's the source).
  const ordered = [...languages].sort((a, b) => Number(a.base) - Number(b.base))
  const selectableTags = languages.filter((l) => !l.base).map((l) => l.tag)
  const allSelected = selectableTags.length > 0 && value.length === selectableTags.length
  const nameOf = (t: string) => languages.find((l) => l.tag === t)?.name ?? t.toUpperCase()

  const onSel = (e: SelectChangeEvent<string[]>) => {
    const v = e.target.value as string[]
    if (v.includes(ALL)) {
      // Tri-state "All languages": checked → clear to none, otherwise select all.
      onChange(allSelected ? [] : selectableTags)
      return
    }
    onChange(v.filter((x) => x !== ALL))
  }

  return (
    <FormControl size="small" sx={{ minWidth }}>
      <Select
        multiple
        displayEmpty
        value={value}
        onChange={onSel}
        // Auto-resized iframes: don't let MUI's scroll-lock mutate <body>; cap height.
        MenuProps={{ disableScrollLock: true, slotProps: { paper: { style: { maxHeight: 360 } } } }}
        renderValue={(sel) => {
          const s = sel as string[]
          if (allSelected) return 'All languages'
          if (s.length === 0) return 'None'
          return s.map(nameOf).join(', ')
        }}
      >
        <MenuItem value={ALL}>
          <Checkbox checked={allSelected} indeterminate={value.length > 0 && !allSelected} />
          <ListItemText primary="All languages" />
        </MenuItem>
        <Divider />
        {ordered.map((l) =>
          l.base ? (
            <MenuItem key={l.tag} value={l.tag} disabled>
              <Checkbox checked={false} disabled />
              <ListItemText
                disableTypography
                primary={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...FONT.body }}>
                    {l.name}
                    <Chip label="base" size="small" />
                  </span>
                }
              />
            </MenuItem>
          ) : (
            <MenuItem key={l.tag} value={l.tag}>
              <Checkbox checked={value.includes(l.tag)} />
              <ListItemText primary={l.name} />
            </MenuItem>
          )
        )}
      </Select>
    </FormControl>
  )
}
