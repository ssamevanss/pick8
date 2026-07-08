const LEAGUE_COMPETITION_CODES = new Set(["PL", "PD", "SA", "BL1", "FL1"]);

const STAGE_LABELS: Record<string, string> = {
  GROUP_STAGE: "Group",
  GROUP: "Group",
  LAST_16: "Last 16",
  QUARTER_FINALS: "QF",
  QUARTER_FINAL: "QF",
  SEMI_FINALS: "SF",
  SEMI_FINAL: "SF",
  THIRD_PLACE: "3rd place",
  FINAL: "Final",
  REGULAR_SEASON: "",
};

function normalizeStage(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/\s+/g, "_") ?? "";
}

export function isLeagueCompetitionCode(code: string | null | undefined) {
  return code ? LEAGUE_COMPETITION_CODES.has(code.toUpperCase()) : false;
}

export function formatTournamentStageLabel(
  value: string | null | undefined,
) {
  const normalized = normalizeStage(value);

  if (!normalized) {
    return null;
  }

  if (STAGE_LABELS[normalized] !== undefined) {
    return STAGE_LABELS[normalized] || null;
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

export function getFixtureContextLabel({
  competitionCode,
  externalRound,
  externalStage,
  externalMatchday,
}: {
  competitionCode?: string | null;
  externalRound?: string | null;
  externalStage?: string | null;
  externalMatchday?: number | null;
}) {
  if (isLeagueCompetitionCode(competitionCode)) {
    return externalMatchday ? `${externalMatchday}` : null;
  }

  return (
    formatTournamentStageLabel(externalStage) ??
    formatTournamentStageLabel(externalRound)
  );
}
