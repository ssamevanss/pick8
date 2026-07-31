import { createClient } from "@/utils/supabase/server";
import { getFixtureSelectionStatus } from "@/utils/fixture-selection";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type PickerEligibleGameweek = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
};

type FixtureStatusRow = {
  id: string;
  gameweek_id: string;
  status: string;
  external_provider: string | null;
  external_fixture_id: string | null;
};

export type PickerGameweekStatus = PickerEligibleGameweek & {
  isUnlocked: boolean;
  fixtureCount: number;
  expectedFixtureCount: number;
  hasPredictions: boolean;
  isClosed: boolean;
  isSelectionComplete: boolean;
};

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

export async function getPickerGameweekStatuses({
  supabase,
  userId,
  activeSeasonId,
}: {
  supabase: SupabaseServerClient;
  userId: string;
  activeSeasonId: string;
}) {
  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("season_id", activeSeasonId)
    .eq("fixture_picker_id", userId)
    .order("gameweek_number", { ascending: true });

  const assignedGameweeks =
    (gameweeks as PickerEligibleGameweek[] | null) ?? [];
  if (assignedGameweeks.length === 0) {
    return [];
  }

  const { data: seasonGameweeks } = await supabase
    .from("gameweeks")
    .select("id, gameweek_number")
    .eq("season_id", activeSeasonId);
  const gameweekIdByNumber = new Map(
    (seasonGameweeks ?? []).map((gameweek) => [
      gameweek.gameweek_number,
      gameweek.id,
    ]),
  );
  const relevantGameweekIds = new Set(
    assignedGameweeks.flatMap((gameweek) => {
      const previousId = gameweekIdByNumber.get(gameweek.gameweek_number - 1);
      return previousId ? [gameweek.id, previousId] : [gameweek.id];
    }),
  );
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      "id, gameweek_id, status, external_provider, external_fixture_id",
    )
    .in("gameweek_id", [...relevantGameweekIds]);
  const fixtureRows = (fixtures as FixtureStatusRow[] | null) ?? [];
  const fixturesByGameweek = new Map<string, FixtureStatusRow[]>();

  for (const fixture of fixtureRows) {
    const existing = fixturesByGameweek.get(fixture.gameweek_id) ?? [];
    existing.push(fixture);
    fixturesByGameweek.set(fixture.gameweek_id, existing);
  }

  const assignedFixtureIds = assignedGameweeks.flatMap((gameweek) =>
    (fixturesByGameweek.get(gameweek.id) ?? []).map((fixture) => fixture.id),
  );
  const { data: predictions } = assignedFixtureIds.length
    ? await supabase
        .from("predictions")
        .select("fixture_id")
        .in("fixture_id", assignedFixtureIds)
    : { data: [] };
  const predictedFixtureIds = new Set(
    (predictions ?? []).map((prediction) => prediction.fixture_id),
  );

  return assignedGameweeks.map((gameweek): PickerGameweekStatus => {
    const previousId = gameweekIdByNumber.get(gameweek.gameweek_number - 1);
    const previousFixtures = previousId
      ? fixturesByGameweek.get(previousId) ?? []
      : [];
    const previousComplete =
      gameweek.gameweek_number === 1 ||
      (previousFixtures.length > 0 &&
        previousFixtures.every((fixture) =>
          isTerminalFixtureStatus(fixture.status),
        ));
    const currentFixtures = fixturesByGameweek.get(gameweek.id) ?? [];
    const allFixturesTerminal =
      currentFixtures.length > 0 &&
      currentFixtures.every((fixture) =>
        isTerminalFixtureStatus(fixture.status),
      );
    const hasPredictions = currentFixtures.some((fixture) =>
      predictedFixtureIds.has(fixture.id),
    );
    const selectionStatus = getFixtureSelectionStatus(currentFixtures);

    return {
      ...gameweek,
      isUnlocked: previousComplete,
      fixtureCount: currentFixtures.length,
      expectedFixtureCount: selectionStatus.expectedCount,
      hasPredictions,
      isClosed: allFixturesTerminal,
      isSelectionComplete: selectionStatus.isComplete,
    };
  });
}

export async function getEditablePickerGameweeks(
  options: Parameters<typeof getPickerGameweekStatuses>[0],
) {
  const statuses = await getPickerGameweekStatuses(options);

  return statuses.filter(
    (gameweek) =>
      gameweek.isUnlocked && !gameweek.isClosed && !gameweek.hasPredictions,
  );
}
