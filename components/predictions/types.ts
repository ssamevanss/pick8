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
  external_provider?: string | null;
  external_fixture_id?: string | null;
  external_status?: string | null;
  external_last_synced_at?: string | null;
};

export type ExternalFixtureScore = {
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  last_synced_at: string | null;
};

export type TeamFormResult = {
  fixtureId: string;
  opponent: string;
  kickoffAt: string;
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
  venue: "H" | "A";
};

export type FixtureTeamForm = {
  home: TeamFormResult[];
  away: TeamFormResult[];
};

export type Gameweek = {
  id: string;
  gameweek_number: number;
  name: string | null;
  is_double_gameweek?: boolean;
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
