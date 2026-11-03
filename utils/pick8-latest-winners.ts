// Podium of the latest settled matchday for the dashboard. Pure so it is unit-tested directly: ranking
// reuses `buildStandings` (standard tied ranking), and the picks come from `buildMatchdayBreakdown`, which
// already applies per-fixture kickoff visibility, so nothing here can reveal a hidden pick.
import { buildStandings, playerDisplayName, rerankStandings, type StandingsEntry, type StandingsMatchday, type StandingsProfile } from "./pick8-standings.ts";
import { formatPick8FixtureSelection, pick8CategoryDisplayOrder } from "./pick8-selection-display.ts";
import type { BreakdownFixture, BreakdownPlayer } from "./pick8-breakdown-types.ts";

export const MAX_WINNER_ROWS = 6;

export type SettlementMatchday = StandingsMatchday & {
  scoring_revision: number | null;
  scored_revision: number | null;
  scoring_pending: boolean | null;
  is_accelerated_test: boolean | null;
};

// A matchday is settled when it is `completed`, no (re)scoring is queued or behind the latest provider
// revision, and every submitted entry carries a final score. Anything short of that (for example a provider
// correction mid-recalculation) is skipped in favour of the previous settled matchday, never shown partially.
export function isMatchdaySettled(matchday: SettlementMatchday, entries: StandingsEntry[]) {
  if (matchday.status !== "completed" || matchday.is_accelerated_test) return false;
  if (matchday.scoring_pending) return false;
  if (matchday.scored_revision !== null && matchday.scoring_revision !== null && matchday.scored_revision < matchday.scoring_revision) return false;
  const submitted = entries.filter((entry) => entry.matchday_id === matchday.id && entry.submitted_at !== null);
  return submitted.length > 0 && submitted.every((entry) => entry.calculated_score !== null);
}

export function resolveLatestSettledMatchday(matchdays: SettlementMatchday[], entries: StandingsEntry[]) {
  return [...matchdays]
    .sort((a, b) => b.matchday_number - a.matchday_number)
    .find((matchday) => isMatchdaySettled(matchday, entries)) ?? null;
}

// Everyone ranked 1-3 (ties share a rank, so 1,1,3 and 1,2,2,2 can exceed three rows), bounded for display.
export function selectPodiumRows(
  profiles: StandingsProfile[],
  entries: StandingsEntry[],
  matchday: StandingsMatchday,
  limit = MAX_WINNER_ROWS,
) {
  // Drop players without a scored entry before ranking: otherwise their 0 points outrank negative scores.
  const scored = buildStandings(profiles, entries, new Map([[matchday.id, matchday]]), {
    start: matchday.matchday_number,
    end: matchday.matchday_number,
  }).filter((row) => row.played > 0);
  const ranked = rerankStandings(scored).filter((row) => row.rank <= 3);
  return { rows: ranked.slice(0, limit), hiddenTied: Math.max(0, ranked.length - limit) };
}

export type WinnerPickState = "correct" | "incorrect" | "void" | "pending";
export type WinnerPick = {
  id: string;
  label: string;
  fixture: string;
  result: string | null;
  points: number | null;
  state: WinnerPickState;
};
export type MatchdayWinner = {
  playerId: string;
  rank: number;
  name: string;
  points: number;
  totalGoalsPrediction: number | null;
  totalGoalsPoints: number | null;
  picks: WinnerPick[];
  expectedPickCount: number;
  // False when fewer picks than the matchday's rules require are available to this viewer. Total Goals
  // points are then withheld, because they are derived as score minus the visible picks' points.
  complete: boolean;
};
export type LatestMatchdayWinners = {
  matchdayNumber: number;
  actualGoals: number | null;
  winners: MatchdayWinner[];
  hiddenTied: number;
};

const VOID_STATUSES = new Set(["postponed", "cancelled"]);

export function buildLatestMatchdayWinners({
  matchday,
  rows,
  hiddenTied,
  players,
  fixtures,
  actualGoals,
  expectedPickCount,
}: {
  matchday: StandingsMatchday;
  rows: ReturnType<typeof buildStandings>;
  hiddenTied: number;
  players: BreakdownPlayer[];
  fixtures: BreakdownFixture[];
  actualGoals: number | null;
  expectedPickCount: number;
}): LatestMatchdayWinners {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const winners = rows.map((row): MatchdayWinner => {
    const detail = players.find(({ player }) => player.id === row.profile.id);
    const picks = (detail?.selections ?? [])
      .flatMap((selection) => {
        const fixture = fixtureById.get(selection.fixture_id);
        if (!fixture) return [];
        const voided = VOID_STATUSES.has(fixture.status);
        const state: WinnerPickState = voided ? "void" : selection.is_correct === null ? "pending" : selection.is_correct ? "correct" : "incorrect";
        const finished = fixture.status === "finished" && fixture.home_score !== null && fixture.away_score !== null;
        return [{
          order: pick8CategoryDisplayOrder(selection.category),
          pick: {
            id: selection.id,
            label: formatPick8FixtureSelection(selection.category, selection.selected_team_side, {
              homeTeamName: fixture.home_team_name,
              awayTeamName: fixture.away_team_name,
            }),
            fixture: `${fixture.home_team_name} v ${fixture.away_team_name}`,
            result: voided ? "Void" : finished ? `${fixture.home_score}–${fixture.away_score}` : null,
            points: voided ? 0 : selection.points_awarded,
            state,
          } satisfies WinnerPick,
        }];
      })
      .sort((a, b) => a.order - b.order)
      .map(({ pick }) => pick);
    const complete = picks.length === expectedPickCount;
    return {
      playerId: row.profile.id,
      rank: row.rank,
      name: playerDisplayName(row.profile),
      points: row.points,
      totalGoalsPrediction: detail?.entry?.total_goals_prediction ?? null,
      totalGoalsPoints: complete ? detail?.totalGoalsPoints ?? null : null,
      picks,
      expectedPickCount,
      complete,
    };
  });
  return { matchdayNumber: matchday.matchday_number, actualGoals, winners, hiddenTied };
}
