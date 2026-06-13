# Proposal: a native `contributor-stats` endpoint

A request to Tolgee (mirrors what `ai-match-stats` did for the match feature):
push the per-user contribution aggregation into the platform, so this app can
drop its activity-log reconstruction and become a thin adapter.

## Why

The **Contributor** dashboard + panel rank the people working on a project by how
much and how well they translate. Today the app reconstructs every per-user
signal client-side in `server/contributors.ts` by walking the **entire project
activity log** (`GET /v2/projects/{id}/activity`, paged) and cross-referencing
the current translations and QA issues.

That walk is the same class of problem `ai-match-stats` already solved for match:

- It is **O(all activity)** and cannot be filtered — `GET …/activity` only takes
  `page`/`size`/`sort`/`branch`, so there is no way to scope it by user, by event
  type, or by time. Every dashboard load re-reads the whole log.
- It is **expensive and rate-limit-prone** — exactly the cost that forced the
  match feature into stale-while-revalidate / snapshot / "frozen" workarounds,
  all of which we deleted the moment the native match endpoint landed.
- The **time-window filters** (Last minute … Last 30 days) are computed in-app by
  re-bucketing the whole log per request, instead of being pushed into SQL.

There is currently **no native per-user aggregate** to read instead. The app
recovers names + avatars from the activity events themselves (which works today),
but that's incidental: it only sees people who appear in the walked log, and the
one authoritative roster endpoint (`GET /v2/projects/{id}/users`) requires a
**super-JWT** that an app's `X-API-Key` install token can't obtain. Returning
identity on this endpoint would make it authoritative instead of scraped.

## Responsibility split (important)

This app does **not** want Tolgee to compute "trust". The trust score, the
tiers (new / trusted / core), the badges, and the "preliminary" flag are **this
app's product opinion** and stay client-side — same as the match feature maps
Tolgee's buckets onto its own UI. The endpoint should return only the **raw
per-user signals**; the app keeps the scoring.

| Lives in Tolgee (this endpoint) | Stays in the app |
| --- | --- |
| Per-user counts: edits, postedits, scratch, reviews, clean/clean-postedit, langs, QA | Trust formula + weights |
| Identity (id, name, username, avatar) | Tier thresholds, "preliminary" |
| Time-range pushdown (`after`/`before`) | Badges (incl. the "maga" joke) |
| Drops deleted strings (alive-aware) | Mix percentages, ranking, UI |

## Proposed shape

```
GET /v2/projects/{projectId}/contributor-stats
    ?after={epochMs}        # optional lower bound on event time (omit = all time)
    &before={epochMs}       # optional upper bound (omit = now)
    &languages={tag}…       # optional repeatable filter; omit = all languages
```

Mirrors `ai-match-stats`: epoch-ms range pushed into SQL, repeatable `languages`,
authenticated by the install `X-API-Key`, needs `activity.view` + `translations.view`.

```jsonc
{
  "generatedAt": 1781372919274,
  "perUser": [
    {
      "user": { "id": 42, "username": "abby@…", "name": "Abby", "avatar": { "large": "…", "thumbnail": "…" }, "deleted": false },

      "strings":        73,   // distinct translations this user authored the current text of
      "languages":      ["de","fr"],   // distinct languages touched
      "lastActiveAt":   1781300000000,

      // action mix (counts; the app turns these into %)
      "postedit":       40,   // edited an AI-produced translation
      "scratch":        28,   // wrote a translation from empty
      "review":          5,   // review state transitions performed

      // quality signals
      "reviewedEdits":      31,  // of this user's edits, how many later reached review
      "cleanEdits":         24,  // …of those, accepted unchanged (→ cleanRate)
      "reviewedPostedits":  18,  // postedits that reached review
      "cleanPostedits":     15,  // …accepted unchanged (→ survival)
      "ownedAlive":         60,  // current translations whose text this user set (deleted keys excluded)
      "ownedWithQaIssue":    3   // …that currently have an unresolved QA issue (→ qaPass)
    }
  ]
}
```

Every field maps 1:1 onto a tally the app already computes in
`server/contributors.ts` (`Acc` / `ContributorMember`):

| Response field | App use |
| --- | --- |
| `strings`, `languages` | volume score, breadth |
| `postedit`/`scratch`/`review` | mix bars, "AI Fixer" badge |
| `reviewedEdits` + `cleanEdits` | `cleanRate` = clean/reviewed |
| `reviewedPostedits` + `cleanPostedits` | `survival` = cleanPostedit/reviewedPostedit |
| `ownedAlive` + `ownedWithQaIssue` | `qaPass` = (owned − withIssue)/owned |
| `user.*` | identity + avatar — authoritative, vs. today scraped from activity events |

The time windows (the dashboard's Period picker) are then just **one call per
window** with different `after` values — exactly how the match dashboard uses
`reviewedAfter` — instead of re-bucketing the whole log in-app.

## What this lets the app delete

- The whole activity-log walk and the `Acc` reconstruction in
  `server/contributors.ts` (~250 lines) → a thin adapter, like `match.ts`.
- `fetchActivity`, the alive-translations intersection, and the QA cross-ref in
  `server/tolgeeApi.ts` (for the contributor path).
- The 60s recompute cache and the webhook-driven invalidation — a pre-aggregated
  endpoint makes reads cheap, the way it did for match.

## Notes / open questions for the platform side

- **"Owned / current text-setter"**: the app defines a string's owner as the last
  human to set its current text. If Tolgee models this differently, the field can
  follow Tolgee's own definition — the app only needs *a* consistent owner.
- **`deleted` users**: keep returning them (with `deleted:true`) so historical
  contributions still show, matching how the app already handles departed members.
- An `upToDate` flag (as `ai-match-stats` has, for first-backfill) would be handy
  but isn't required for the UI.
