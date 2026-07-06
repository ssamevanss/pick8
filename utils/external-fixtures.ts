export type ExternalFixtureRow = {
  provider: string;
  external_fixture_id: string;
  external_competition_code: string;
  external_round: string | null;
  external_matchday: number | null;
  external_stage: string | null;
  external_group?: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  raw_payload?: Record<string, unknown> | null;
  last_synced_at: string | null;
};

export function mapExternalStatusToFixtureStatus(status: string) {
  if (status === "TIMED" || status === "SCHEDULED") {
    return "scheduled";
  }

  return null;
}

export function getExternalFixtureGroupKey(fixture: {
  external_matchday: number | null;
  external_stage?: string | null;
  kickoff_at: string;
}) {
  if (fixture.external_matchday !== null) {
    return `matchday:${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return `stage:${fixture.external_stage}`;
  }

  return `date:${fixture.kickoff_at.slice(0, 10)}`;
}

export function getExpectedExternalPickCount(groupSize: number) {
  return Math.min(4, groupSize);
}

export function buildLocalFixtureFromExternal({
  fixture,
  gameweekId,
  competitionName,
}: {
  fixture: ExternalFixtureRow;
  gameweekId: string;
  competitionName: string | null;
}) {
  return {
    gameweek_id: gameweekId,
    home_team: fixture.home_team,
    away_team: fixture.away_team,
    kickoff_at: fixture.kickoff_at,
    competition: competitionName ?? fixture.external_competition_code,
    status: mapExternalStatusToFixtureStatus(fixture.status),
    external_provider: fixture.provider,
    external_fixture_id: fixture.external_fixture_id,
    external_competition_code: fixture.external_competition_code,
    external_round: fixture.external_round,
    external_matchday: fixture.external_matchday,
    external_status: fixture.status,
    external_last_synced_at: fixture.last_synced_at,
    external_raw_payload: fixture.raw_payload ?? null,
  };
}
