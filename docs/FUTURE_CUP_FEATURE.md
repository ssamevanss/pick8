# Future Cup Feature

Status: future design note only. Do not implement before Premier League basics
are stable.

## Goal

Add a mid-season cup competition alongside the normal league without disrupting
the main prediction flow or leaderboard.

## Timing

- Introduce the cup around the middle of a Premier League season, for example
  after Gameweek 20.
- Normal league gameweeks continue as usual.
- Cup ties are layered on top of selected league fixtures rather than replacing
  the league.

## Seeding And Bracket

- Seed users by league position at the cup start cutoff.
- Bracket size depends on active player count.
- With about 20 users, top seeds may receive byes while lower seeds play a
  preliminary round.
- Past league position and completed cup results should be preserved as history.

## Cup Tie Format

- Each tie is one player versus one player.
- The normal selected league fixtures still count toward the league standings.
- Each player can add one extra cup-only fixture for their head-to-head tie.
- Extra cup fixtures count only for that cup tie, not the league table.
- Cup fixture selection must respect fixture eligibility, kickoff locks, and
  prediction visibility rules.

## Fixture Eligibility

- Cup-only fixtures can come from cached eligible competitions, but must not
  cross into the next base-league prediction cycle.
- The same provider cache should be reused; do not call football-data.org from
  player-facing pages.
- Manual/admin overrides may be needed for exceptional cup fixtures, with clear
  warnings when a fixture is outside the usual gameweek window.

## UX Direction

- Cup state should be visible without cluttering the main Predictions page.
- Show a compact cup badge or tie summary when a user is active in a cup round.
- Provide a bracket/history view separate from the main leaderboard.
- Keep league predictions as the primary weekly action.

## Open Design Questions

- How are drawn cup ties settled: exact scores, joker success, league rank seed,
  replay, or another tiebreak?
- Can eliminated players still pick cup-only fixtures for fun, or only active
  cup participants?
- Should cup-only fixtures allow Jokers, or should Jokers remain league-only?
- How should emails/activity distinguish league fixtures from cup-only fixtures?

## Implementation Notes

- This likely needs cup-specific tables for brackets, rounds, ties, and
  cup-only fixture selections.
- Avoid overloading `gameweeks` with cup bracket state.
- Keep scoring helpers shared where possible, but store cup tie outcomes
  separately from official league leaderboard points.
