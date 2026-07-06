"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getKickoffIso } from "@/utils/fixtures";
import { getActiveSeason } from "@/utils/seasons";
import { getEditablePickerGameweeks } from "@/utils/picker-eligibility";
import { upsertFixturesPickedActivity } from "@/utils/fixture-activity";
import {
  buildLocalFixtureFromExternal,
  getExpectedExternalPickCount,
  getExternalFixtureGroupKey,
  mapExternalStatusToFixtureStatus,
  type ExternalFixtureRow,
} from "@/utils/external-fixtures";

const slotNumbers = [1, 2, 3, 4];

type FixtureStatusRow = {
  id?: string;
  status: string;
};

type ActiveSeasonExternalConfig = {
  id: string;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
};

async function requireFixtureManagerForGameweek(gameweekId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: gameweek } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, fixture_picker_id")
    .eq("id", gameweekId)
    .single();

  const isAssignedPicker = gameweek?.fixture_picker_id === user.id;

  if (!gameweek || !isAssignedPicker) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent(
        "You are not assigned to manage this gameweek",
      )}`,
    );
  }

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  if (!activeSeason || gameweek.season_id !== activeSeason.id) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent(
        "This gameweek is not part of the active season",
      )}`,
    );
  }

  if (gameweek.gameweek_number !== 1) {
    const { data: previousGameweek } = await supabase
      .from("gameweeks")
      .select("id")
      .eq("season_id", gameweek.season_id)
      .eq("gameweek_number", gameweek.gameweek_number - 1)
      .maybeSingle();

    if (!previousGameweek) {
      redirect(
        `/pick-fixtures?error=${encodeURIComponent(
          "Previous gameweek has not been created",
        )}`,
      );
    }

    const { data: previousFixtures } = await supabase
      .from("fixtures")
      .select("status")
      .eq("gameweek_id", previousGameweek.id);

    const previousFixtureList =
      (previousFixtures as FixtureStatusRow[] | null) ?? [];

    const previousGameweekComplete =
      previousFixtureList.length > 0 &&
      previousFixtureList.every((fixture) =>
        ["completed", "postponed", "void"].includes(fixture.status),
      );

    if (!previousGameweekComplete) {
      redirect(
        `/pick-fixtures?error=${encodeURIComponent(
          "You can pick fixtures once the previous gameweek has been completed",
        )}`,
      );
    }
  }

  const editableGameweeks = await getEditablePickerGameweeks({
    supabase,
    userId: user.id,
    activeSeasonId: gameweek.season_id,
  });
  const isEditableGameweek = editableGameweeks.some(
    (editableGameweek) => editableGameweek.id === gameweekId,
  );

  if (!isEditableGameweek) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent(
        "This gameweek is no longer available for fixture picking",
      )}`,
    );
  }

  const { data: currentFixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("gameweek_id", gameweekId);

  const currentFixtureIds =
    (currentFixtures as { id: string }[] | null)?.map((fixture) => fixture.id) ??
    [];

  if (currentFixtureIds.length > 0) {
    const { data: existingPrediction } = await supabase
      .from("predictions")
      .select("fixture_id")
      .in("fixture_id", currentFixtureIds)
      .limit(1)
      .maybeSingle();

    if (existingPrediction) {
      redirect(
        `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
          "Fixtures are locked because predictions have already been entered",
        )}`,
      );
    }
  }

  return { supabase, gameweek, user };
}

export async function savePickerFixtures(formData: FormData) {
  const gameweekId = String(formData.get("gameweek_id") ?? "");

  if (!gameweekId) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent("Missing gameweek details")}`,
    );
  }

  const { supabase, user } = await requireFixtureManagerForGameweek(gameweekId);

  for (const slotNumber of slotNumbers) {
    const fixtureId = String(formData.get(`fixture_id_${slotNumber}`) ?? "");
    const homeTeam = String(
      formData.get(`home_team_${slotNumber}`) ?? "",
    ).trim();
    const awayTeam = String(
      formData.get(`away_team_${slotNumber}`) ?? "",
    ).trim();
    const kickoffRaw = String(
      formData.get(`kickoff_at_${slotNumber}`) ?? "",
    );
    const competition =
      String(formData.get(`competition_${slotNumber}`) ?? "").trim() ||
      "Premier League";

    const hasAnyValue = Boolean(homeTeam || awayTeam || kickoffRaw);

    if (!hasAnyValue && fixtureId) {
      const { error: deleteError } = await supabase
        .from("fixtures")
        .delete()
        .eq("id", fixtureId)
        .eq("gameweek_id", gameweekId);

      if (deleteError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            deleteError.message,
          )}`,
        );
      }

      continue;
    }

    if (!hasAnyValue) {
      continue;
    }

    if (!homeTeam || !awayTeam || !kickoffRaw) {
      redirect(
        `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
          `Complete home team, away team and kickoff for Fixture ${slotNumber}`,
        )}`,
      );
    }

    const kickoffAt = getKickoffIso(kickoffRaw);

    if (fixtureId) {
      const { error: updateError } = await supabase
        .from("fixtures")
        .update({
          home_team: homeTeam,
          away_team: awayTeam,
          kickoff_at: kickoffAt,
          competition,
        })
        .eq("id", fixtureId)
        .eq("gameweek_id", gameweekId);

      if (updateError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            updateError.message,
          )}`,
        );
      }
    } else {
      const { error: insertError } = await supabase.from("fixtures").insert({
        gameweek_id: gameweekId,
        home_team: homeTeam,
        away_team: awayTeam,
        kickoff_at: kickoffAt,
        competition,
        status: "scheduled",
      });

      if (insertError) {
        redirect(
          `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
            insertError.message,
          )}`,
        );
      }
    }
  }

  try {
    await upsertFixturesPickedActivity({
      supabase,
      gameweekId,
      actioningUserId: user.id,
    });
  } catch (error) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        error instanceof Error
          ? error.message
          : "Could not create activity update",
      )}`,
    );
  }

  revalidatePath("/pick-fixtures");
  revalidatePath("/dashboard");

  redirect(`/pick-fixtures?gameweek=${gameweekId}&saved=1`);
}

export async function saveExternalPickerFixtures(formData: FormData) {
  const gameweekId = String(formData.get("gameweek_id") ?? "");

  if (!gameweekId) {
    redirect(
      `/pick-fixtures?error=${encodeURIComponent("Missing gameweek details")}`,
    );
  }

  const selectedExternalIds = formData
    .getAll("external_fixture_id")
    .map((value) => String(value))
    .filter(Boolean);
  const uniqueExternalIds = [...new Set(selectedExternalIds)];

  if (uniqueExternalIds.length !== selectedExternalIds.length) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "Each fixture can only be selected once",
      )}`,
    );
  }

  if (uniqueExternalIds.length === 0 || uniqueExternalIds.length > 4) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "Select between one and four fixtures before saving",
      )}`,
    );
  }

  const { supabase, gameweek, user } =
    await requireFixtureManagerForGameweek(gameweekId);

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, base_provider, base_competition_code, base_competition_name",
  );
  const activeSeasonConfig = activeSeason as ActiveSeasonExternalConfig | null;

  if (
    !activeSeasonConfig ||
    activeSeasonConfig.base_provider !== "football_data" ||
    !activeSeasonConfig.base_competition_code
  ) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "The fixture list is not set up for the active season",
      )}`,
    );
  }

  const { data: currentFixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("gameweek_id", gameweekId)
    .order("kickoff_at", { ascending: true });

  const currentFixtureList = (currentFixtures as { id: string }[] | null) ?? [];

  if (currentFixtureList.length > 4) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "This gameweek has extra admin fixtures. Ask an admin to update it before using the fixture list.",
      )}`,
    );
  }

  const { data: externalFixtures, error: externalFixturesError } = await supabase
    .from("external_fixtures")
    .select(
      "provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, home_team, away_team, kickoff_at, status, raw_payload, last_synced_at",
    )
    .eq("provider", "football_data")
    .eq("external_competition_code", activeSeasonConfig.base_competition_code)
    .in("external_fixture_id", uniqueExternalIds);

  if (externalFixturesError) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        externalFixturesError.message,
      )}`,
    );
  }

  const externalFixtureList =
    (externalFixtures as ExternalFixtureRow[] | null) ?? [];

  if (externalFixtureList.length !== uniqueExternalIds.length) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "One or more selected fixtures could not be found",
      )}`,
    );
  }

  const invalidFixture = externalFixtureList.find(
    (fixture) => !mapExternalStatusToFixtureStatus(fixture.status),
  );

  if (invalidFixture) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        `${invalidFixture.home_team} vs ${invalidFixture.away_team} is not selectable`,
      )}`,
    );
  }

  const selectedGroupKeys = [
    ...new Set(externalFixtureList.map(getExternalFixtureGroupKey)),
  ];

  if (selectedGroupKeys.length !== 1) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "Selected fixtures must come from the same matchday or round group",
      )}`,
    );
  }

  const selectedGroupKey = selectedGroupKeys[0];

  const { data: seasonGameweeks } = await supabase
    .from("gameweeks")
    .select("id")
    .eq("season_id", gameweek.season_id);

  const seasonGameweekIds =
    (seasonGameweeks as { id: string }[] | null)?.map((row) => row.id) ?? [];

  const { data: duplicateFixtures } =
    seasonGameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("external_fixture_id, gameweek_id")
          .in("gameweek_id", seasonGameweekIds)
          .eq("external_provider", "football_data")
          .in("external_fixture_id", uniqueExternalIds)
      : { data: [] };

  const duplicateInAnotherGameweek = (
    (duplicateFixtures as
      | { external_fixture_id: string | null; gameweek_id: string }[]
      | null) ?? []
  ).find((fixture) => fixture.gameweek_id !== gameweekId);

  if (duplicateInAnotherGameweek?.external_fixture_id) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        "One of those fixtures has already been selected for another gameweek",
      )}`,
    );
  }

  const nowIso = new Date().toISOString();
  const { data: selectableGroupCandidates, error: groupCandidateError } =
    await supabase
      .from("external_fixtures")
      .select(
        "provider, external_fixture_id, external_competition_code, external_matchday, external_stage, kickoff_at, status",
      )
      .eq("provider", "football_data")
      .eq("external_competition_code", activeSeasonConfig.base_competition_code)
      .in("status", ["TIMED", "SCHEDULED"])
      .gt("kickoff_at", nowIso);

  if (groupCandidateError) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        groupCandidateError.message,
      )}`,
    );
  }

  const duplicateExternalIdsInAnotherGameweek = new Set(
    ((duplicateFixtures as
      | { external_fixture_id: string | null; gameweek_id: string }[]
      | null) ?? [])
      .filter((fixture) => fixture.gameweek_id !== gameweekId)
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value)),
  );
  const selectableGroupFixtureCount = (
    (selectableGroupCandidates as
      | Pick<
          ExternalFixtureRow,
          | "provider"
          | "external_fixture_id"
          | "external_competition_code"
          | "external_matchday"
          | "external_stage"
          | "kickoff_at"
          | "status"
        >[]
      | null) ?? []
  ).filter(
    (fixture) =>
      getExternalFixtureGroupKey(fixture) === selectedGroupKey &&
      !duplicateExternalIdsInAnotherGameweek.has(fixture.external_fixture_id),
  ).length;
  const expectedPickCount = getExpectedExternalPickCount(
    selectableGroupFixtureCount,
  );

  if (uniqueExternalIds.length !== expectedPickCount) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        `Select exactly ${expectedPickCount} fixture${
          expectedPickCount === 1 ? "" : "s"
        } from this matchday before saving`,
      )}`,
    );
  }

  if (currentFixtureList.length > 0) {
    const { error: deleteError } = await supabase
      .from("fixtures")
      .delete()
      .eq("gameweek_id", gameweekId)
      .in(
        "id",
        currentFixtureList.map((fixture) => fixture.id),
      );

    if (deleteError) {
      redirect(
        `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
          deleteError.message,
        )}`,
      );
    }
  }

  const externalFixtureById = new Map(
    externalFixtureList.map((fixture) => [fixture.external_fixture_id, fixture]),
  );
  const rows = uniqueExternalIds.map((externalFixtureId) =>
    buildLocalFixtureFromExternal({
      fixture: externalFixtureById.get(externalFixtureId)!,
      gameweekId,
      competitionName: activeSeasonConfig.base_competition_name,
    }),
  );

  const { error: insertError } = await supabase.from("fixtures").insert(rows);

  if (insertError) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        insertError.message,
      )}`,
    );
  }

  try {
    await upsertFixturesPickedActivity({
      supabase,
      gameweekId,
      actioningUserId: user.id,
    });
  } catch (error) {
    redirect(
      `/pick-fixtures?gameweek=${gameweekId}&error=${encodeURIComponent(
        error instanceof Error
          ? error.message
          : "Could not create activity update",
      )}`,
    );
  }

  revalidatePath("/pick-fixtures");
  revalidatePath("/dashboard");

  redirect(`/pick-fixtures?gameweek=${gameweekId}&saved=1`);
}
