---
paths:
  - "utils/who-you-got-fixture-sync.ts"
  - "utils/pick8-fixture-identity.ts"
  - "utils/pick8-fixture-sync-mode.ts"
  - "utils/pick8-matchday-generation.ts"
  - "utils/pick8-sync-state.ts"
  - "tests/pick8-sync-*.ts"
  - "tests/pick8-wyg-contract.test.ts"
  - "tests/helpers/pick8-sync-harness.ts"
  - "tests/fixtures/shared-football-fixtures-contract.json"
---
# Who You Got (WYG) football-data contract

Pick8 consumes WYG's `GET {WHO_YOU_GOT_API_URL}/api/shared-football/fixtures?season=<startYear>&matchday=<1-38>`
with `Authorization: Bearer $WHO_YOU_GOT_API_KEY` (WYG's side: `PICK8_SHARED_API_KEY`, SHA-256 +
`timingSafeEqual`). Producer: `../Football_Predictor/football-predictor/app/api/shared-football/fixtures/route.ts`.

Contract Pick8 relies on (change either side only after checking both):
- Body `{ season, providerSeason, matchday, fixtures[] }`; `matchday` must equal the request;
  fixtures non-empty with unique `externalFixtureId`.
- Fixture: `externalFixtureId, homeTeamId|null, awayTeamId|null, homeTeamName, awayTeamName,
  homeTeamCrestUrl|null (https only), awayTeamCrestUrl, kickoffAt (ISO), status, homeScore|null,
  awayScore|null, updatedAt`.
- `status` ∈ `scheduled|timed|in_play|paused|finished|postponed|cancelled`. WYG maps `AWARDED→finished`,
  `SUSPENDED/ABANDONED→cancelled`, and returns 500 for an unknown provider status.
- HTTP: 401/403 = credentials, 404 = no season mapping, 5xx/timeout (10 s) = upstream. Pick8 sends
  `If-None-Match` but WYG currently emits no `ETag`; Pick8 therefore fingerprints content itself.
  WYG caches `private, max-age=30`.

Rules:
- Pick8 validates strictly and **fails closed**: a malformed, empty or wrong-matchday response is an
  error that leaves existing fixtures and scores untouched. Never "repair" bad provider data locally.
- Never treat an empty or partial list as "fixtures removed" without the existing removal safeguards
  (`potentialRemovals`, manual-matchday isolation).
- Nothing here may call football-data.org directly for the live game.
- The cross-repo contract is `tests/fixtures/shared-football-fixtures-contract.json`, byte-identical to WYG's copy.
  `tests/pick8-wyg-contract.test.ts` feeds every response in it through the real sync (statuses, nullable
  fields, identity, corrections, reschedules, must-reject and must-tolerate mutations, HTTP errors). WYG proves its
  route emits exactly those responses, and WYG CI runs this test against its copy and fails if the copies differ.
- WYG CI depends on this repo directly: its `pick8-contract` job checks out Pick8 `main` without a token (this repo is
  public), runs `npm ci --ignore-scripts`, then `node --experimental-strip-types --test tests/pick8-wyg-contract.test.ts`
  with `WYG_SHARED_FIXTURES_CONTRACT` pointing at WYG's copy. Renaming or moving that test, its helper
  (`tests/helpers/pick8-sync-harness.ts`), the env var or the vendored JSON, or making the repo private, turns WYG CI red
  on every PR. Change WYG's job in the same window; going private also needs a read-only token there.
- Changing the contract: edit the JSON and this consumer here first and merge; only then may WYG change. Never edit
  the JSON just to make a failing test pass; a failure means one side no longer matches the other.
