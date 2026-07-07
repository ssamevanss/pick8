export type FootballCompetitionOption = {
  provider: "football_data";
  external_competition_code: string;
  name: string;
  external_competition_id: string;
};

export type SeasonCompetitionMode = "league" | "tournament";

const leagueCompetitionCodes = new Set(["PL", "PD", "SA", "BL1", "FL1"]);
const tournamentCompetitionCodes = new Set(["WC", "EC", "EURO"]);

export const footballDataCompetitionOptions: FootballCompetitionOption[] = [
  {
    provider: "football_data",
    external_competition_code: "PL",
    name: "Premier League",
    external_competition_id: "2021",
  },
  {
    provider: "football_data",
    external_competition_code: "WC",
    name: "FIFA World Cup",
    external_competition_id: "2000",
  },
  {
    provider: "football_data",
    external_competition_code: "PD",
    name: "La Liga",
    external_competition_id: "2014",
  },
  {
    provider: "football_data",
    external_competition_code: "SA",
    name: "Serie A",
    external_competition_id: "2019",
  },
  {
    provider: "football_data",
    external_competition_code: "BL1",
    name: "Bundesliga",
    external_competition_id: "2002",
  },
  {
    provider: "football_data",
    external_competition_code: "FL1",
    name: "Ligue 1",
    external_competition_id: "2015",
  },
];

export function getFootballDataCompetitionOption(code: string) {
  return footballDataCompetitionOptions.find(
    (option) => option.external_competition_code === code,
  );
}

export function getSeasonCompetitionMode(
  competitionCode: string | null | undefined,
): SeasonCompetitionMode {
  if (!competitionCode) {
    return "tournament";
  }

  if (leagueCompetitionCodes.has(competitionCode)) {
    return "league";
  }

  if (tournamentCompetitionCodes.has(competitionCode)) {
    return "tournament";
  }

  return "tournament";
}

export function canBrowseOtherCompetitions(
  competitionCode: string | null | undefined,
) {
  return getSeasonCompetitionMode(competitionCode) === "league";
}
