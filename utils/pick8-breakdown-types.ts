export type BreakdownProfile = { id: string; display_name: string };
export type BreakdownMatchday = {
  id: string;
  matchday_number: number;
  status: string;
  locks_at: string | null;
};
export type BreakdownFixture = {
  id: string;
  home_team_name: string;
  away_team_name: string;
  home_team_crest_url: string | null;
  away_team_crest_url: string | null;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};
export type BreakdownEntry = {
  id: string;
  user_id: string;
  matchday_id: string;
  total_goals_prediction: number | null;
  submitted_at: string | null;
  calculated_score: number | null;
  score_calculated_at: string | null;
};
export type BreakdownSelection = {
  id: string;
  entry_id: string;
  category: string;
  fixture_id: string;
  selected_team_side: string | null;
  points_awarded: number | null;
  is_correct: boolean | null;
};
export type BreakdownPlayer = {
  player: BreakdownProfile;
  entry: BreakdownEntry | null;
  selections: BreakdownSelection[];
  totalGoalsPoints: number | null;
};

export function findSubmittedPick8Player(
  players: BreakdownPlayer[],
  playerId: string,
) {
  const result = players.find(({ player }) => player.id === playerId);
  return result?.entry?.submitted_at ? result : null;
}

export const PICK_CATEGORY_LABELS: Record<string, string> = {
  home_win: "Home Winner",
  away_win: "Away Winner",
  draw: "Draw",
  team_win: "Team to Win",
  team_lose: "Team to Lose",
  team_score: "Team to Score",
  clean_sheet: "Clean Sheet",
};
