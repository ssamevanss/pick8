import { createClient } from "@/utils/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type PickerEligibleGameweek = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
};

type FixtureStatusRow = {
  id?: string;
  status: string;
};

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

async function isPreviousGameweekComplete({
  supabase,
  seasonId,
  gameweekNumber,
}: {
  supabase: SupabaseServerClient;
  seasonId: string;
  gameweekNumber: number;
}) {
  if (gameweekNumber === 1) {
    return true;
  }

  const { data: previousGameweek } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", seasonId)
    .eq("gameweek_number", gameweekNumber - 1)
    .maybeSingle();

  if (!previousGameweek) {
    return false;
  }

  const { data: previousFixtures } = await supabase
    .from("fixtures")
    .select("status")
    .eq("gameweek_id", previousGameweek.id);

  const previousFixtureList =
    (previousFixtures as FixtureStatusRow[] | null) ?? [];

  return (
    previousFixtureList.length > 0 &&
    previousFixtureList.every((fixture) =>
      isTerminalFixtureStatus(fixture.status),
    )
  );
}

export async function getEditablePickerGameweeks({
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
  const editableGameweeks: PickerEligibleGameweek[] = [];

  for (const gameweek of assignedGameweeks) {
    const previousGameweekComplete = await isPreviousGameweekComplete({
      supabase,
      seasonId: gameweek.season_id,
      gameweekNumber: gameweek.gameweek_number,
    });

    if (!previousGameweekComplete) {
      continue;
    }

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, status")
      .eq("gameweek_id", gameweek.id);

    const fixtureList = (fixtures as FixtureStatusRow[] | null) ?? [];
    const allFixturesTerminal =
      fixtureList.length > 0 &&
      fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status));

    if (allFixturesTerminal) {
      continue;
    }

    const fixtureIds = fixtureList
      .map((fixture) => fixture.id)
      .filter((value): value is string => Boolean(value));
    const { data: existingPrediction } =
      fixtureIds.length > 0
        ? await supabase
            .from("predictions")
            .select("fixture_id")
            .in("fixture_id", fixtureIds)
            .limit(1)
            .maybeSingle()
        : { data: null };

    if (!existingPrediction) {
      editableGameweeks.push(gameweek);
    }
  }

  return editableGameweeks;
}
