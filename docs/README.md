# Pick8 documentation index

Pick8 was forked from Who You Got (WYG). Most files in this folder pre-date the fork's Pick8
rewrite and describe WYG. **Trust code and `supabase/migrations/` first**, then the *current* docs.

| Status | File | Notes |
|---|---|---|
| **Current** | [ARCHITECTURE.md](ARCHITECTURE.md) | System map, data flow, Pick8 ↔ WYG contract |
| **Current** | [DEVELOPMENT.md](DEVELOPMENT.md) | Branching, PRs, validation, release, known failing checks |
| **Current** | [pick8-operations.md](pick8-operations.md) | Env vars, cron, runbook, backup/recovery, environments |
| **Current** | [BACKLOG.md](BACKLOG.md) | Recorded (unimplemented) feature backlog + dependencies |
| Partly current | [OPERATIONS.md](OPERATIONS.md) | Only the "Pick8 …" sections (signup/automation, ~L396–470; Monitoring, L1600+). Its scoring "not a transaction" remarks are superseded. Rest is WYG. |
| Current, narrow | [transactional-scoring-verification.md](transactional-scoring-verification.md), [result-sync-due-state-redesign.md](result-sync-due-state-redesign.md) | Design/verification notes for the shipped scoring and due-state models |
| **WYG / stale** | PROJECT_CONTEXT, RELEASE_CHECKLIST (except its "Pick8 MVP" section), ROADMAP, DATABASE_SCHEMA, FUTURE_*, 2.0*, `2026-*.sql` | Do not follow. `docs/*.sql` must never be applied to Pick8's database. |

Known contradictions inside the stale docs (so nobody acts on them): they name the production URL as
`whoyougot.ie` (that is WYG's), describe the cron routes' authentication differently from the live code
(`authorizePick8Cron`: Bearer only), and describe `profiles.role/status`, `gameweeks`, `predictions`,
`leaderboard_entries` (none exist in Pick8's schema).
