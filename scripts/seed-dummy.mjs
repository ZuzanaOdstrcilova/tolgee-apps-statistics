// Seeds server/.data/stats.json with realistic dummy data for local UI
// work, so the dashboard has something to render without registering the
// app on Tolgee or firing real webhooks.
//
//   npm run seed:dummy   # then `npm run dev` and open /dashboard
//
// The shape mirrors the `Aggregate` type in server/store.ts. The timeline
// is keyed to the trailing 14 days (UTC) so the chart's rolling window
// picks it up; older keys would be pruned on the first real webhook.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'server', '.data')
const DATA_FILE = join(DATA_DIR, 'stats.json')

const TIMELINE_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

// Deterministic-ish daily activity (no Math.random, so reruns are stable).
const timeline = {}
const todayMs = Date.now()
for (let i = TIMELINE_DAYS - 1; i >= 0; i--) {
  const day = dayKey(todayMs - i * MS_PER_DAY)
  timeline[day] = {
    ai: 4 + ((i * 7) % 11),
    human: 6 + ((i * 5) % 9),
  }
}

const data = {
  // accuracy = approved / (approved + corrected)
  ai: { produced: 320, approved: 210, corrected: 70 }, // → 75%
  human: { produced: 540, approved: 480, corrected: 12 }, // → ~98%
  keys: { created: 128, deleted: 14 },
  timeline,
  // A few per-translation records so the tools panel has data too.
  // Open /tools-panel and these ids resolve via /api/state?ids=...
  records: {
    1001: { origin: 'ai', reviewed: true, updatedAt: new Date(todayMs).toISOString() },
    1002: { origin: 'ai', reviewed: false, updatedAt: new Date(todayMs).toISOString() },
    1003: { origin: 'human', reviewed: true, updatedAt: new Date(todayMs).toISOString() },
  },
}

mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(`Seeded dummy stats → ${DATA_FILE}`)
