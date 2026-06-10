import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  type SelectChangeEvent,
} from '@mui/material'
import { Flag } from '../../lib/flag'

// Design-kit showcase of the MUI components we reuse, themed to Tolgee and
// matched to Tolgee's own UI (typography scale, button radius 3 / 40px tall,
// label-ABOVE form fields, uppercase tabs with a pink indicator). Standalone-
// only (the dashboard's "Design kit" tab); never ships in the production iframe.

const LANGS: [string, string][] = [
  ['en', 'English'],
  ['fr', 'French'],
  ['de', 'German'],
  ['es', 'Spanish'],
]

// Sample languages for the DS (Tolgee gives real flags via flagEmoji).
const DS_LANGS: { tag: string; name: string; flag: string; base?: boolean }[] = [
  { tag: 'en', name: 'English', flag: '🇬🇧', base: true },
  { tag: 'de', name: 'German', flag: '🇩🇪' },
  { tag: 'fr', name: 'French', flag: '🇫🇷' },
  { tag: 'cs', name: 'Czech', flag: '🇨🇿' },
]

// Subtle/light chip — the unobtrusive label used e.g. next to a page title.
export const SUBTLE_CHIP = {
  height: 22,
  fontSize: 12,
  fontWeight: 500,
  bgcolor: 'var(--s-line-soft)',
  color: 'text.secondary',
  border: 'none',
} as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: 2.5,
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 500, mb: 2 }}>{title}</Typography>
      {children}
    </Box>
  )
}

// Tolgee's form pattern: a small grey label ABOVE the field (not MUI's
// floating notched label). `label` is optional — some fields have none.
function Field({
  label,
  children,
  sx,
}: {
  label?: string
  children: React.ReactNode
  sx?: object
}) {
  return (
    <Stack spacing={0.75} sx={{ minWidth: 220, ...sx }}>
      {label && (
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{label}</Typography>
      )}
      {children}
    </Stack>
  )
}

