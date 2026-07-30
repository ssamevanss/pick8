import { formatOrdinal } from "./ordinals";

export type TeamStandingDisplayRow = {
  external_competition_code: string;
  provider_season?: string | null;
  team_name: string;
  team_short_name: string | null;
  team_tla: string | null;
  crest_url?: string | null;
  position: number;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  points: number | null;
};

export type TeamStandingSummary = {
  positionLabel: string;
  teamName: string;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  points: number | null;
  crestUrl?: string | null;
};

function normalizeTeamName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(fc|afc|cf|club)\b/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMeaningfulStats(row: TeamStandingDisplayRow) {
  return [row.played, row.won, row.drawn, row.lost, row.points].some(
    (value) => (value ?? 0) > 0,
  );
}

export function getMeaningfulStandingRows(rows: TeamStandingDisplayRow[]) {
  const byCompetitionSeason = new Map<string, TeamStandingDisplayRow[]>();

  for (const row of rows) {
    const key = `${row.external_competition_code}:${row.provider_season ?? ""}`;
    byCompetitionSeason.set(key, [...(byCompetitionSeason.get(key) ?? []), row]);
  }

  const meaningfulRows: TeamStandingDisplayRow[] = [];
  const hiddenPreseasonGroups = new Set<string>();

  for (const [key, groupRows] of byCompetitionSeason) {
    if (groupRows.some(hasMeaningfulStats)) {
      meaningfulRows.push(...groupRows);
    } else {
      hiddenPreseasonGroups.add(key);
    }
  }

  return { meaningfulRows, hiddenPreseasonGroups };
}

export function buildTeamStandingLookup(rows: TeamStandingDisplayRow[]) {
  const lookup = new Map<string, TeamStandingSummary>();

  for (const row of rows) {
    const positionLabel = formatOrdinal(row.position);

    if (!positionLabel) {
      continue;
    }

    const summary: TeamStandingSummary = {
      positionLabel,
      teamName: row.team_name,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      points: row.points,
      crestUrl: row.crest_url ?? null,
    };

    for (const name of [row.team_name, row.team_short_name, row.team_tla]) {
      if (!name) {
        continue;
      }

      lookup.set(`${row.external_competition_code}:${name}`, summary);
      lookup.set(
        `${row.external_competition_code}:${normalizeTeamName(name)}`,
        summary,
      );
    }
  }

  return lookup;
}

export function getStandingForTeam({
  lookup,
  competitionCode,
  teamName,
}: {
  lookup: Map<string, TeamStandingSummary>;
  competitionCode?: string | null;
  teamName: string;
}) {
  if (!competitionCode) {
    return null;
  }

  return (
    lookup.get(`${competitionCode}:${teamName}`) ??
    lookup.get(`${competitionCode}:${normalizeTeamName(teamName)}`) ??
    null
  );
}
