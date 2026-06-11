# How the dashboard/panel gets AI match scores (data pipeline)

A developer-facing description of where the numbers come from.

## TL;DR

- The match scores come from **Tolgee's native, pre-aggregated endpoint**
  `GET /v2/projects/{id}/ai-match-stats` (+ `/languages`). Tolgee reconstructs
  "what the AI produced vs. what the human approved", scores it word-level, and
  returns the word-weighted buckets/totals already aggregated.
- This app no longer reconstructs anything. The old **N+1** (one
  `/translations/{id}/history` call per reviewed translation) is **gone**, and so
  is the per-translation cache and the cache-invalidating webhook.
- **The time range is pushed into Tolgee** (SQL), so `Last minute` is cheap.

## Auth & scopes

`server/tolgeeApi.ts` calls Tolgee with the install `clientSecret` as an
`X-API-Key` header (from `.tolgee-dev/install.json`, written by `npm run
register`). The match feature needs only **`translations.view`**. (The unrelated
"Improve AI accuracy" links still use `prompts.view`; the tools panel still uses
the webhook — see below.)

All calls go through one helper: `tolgeeFetch<T>(path, qs)` → `GET {tolgeeUrl}{path}?{qs}`.

## Endpoints we call

| Purpose | Endpoint | Params |
| --- | --- | --- |
| Project summary (buckets + totals) | `GET /v2/projects/{id}/ai-match-stats` | `languages` (repeatable), `reviewedAfter` (epoch ms) |
| Per-language rows | `GET /v2/projects/{id}/ai-match-stats/languages` | same |
| Project languages (pickers / AI-context) | `GET /v2/projects/{id}/languages` | `size=1000`, process-cached |

`reviewedAfter` is derived from the dashboard's range preset (`rangeStartMs`);
the upper bound is always "now" so `reviewedBefore` is omitted. `all` → omit
`reviewedAfter` entirely.

## The pipeline (`server/match.ts → computeMatch`)

Entry point: `GET /api/match?projectId=&langs=cs,de&range=today|last7|last30|all|last1min|last5min|last1h`.

1. Map `range` → `reviewedAfter` epoch ms (`rangeStartMs`).
2. Fetch the summary and the per-language breakdown **in parallel**
   (`fetchAiMatchSummary` + `fetchAiMatchLanguages`) for the requested tags.
3. Map the native response (camelCase) into the dashboard's existing
   `MatchResponse` shape (snake_case `*_pct`, nested `totals`) — so the frontend
   is unchanged. That's the whole server now: no history walk, no scoring, no
   cache. The base language is excluded by Tolgee, so passing it yields no rows.

> `scorer=word|char` is still accepted on `/api/match` but ignored — scoring is
> fixed word-level server-side in Tolgee.

## Caching & freshness

- No per-translation cache here anymore. Tolgee materializes the scores and keeps
  them current on read (incrementally, watermark-gated), so reads are fast.
- The summary carries `upToDate`/`generatedAt`. For a normal project the first
  call is already complete (`upToDate: true`). For a very large project the
  first-ever call can return partial data while Tolgee finishes a bounded
  backfill; re-fetch (the dashboard's "Generate" button) until `upToDate` is true.
  *(The dashboard does not yet surface this — a small future enhancement.)*
- `langCache`: project languages cached for the process lifetime.

## What this app still does itself (NOT the match stats)

- **Tools panel** (`/api/state`, `server/store.ts`): per-cell `origin`/`reviewed`
  fed by the `SET_TRANSLATIONS` / `SET_TRANSLATION_STATE` webhooks. Unrelated to
  the dashboard aggregate. (Could later be read live from `translation.auto` +
  `state` instead of the webhook store.)
- **"Improve AI accuracy" links** (`fetchAiContext`): a few cheap settings reads.

## Files

- `server/tolgeeApi.ts` — auth, `tolgeeFetch`, `fetchAiMatchSummary` /
  `fetchAiMatchLanguages` (+ `getProjectLanguages`, `fetchAiContext`).
- `server/match.ts` — `computeMatch`: calls the two endpoints, maps to `MatchResponse`.
- `server/routes/match.ts` — `/api/match` (range validation).
- `src/modules/dashboard/matchData.ts` — client hook `useMatchData` (unchanged).