export default function ComponentsShowcase() {
  const [tab, setTab] = useState(0)
  const [name, setName] = useState('Demo project')
  const [base, setBase] = useState('en')
  const [formLangs, setFormLangs] = useState<string[]>(['en', 'de'])
  const [langs, setLangs] = useState<string[]>(['en', 'de'])
  const [checked, setChecked] = useState(true)
  const [on, setOn] = useState(true)

  const onMulti = (e: SelectChangeEvent<string[]>) => {
    const v = e.target.value
    setLangs(typeof v === 'string' ? v.split(',') : v)
  }
  const onFormMulti = (e: SelectChangeEvent<string[]>) => {
    const v = e.target.value
    setFormLangs(typeof v === 'string' ? v.split(',') : v)
  }

  return (
    <Box sx={{ py: 3.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
          Design kit
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          MUI components themed to Tolgee — the building blocks for this app.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
          }}
        >
          <Section title="Typography">
            <Stack spacing={0.5}>
              {(
                [
                  ['h3', 'Heading · 28'],
                  ['h4', 'Page title · 24'],
                  ['h5', 'Heading · 20'],
                  ['h6', 'Section · 18'],
                  ['subtitle2', 'Subtitle · 16'],
                  ['body1', 'Body · 16'],
                  ['body2', 'Body (default) · 15'],
                  ['button', 'Button · 14'],
                  ['caption', 'Caption · 12'],
                ] as const
              ).map(([variant, label]) => (
                <Typography key={variant} variant={variant} sx={{ display: 'block' }}>
                  {label}
                </Typography>
              ))}
            </Stack>
          </Section>

          <Section title="Buttons">
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              <Button variant="contained">Save</Button>
              <Button variant="outlined" color="info">
                Leave project
              </Button>
              <Button variant="outlined">Cancel</Button>
              <Button variant="text">Text</Button>
            </Stack>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="contained" size="small">
                Small
              </Button>
              <Button variant="contained" startIcon={<span>＋</span>}>
                Key
              </Button>
              <Button variant="contained" disabled>
                Disabled
              </Button>
            </Stack>
          </Section>

          <Section title="Tabs">
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              textColor="primary"
              indicatorColor="primary"
            >
              <Tab label="General" />
              <Tab label="Advanced" />
              <Tab label="QA checks" />
              <Tab label="Apps" />
            </Tabs>
          </Section>

          <Section title="Chips & badges">
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}
            >
              <Chip label="Last 30 days" size="small" sx={SUBTLE_CHIP} />
              <Chip label="Default" size="small" />
              <Chip label="Primary" color="primary" size="small" />
              <Chip label="Info" color="info" size="small" />
              <Chip label="Outlined" variant="outlined" size="small" />
              <Chip label="Deletable" size="small" onDelete={() => {}} />
            </Stack>
            <Stack direction="row" spacing={4} sx={{ alignItems: 'center' }}>
              <Badge badgeContent={4} color="primary">
                <Button variant="outlined" size="small">
                  Inbox
                </Button>
              </Badge>
              <Badge badgeContent={12} color="error">
                <Button variant="outlined" size="small">
                  Alerts
                </Button>
              </Badge>
              <Badge variant="dot" color="primary">
                <Button variant="outlined" size="small">
                  Updates
                </Button>
              </Badge>
            </Stack>
          </Section>

          <Section title="Languages & flags">
            <Stack spacing={1.25}>
              {DS_LANGS.map((l) => (
                <Stack key={l.tag} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Flag emoji={l.flag} size={18} />
                  <Typography variant="body2">{l.name}</Typography>
                  {l.base && <Chip label="base" size="small" />}
                </Stack>
              ))}
            </Stack>
          </Section>

          <Section title="Inputs — label above">
            <Stack spacing={2}>
              <Field label="Name" sx={{ minWidth: 0 }}>
                <TextField
                  size="small"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                />
              </Field>
              <Field label="Description (markdown)" sx={{ minWidth: 0 }}>
                <TextField
                  size="small"
                  multiline
                  minRows={2}
                  placeholder="Describe your project…"
                  fullWidth
                />
              </Field>
              <Field label="Base language" sx={{ minWidth: 0 }}>
                <FormControl size="small" fullWidth>
                  <Select value={base} onChange={(e) => setBase(e.target.value)}>
                    {LANGS.map(([code, label]) => (
                      <MenuItem key={code} value={code}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Field>
              <Field label="Languages" sx={{ minWidth: 0 }}>
                <FormControl size="small" fullWidth>
                  {/* multi-select with checkboxes + label above */}
                  <Select
                    multiple
                    displayEmpty
                    value={formLangs}
                    onChange={onFormMulti}
                    renderValue={(sel) => (sel as string[]).join(', ') || 'Select languages'}
                  >
                    {LANGS.map(([code, label]) => (
                      <MenuItem key={code} value={code}>
                        <Checkbox checked={formLangs.includes(code)} />
                        <ListItemText primary={label} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Field>
            </Stack>
          </Section>

          <Section title="Inputs — no label">
            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <TextField size="small" placeholder="Search…" />
              <FormControl size="small" sx={{ minWidth: 200 }}>
                {/* multi-select with checkboxes, like Tolgee's language picker */}
                <Select
                  multiple
                  displayEmpty
                  value={langs}
                  onChange={onMulti}
                  renderValue={(sel) => (sel as string[]).join(', ') || 'Languages'}
                >
                  {LANGS.map(([code, label]) => (
                    <MenuItem key={code} value={code}>
                      <Checkbox checked={langs.includes(code)} />
                      <ListItemText primary={label} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Section>

          <Section title="Tooltips">
            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Tooltip title="Approved by reviewers">
                <Button variant="outlined">Hover me</Button>
              </Tooltip>
              <Tooltip arrow title="With an arrow">
                <Button variant="outlined">With arrow</Button>
              </Tooltip>
              <Tooltip arrow placement="top" title="Accuracy = approved / (approved + corrected)">
                <Typography
                  sx={{ fontSize: 13, color: 'text.secondary', textDecoration: 'underline dotted', cursor: 'help' }}
                >
                  What is accuracy?
                </Typography>
              </Tooltip>
            </Stack>
          </Section>

          <Section title="Toggles">
            <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
              <FormControlLabel
                control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
                label="Reviewed only"
              />
              <Divider orientation="vertical" flexItem />
              <FormControlLabel
                control={<Switch checked={on} onChange={(e) => setOn(e.target.checked)} />}
                label="Live updates"
              />
            </Stack>
          </Section>
        </Box>
    </Box>
  )
}
