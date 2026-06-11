# How the dashboard/panel computes AI match scores (data pipeline)

A developer-facing description of where the numbers come from, which Tolgee
endpoints we call, how pagination is handled, and where it gets slow.

## TL;DR

- We do **not** read Tolgee's **Activity Log** API. The match scores are
  reconstructed from **translations + per-translation history**.
- The expensive part is an **N+1**: for every REVIEWED translation we fetch its
  full **history** (`/translations/{id}/history`) to recover "what the AI
  produced vs. what the human approved", then diff/score them.
- **Time range is applied *after* fetching** — `Last minute` costs the same as
  `All time`. A server- or Tolgee-side filter/aggregate would be the biggest win.

## Auth & scopes

`server/tolgeeApi.ts` talks to Tolgee with the **install `clientSecret` as an
`X-API-Key`** header (from `.tolgee-dev/install.json`, written by
`npm run register`). It does **not** forward the iframe's context token. Granted
scopes (manifest): `translations.view`, `keys.view`, `activity.view`,
`prompts.view`. Effective permission = app scopes ∩ caller's project rights.

All calls go through one helper: `tolgeeFetch<T>(path, qs)` → `GET {tolgeeUrl}{path}?{qs}`.

## Endpoints we call

| Purpose | Endpoint | Params | Paginated? |
| --- | --- | --- | --- |
| Project languages | `GET /v2/projects/{id}/languages` | `size=1000` | one page (≤1000), **process-cached** |
| Reviewed cells (per lang) | `GET /v2/projects/{id}/translations` | `languages={tag}`, `filterState={tag},REVIEWED`, `size=200`, `cursor` | **yes, cursor — fully paged** |
| Not-reviewed AI cells | `GET /v2/projects/{id}/translations` | `languages={tag}`, `filterAutoTranslatedInLang={tag}`, `size=200`, `cursor` | **yes, cursor — fully paged** |
| Per-translation history | `GET /v2/projects/{id}/translations/{tid}/history` | `size=100`, `page=0` | **NO — first page only** |
| AI context (panel/dashboard links) | `ai-prompt-customization`, `language-ai-prompt-customizations`, `prompts` | — | single calls, best-effort |

**`activity.view` is granted but the match pipeline does not use the activity
feed.** Activity events arrive via **webhooks** (`SET_TRANSLATIONS`,
`SET_TRANSLATION_STATE`, …) and are only used to invalidate the per-translation
cache / the legacy `/api/state` store — not to compute match scores.

## The pipeline (`server/match.ts → computeMatch`)

Entry point: `GET /api/match?projectId=&langs=cs,de&range=today|last7|last30|all|last1min|last5min|last1h[&scorer=word|char]`.

Per requested language `tag` (base language is skipped — no AI to score):

1. **List reviewed** — `fetchReviewedTranslations(projectId, tag)` cursor-pages
   the translations endpoint filtered to `REVIEWED` (200/page, up to
   `MAX_PAGES=1000` ⇒ ≤200k rows).
2. **Resolve each** — `runPool(reviewed, 8, resolveEntry)` — **concurrency 8**.
   `resolveEntry(tid)`:
   - Cache check: `MatchEntry` keyed by `translationId`, validated by a
     **marker = `djb2(currentText)|state`**. Unchanged ⇒ **skip the history
     HTTP call** and reuse the cached score.
   - On miss: `fetchHistory(tid)` (page 0, 100 revisions), walk oldest→newest
     carrying `currentText` and `lastAiText` (an AI revision = `auto`,
     `mtProvider`, or `promptId` set). At each `state→REVIEWED` we snapshot the
     AI text the reviewer saw (`aiTextAtReview`) + `reviewedAt`.
   - **Score** = `scorer(aiText, finalText)` (word-token by default, char-level
     optional) → 0–100. **Bucket** via `bucketOf(score)` (`b100`/`b9990`/
     `b8980`/`b7970`/`bno`). `words = countWords(finalText)`.
3. **Range filter (post-fetch!)** — only entries with `reviewedAt >= rangeStartMs(range)`
   count. Everything is fetched first, then filtered in memory.
4. **Not reviewed** — `fetchNotReviewedAi(projectId, tag)` (cursor-paged) →
   word count for the grey "Not reviewed" segment.
5. **Aggregate** — per-language row (`MatchLangRow`, words + %s per bucket) and
   project totals (`buckets` = words/keys/langs, `reviewedWords/Keys`,
   `notReviewedWords/Keys`, `langCount`), plus a word-weighted `avgMatchScore`
   and `reviewedPct`.

## Pagination — what is and isn't handled

- **Translations: fully paginated** (cursor, all pages). Both the reviewed list
  and the not-reviewed-AI list walk every page.
- **History: NOT paginated** — `fetchHistory` reads only `page=0, size=100`. If a
  translation's `REVIEWED` transition is older than its last 100 revisions, we
  fall back to "most recent AI text + newest revision timestamp", which can
  mis-time or mis-attribute that one row. Fine for typical keys; a known edge.
- **Range is not pushed to the API** — see step 3. Short ranges do **not** reduce
  the number of list/history calls.

## Caching & concurrency

- `langCache`: project languages cached for the **process lifetime** (Map of
  `projectId → Promise`).
- Per-translation `MatchEntry` cache (Map of `translationId → entry`), validated
  by the text+state marker; `invalidateMatch(tid)` drops it (called from
  webhooks when a translation changes). So the **first** compute of a project is
  expensive; subsequent ones only re-fetch history for changed translations.
- `runPool(items, 8, fn)`: at most **8 concurrent** in-flight fetches per call.

## Cost model & where faster endpoints help

For one language with `N` reviewed translations (cold cache):
`ceil(N/200)` list calls **+ N history calls** + `ceil(M/200)` not-reviewed list
calls. The **N history calls dominate**. The dashboard requests one
`/api/match?langs={tag}` **per selected language** (M parallel requests from the
client); the panel requests a single language.

Ideas for faster endpoints (in rough order of impact):

1. **Push the time range to Tolgee** (or pre-filter reviewed translations by
   `reviewedAt`) so short periods fetch far fewer rows. Today range is in-memory
   post-filter.
2. **Avoid the per-translation history N+1.** Options:
   - A **batch history** endpoint (history for many translation ids at once), or
   - Tolgee exposing the **last MT/AI output text (or a precomputed AI-vs-final
     score)** on the translation itself, so no history walk is needed.
3. **Incremental aggregate** — maintain a stored per-project/per-language match
   aggregate updated from **webhook events** (we already receive
   `SET_TRANSLATIONS`/`SET_TRANSLATION_STATE`), and serve `/api/match` from that
   store instead of recomputing. Turns reads O(1).
4. Tune `runPool` concurrency / history page size; add a short-TTL response
   cache keyed by `(projectId, tag, range, scorer)`.

## Files

- `server/tolgeeApi.ts` — auth, `tolgeeFetch`, the fetchers + pagination.
- `server/match.ts` — `computeMatch`, `resolveEntry`, scoring/bucketing, cache.
- `server/similarity.ts` — `wordTokenScore` / `charLevenshteinScore`, `bucketOf`,
  `countWords`.
- `server/routes/match.ts` — `/api/match` (range validation, scorer pick).
- `src/modules/dashboard/matchData.ts` — client hook `useMatchData` (one fetch
  per language, aggregates progressively).
