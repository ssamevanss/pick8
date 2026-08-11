export const MATCHDAY_2_TEST_ID = "5e9c84a0-76f3-4177-83ad-5c9061691a65";
export const MATCHDAY_2_TEST_ENTRY_ID = "43142dc9-d1ce-4190-8dc9-1a69720d0c52";
export const MATCHDAY_3_TEST_NUMBER = 3;
export const MATCHDAY_4_TEST_NUMBER = 4;

export function acceleratedTestFixtureIds(matchdayNumber: number) {
  return Array.from(
    { length: 10 },
    (_, index) => `990${String(matchdayNumber).padStart(3, "0")}${String(index + 1).padStart(3, "0")}`,
  );
}

export function isExactAcceleratedTestFixtureSet(matchdayNumber: number, fixtureIds: string[]) {
  const expected = acceleratedTestFixtureIds(matchdayNumber).sort();
  const actual = [...fixtureIds].sort();
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

export function canUseAcceleratedTestCompletion({
  isAuthorizedAdmin,
  confirmed,
  fixtureSyncMode,
  isAcceleratedTest,
  matchdayNumber,
  fixtureIds,
}: {
  isAuthorizedAdmin: boolean;
  confirmed: boolean;
  fixtureSyncMode: string;
  isAcceleratedTest: boolean;
  matchdayNumber: number;
  fixtureIds: string[];
}) {
  return isAuthorizedAdmin &&
    confirmed &&
    fixtureSyncMode === "manual" &&
    isAcceleratedTest &&
    isExactAcceleratedTestFixtureSet(matchdayNumber, fixtureIds);
}

export const MATCHDAY_3_TEST_FIXTURE_IDS = acceleratedTestFixtureIds(MATCHDAY_3_TEST_NUMBER);
export const MATCHDAY_4_TEST_FIXTURE_IDS = acceleratedTestFixtureIds(MATCHDAY_4_TEST_NUMBER);

const ACCELERATED_TEST_SCORES = [
  [2, 1], [1, 1], [3, 2], [0, 1], [2, 0],
  [1, 3], [0, 0], [4, 2], [1, 0], [2, 2],
] as const;

export function acceleratedTestFinalScorePlan(matchdayNumber: number) {
  return acceleratedTestFixtureIds(matchdayNumber).map((externalFixtureId, index) => ({
    externalFixtureId,
    homeScore: ACCELERATED_TEST_SCORES[index][0],
    awayScore: ACCELERATED_TEST_SCORES[index][1],
  }));
}

export const MATCHDAY_3_FINAL_SCORE_PLAN = acceleratedTestFinalScorePlan(MATCHDAY_3_TEST_NUMBER);
export const MATCHDAY_4_FINAL_SCORE_PLAN = acceleratedTestFinalScorePlan(MATCHDAY_4_TEST_NUMBER);

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
