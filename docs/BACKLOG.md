# Feature backlog (recorded, not implemented)

Captured 2026-10-27 after a read-only investigation of both codebases. Each item lists current behaviour
(evidence), approach, risks/dependencies, and acceptance checks. Nothing here has been built.

## Pick8

### P8-1 Homepage: top three of the latest fully settled matchday
- **Homepage** = `/dashboard` (`app/page.tsx` just redirects). The page already loads every profile, matchday and
  entry for the season with the service-role client (`app/(app)/dashboard/page.tsx` ~L100–140), so ranking needs no new query.
- **"Fully settled"**: `matchdays.status = 'completed'` *and* submitted entries have `score_calculated_at` set
  (final scoring only runs when every fixture is finished/postponed/cancelled, see `scorePick8TotalGoals`,
  `isMatchdayReadyForFinalScoring`). Pick the highest `matchday_number` meeting that — not "latest by date".
- **Ties**: standings already use competition ranking (equal points ⇒ equal rank, next rank skips:
  `rerankStandings` in `utils/pick8-standings.ts`). Show every row with rank ≤ 3 (so 1,1,3 or 1,2,2,2 can exceed three
  rows); define a deterministic secondary order for display (display name) without implying a rank difference.
- **Expandable detail**: reuse `buildMatchdayBreakdown` (`utils/pick8-matchday-breakdown.ts`), which already applies
  the reveal rule (`isMatchdayVisibleToAll`). Needs `entry_selections` + fixtures for the top entries only; show
  category, team, `points_awarded`, void picks as 0/“void”, Total Goals prediction vs actual and its points.
- **Risks**: privacy is enforced in application code on this page (service role), so the reveal check must be
  asserted by a test, not assumed; a provider correction can reopen scoring and change the "latest settled" matchday
  and ranks — render from current data, no caching; matchday with no submitted entries ⇒ hide the card.
- **Verify**: unit tests for tie matrix (1,1,3 / 1,2,2 / all equal / <3 players), not-yet-settled, reopened matchday,
  unsubmitted/void entries; mobile 375px check.

### P8-2 Mobile tables overflow the viewport
- Not reproducible from static analysis. Candidates: `/tables` ("Tables" in the mobile nav) uses
  `<table class="min-w-[34rem]">` inside `overflow-x-auto` (`app/(app)/tables/page.tsx:48–49`), i.e. wider than a
  375px screen by design and scrolls inside its card; the leaderboard's fixed `grid-cols-[70px_1fr_100px×4]` is
  `md:`-only; the dashboard itself contains no `<table>`. `ReadOnlyMatchdayPicks` uses `grid-cols-[1fr_auto]`.
- **Approach**: reproduce at 320/375/414px with seeded data (browser pane, logged in, staging DB), identify the
  element whose `scrollWidth > clientWidth`; prefer responsive rows (hide secondary columns < 640px, `min-w-0`,
  `truncate`) over horizontal scrolling for the main tables.
- **Dependency**: a staging DB with realistic data to avoid production access.
- **Verify**: `document.documentElement.scrollWidth <= innerWidth` at 320–430px on dashboard, tables, my-picks,
  admin; no clipped player names or points.

## Who You Got (separate repo; do not edit from Pick8 tasks)

### WYG-1 Explicit localized deadline in reminder and "predictions open" emails
- **Current**: `utils/email-notifications.ts` formats with `Europe/London` hard-coded (`formatKickoffForEmail`,
  `formatTimeForEmail`, ~L190–206). The 24h reminder passes only a **time** (`HH:mm`) as the deadline and its subject
  is "{gameweek} predictions close soon" (~L1396–1408). The "Predictions are open" email (~L1208) lists fixtures but no
  deadline. Locale comes from `profiles.preferred_locale` (`en|fr`); there is **no per-user time-zone column**.
- **Locking semantics**: predictions lock **per fixture** (`isPredictionFixtureOpen` in `utils/prediction-locking.ts`:
  status `scheduled` and kickoff in the future). The reminder's deadline is `actionableFixtures[0].kickoff_at` — the
  earliest still-open fixture the user hasn't predicted, per `prediction-reminder-planning.ts`; keep that, and say in the
  copy that later fixtures lock at their own kickoff. Do not describe a single gameweek-wide deadline.
- **Approach**: one formatter producing weekday + date + time + zone abbreviation (`Intl.DateTimeFormat` with
  `weekday, day, month, hour, minute, timeZoneName:'short'`) in the recipient's locale; time zone = league/default
  (`Europe/London`) unless a user preference is added (schema + settings UI = larger scope; decide first). Put the
  localized string in the subject for reminders. For "open" emails state the first lock time and that others follow.
- **Risks**: email idempotency is keyed by event key (`predictions_open:{gw}:{user}`), not content, so wording changes won't
  re-send, but test with the outbox in a sandbox; DST edge (BST/GMT) and fr translations; i18n keys in `utils/i18n/messages.ts`;
  subject length. **Never test by sending real mail**: use WYG's outbox preflight/sandbox procedure (`EMAIL_OUTBOX_LIVE_ROLLOUT.md` in that repo; verify it supports suppression) or unit-test the rendered strings.

### WYG-2 Clearer recent team form (home/away, W/D/L)
- **Current**: form is built by `utils/team-form-guide.ts` into `FixtureTeamForm` (`components/predictions/types.ts`) and
  rendered in `components/predictions/FixturePredictionCard.tsx`; the card shows a text "No recent form yet" fallback.
  Confirm whether each form entry already carries venue/opponent in the data model before changing UI; if not, extend
  `loadTeamFormGuides` to include it. Needs i18n strings; check mobile width.

### WYG-3 Competition-specific standings for non-base-competition fixtures (e.g. Eredivisie)
- **Current**: standings are keyed by competition code (`getStandingForTeam({competitionCode…})`, lookup keys
  `CODE:id:…`); leagues have a `base_competition_code` and `buildProviderSeasonByCompetition` /
  `filterRowsToProviderCompetitionSeasons` exist. `loadTeamFormGuides` takes per-fixture `external_competition_code`.
  `TeamFormComparison` returns "standings unavailable" when either team lacks a row.
- **Open question to verify before building**: whether `refresh-standings` ingests tables for competitions other than
  the league's base competition and whether provider-plan (football-data.org free tier) covers Eredivisie. Rate limits
  and cache cost grow per competition. Also relevant: Pick8 consumes only the `PL` mapping, so keep PL behaviour and the
  shared-football response unchanged.

### WYG-4 Higher-ranked team first in the comparison table
- **Current**: `TeamFormComparison` (`FixturePredictionCard.tsx` ~L250–300) renders `[home, away]` in fixed order.
  Change: sort the two rows by `standing.position` (ascending; tie-break by points then home first) when both exist.
  Pure presentation; add a unit test for ordering incl. equal positions and missing standings; ensure it doesn't affect
  prediction input order or the shared-football API.

## Cross-cutting dependencies
- A staging environment for both apps (seeded data, no real email) is a prerequisite for safely verifying P8-2 and WYG-1.
- WYG changes must not alter `/api/shared-football/fixtures` (Pick8 consumer); any WYG deploy touching `utils/team-assets.ts`,
  `external_fixtures` handling or that route needs a cross-repo contract check (fixture-based contract test on both sides).
