export const MATCHDAY_2_TEST_ID = "5e9c84a0-76f3-4177-83ad-5c9061691a65";
export const MATCHDAY_2_TEST_ENTRY_ID = "43142dc9-d1ce-4190-8dc9-1a69720d0c52";
export const MATCHDAY_3_TEST_NUMBER = 3;
export const MATCHDAY_3_TEST_FIXTURE_IDS = Array.from(
  { length: 10 },
  (_, index) => `990003${String(index + 1).padStart(3, "0")}`,
);

export const MATCHDAY_3_FINAL_SCORE_PLAN = [
  { externalFixtureId: "990003001", homeScore: 2, awayScore: 1 },
  { externalFixtureId: "990003002", homeScore: 1, awayScore: 1 },
  { externalFixtureId: "990003003", homeScore: 3, awayScore: 2 },
  { externalFixtureId: "990003004", homeScore: 0, awayScore: 1 },
  { externalFixtureId: "990003005", homeScore: 2, awayScore: 0 },
  { externalFixtureId: "990003006", homeScore: 1, awayScore: 3 },
  { externalFixtureId: "990003007", homeScore: 0, awayScore: 0 },
  { externalFixtureId: "990003008", homeScore: 4, awayScore: 2 },
  { externalFixtureId: "990003009", homeScore: 1, awayScore: 0 },
  { externalFixtureId: "990003010", homeScore: 2, awayScore: 2 },
] as const;

export const MATCHDAY_2_FINAL_SCORE_PLAN = [
  { externalFixtureId: "990002001", homeScore: 2, awayScore: 1 },
  { externalFixtureId: "990002002", homeScore: 1, awayScore: 1 },
  { externalFixtureId: "990002003", homeScore: 3, awayScore: 0 },
  { externalFixtureId: "990002004", homeScore: 0, awayScore: 2 },
  { externalFixtureId: "990002005", homeScore: 2, awayScore: 2 },
  { externalFixtureId: "990002006", homeScore: 1, awayScore: 0 },
  { externalFixtureId: "990002007", homeScore: 4, awayScore: 1 },
  { externalFixtureId: "990002008", homeScore: 0, awayScore: 0 },
  { externalFixtureId: "990002009", homeScore: 2, awayScore: 1 },
  { externalFixtureId: "990002010", homeScore: 1, awayScore: 1 },
] as const;

export function manualTestFinalGoalTotal() {
  return MATCHDAY_2_FINAL_SCORE_PLAN.reduce(
    (total, fixture) => total + fixture.homeScore + fixture.awayScore,
    0,
  );
}
