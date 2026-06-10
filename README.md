# Statistics — Tolgee App

A [Tolgee App](https://docs.tolgee.io/apps) that measures **how accurate AI
machine-translation is** in a project: for every translation that AI produced
and a human later **reviewed**, it compares the AI's text with the final
approved text and reports a **match score**. The higher the score, the less the
reviewer had to change — i.e. the better the AI did.

It adds two surfaces to Tolgee:

- **Dashboard page** — match-score donut, average-match + reviewed gauges, and a
  per-language breakdown, filterable by language and time period.
- **Translations tools panel** — the same summary for the language of the
  focused translation.

> Built on `@tolgee/apps-sdk`. Alpha — not for production-critical workflows.

## What "match score" means

For each **reviewed** translation the server walks its edit history, finds the
text the AI last produced **at the moment of review**, and compares it to the
final reviewed text using a **word-level edit distance** (0–100%). Scores are
bucketed:

| Bucket | Meaning |
| --- | --- |
| **100% Match** | reviewer kept the AI text unchanged |
| 99–90% / 89–80% / 79–70% | progressively more editing |
| **< 70%** | AI text largely rewritten |
| **Not reviewed** | AI-translated but not yet reviewed (no score yet) |

Counts are **word-weighted**. Languages never machine-translated are shown as
*"Not translated by AI"*. The time filter is based on the **review date**.

## How it works

```
Dashboard / panel (iframe)  ──GET /api/match?projectId&langs&range──▶  Express server
        ▲  progressive, per-language                                        │
        └──────────────── JSON aggregate ◀────────────  X-API-Key ──▶  Tolgee REST API
                                                        (translations + per-translation history)
```

- The **server** computes everything and authenticates to Tolgee with the
  install **`clientSecret`** (`X-API-Key`) — no iframe token forwarding.
- Per-translation results are **cached** (keyed by text + state); webhooks
  invalidate touched entries so the dashboard stays fresh.
- The dashboard fetches **one language at a time** and renders progressively
  (skeletons while the rest compute).

**Scopes:** `translations.view`, `keys.view`, `activity.view`
**Webhooks:** `SET_TRANSLATIONS`, `SET_TRANSLATION_STATE`, `CREATE_KEY`, `KEY_DELETE`

## Quick start

```bash
npm install        # if you skipped it during scaffolding
npm run dev        # terminal 1: Vite (5180) + Express (5181) + Cloudflare tunnel
npm run register   # terminal 2, first run only: pick your org, approve the install
```

Start `dev` **before** `register`. The install record written by `register`
(`.tolgee-dev/install.json`) holds the `clientSecret` the server uses to call
Tolgee, plus the webhook secret. Each `dev` restart re-points the install at the
fresh tunnel URL — no manual reinstall.

Then open a project in Tolgee, enable the **Statistics** app on it, and open the
**Dashboard**. To see real match scores, machine-translate a few keys and mark
some as **Reviewed**.

> The standalone preview at `http://localhost:5180/dashboard` shows **mock**
> data (it has no Tolgee context). Real data only renders inside the Tolgee iframe.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + Express + dev tunnel |
| `npm run register` | One-time browser install (first run only) |
| `npm run typecheck` | `tsc -b` — run after every change |
| `npm run build` | Production build |
| `npm run pull-context` | Download SDK source + docs into `.context/` (gitignored) |

## Project structure

```
server/
  index.ts              Express wiring (webhook before json(), CORS)
  tolgeeApi.ts          X-API-Key auth + translations/history fetchers
  match.ts              match pipeline: history → AI vs reviewed → buckets, cache
  similarity.ts         word/char edit-distance scorers + bucketing
  aiOrigin.ts           shared "is this change AI?" rule (used by store + match)
  store.ts              per-translation records for the tools panel (/api/state)
  routes/               manifest · webhook · decorators · stats (/api/state) · match (/api/match)
  manifest.template.json  modules, scopes, webhooks
src/modules/dashboard/  dashboard page (recharts) + matchData hook + matchView
src/modules/toolsPanel/ translations panel
```

The match types are mirrored between server (`match.ts`) and client
(`matchData.ts`); run `npm run typecheck` after changes.
