export type Fixture = {
  id: string;
  gameweek_id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  competition: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

export type Gameweek = {
  id: string;
  gameweek_number: number;
  name: string | null;
};

export type Prediction = {
  fixture_id: string;
  user_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  is_exact_score: boolean;
  is_correct_result: boolean;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

export type JokerUsage = {
  fixture_id: string;
  user_id: string;
};

export type LeaderboardSummary = {
  rank: number | null;
  total_points: number;
  weekly_points: number;
} | null;