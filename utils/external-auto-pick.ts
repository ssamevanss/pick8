import { addHours, formatDistanceToNowStrict } from "date-fns";
import {
  buildLocalFixtureFromExternal,
  getExpectedExternalPickCount,
  getExternalFixtureGroupKey,
  type ExternalFixtureRow,
} from "@/utils/external-fixtures";
import { createAdminClient } from "@/utils/supabase/admin";
import { upsertFixturesPickedActivity } from "@/utils/fixture-activity";

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

type AutoPickSeason = {
  id: string;
  league_id: string;
  name: string;
  status: string | null;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
};

type AutoPickGameweek = {
  id: string;
  season_id: string;
  gameweek_number: number;
  name: string | null;
  fixture_picker_id: string | null;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type ExistingFixtureRow = {
  id: string;
  gameweek_id: string;
  status: string;
  kickoff_at: string;
  external_provider: string | null;
  external_fixture_id: string | null;
  external_competition_code: string | null;
};

type ExternalFixtureCandidate = ExternalFixtureRow & {
  id?: string;
};

function getPickerName(gameweek: AutoPickGameweek) {
  const profile = Array.isArray(gameweek.profiles)
    ? gameweek.profiles[0]
    : gameweek.profiles;

  return profile?.display_name ?? "the assigned picker";
}

function deterministicShuffle<T>(items: T[], seed: string) {
  return [...items]
    .map((item, index) => {
      let hash = 0;
      const value = `${seed}:${index}`;

      for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
      }

      return { item, hash };
    })
    .sort((a, b) => a.hash - b.hash)
    .map(({ item }) => item);
}

function getGroupMap(fixtures: ExternalFixtureCandidate[]) {
  const groups = new Map<string, ExternalFixtureCandidate[]>();

  for (const fixture of fixtures) {
    const key = getExternalFixtureGroupKey(fixture);
    groups.set(key, [...(groups.get(key) ?? []), fixture]);
  }

  return [...groups.entries()]
    .map(([key, groupFixtures]) => ({
      key,
      fixtures: groupFixtures.sort(
        (a, b) =>
          new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
      ),
    }))
    .sort(
      (a, b) =>
        new Date(a.fixtures[0]?.kickoff_at ?? 0).getTime() -
        new Date(b.fixtures[0]?.kickoff_at ?? 0).getTime(),
    );
}

function isTerminal(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

function isSelectableExternalStatus(status: string) {
  return status === "TIMED" || status === "SCHEDULED";
}

export async function getEligibleActiveAutoPickSeason({
  supabase,
  seasonId,
}: {
  supabase: AdminSupabaseClient;
  seasonId: string;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select(
      "id, league_id, name, status, base_provider, base_competition_code, base_competition_name, leagues!inner(status)",
    )
    .eq("id", seasonId)
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("leagues.status", "active")
    .maybeSingle();

  return {
    season:
      data && data.base_competition_code ? (data as AutoPickSeason) : null,
    error,
  };
}

export async function getEligibleActiveAutoPickSeasons({
  supabase,
}: {
  supabase: AdminSupabaseClient;
}) {
  const { data, error } = await supabase
    .from("seasons")
    .select(
      "id, league_id, name, status, base_provider, base_competition_code, base_competition_name, leagues!inner(status)",
    )
    .eq("status", "active")
    .eq("base_provider", "football_data")
    .eq("leagues.status", "active")
    .order("created_at", { ascending: true });

  return {
    seasons: ((data as AutoPickSeason[] | null) ?? []).filter(
      (season) => Boolean(season.base_competition_code),
    ),
    error,
  };
}

export async function autoPickMissingFixtures({
  supabase,
  season,
  dryRun,
  now = new Date(),
}: {
  supabase: AdminSupabaseClient;
  season: AutoPickSeason;
  dryRun: boolean;
  now?: Date;
}) {
  const nowIso = now.toISOString();
  const deadlineBufferHours = 12;

  const { data: gameweeks, error: gameweekError } = await supabase
    .from("gameweeks")
    .select(
      `
      id,
      season_id,
      gameweek_number,
      name,
      fixture_picker_id,
      profiles (
        display_name
      )
    `,
    )
    .eq("season_id", season.id)
    .order("gameweek_number", { ascending: true });

  if (gameweekError) {
    throw new Error(gameweekError.message);
  }

  const gameweekList = (gameweeks as AutoPickGameweek[] | null) ?? [];
  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: eligiblePickerRows, error: eligiblePickerError } = await supabase
    .from("league_memberships")
    .select("user_id, profiles!inner(status)")
    .eq("league_id", season.league_id)
    .eq("status", "active")
    .eq("profiles.status", "approved");

  if (eligiblePickerError) {
    throw new Error(eligiblePickerError.message);
  }

  const eligiblePickerIds = new Set(
    ((eligiblePickerRows as { user_id: string }[] | null) ?? []).map(
      (row) => row.user_id,
    ),
  );

  if (gameweekIds.length === 0) {
    return {
      dry_run: dryRun,
      season,
      candidate_gameweeks: [],
      created_count: 0,
      updated_gameweeks: 0,
      skipped: [{ reason: "no gameweeks in active season" }],
    };
  }

  const { data: existingFixtures, error: fixtureError } = await supabase
    .from("fixtures")
    .select(
      "id, gameweek_id, status, kickoff_at, external_provider, external_fixture_id, external_competition_code",
    )
    .in("gameweek_id", gameweekIds);

  if (fixtureError) {
    throw new Error(fixtureError.message);
  }

  const existingFixtureList =
    (existingFixtures as ExistingFixtureRow[] | null) ?? [];
  const usedExternalFixtureIds = new Set(
    existingFixtureList
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value)),
  );
  const { data: predictionRows, error: predictionError } =
    existingFixtureList.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in(
            "fixture_id",
            existingFixtureList.map((fixture) => fixture.id),
          )
      : { data: [], error: null };

  if (predictionError) {
    throw new Error(predictionError.message);
  }

  const fixtureIdsWithPredictions = new Set(
    ((predictionRows as { fixture_id: string }[] | null) ?? []).map(
      (prediction) => prediction.fixture_id,
    ),
  );
  const { data: externalFixtures, error: externalError } = await supabase
    .from("external_fixtures")
    .select(
      "provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status, raw_payload, last_synced_at",
    )
    .eq("provider", "football_data")
    .eq("external_competition_code", season.base_competition_code)
    .in("status", ["TIMED", "SCHEDULED"])
    .gt("kickoff_at", nowIso)
    .order("kickoff_at", { ascending: true });

  if (externalError) {
    throw new Error(externalError.message);
  }

  const externalFixtureList =
    (externalFixtures as ExternalFixtureCandidate[] | null) ?? [];
  const groups = getGroupMap(externalFixtureList);
  const candidateGameweeks = [];
  const skipped = [];
  let createdCount = 0;
  let updatedGameweeks = 0;

  for (const gameweek of gameweekList) {
    if (!gameweek.fixture_picker_id) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "no fixture picker assigned",
      });
      continue;
    }

    if (!eligiblePickerIds.has(gameweek.fixture_picker_id)) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "fixture picker is not an approved active league member",
      });
      continue;
    }

    const currentFixtures = existingFixtureList.filter(
      (fixture) => fixture.gameweek_id === gameweek.id,
    );
    const previousGameweek =
      gameweek.gameweek_number > 1
        ? gameweekList.find(
            (candidate) =>
              candidate.gameweek_number === gameweek.gameweek_number - 1,
          )
        : null;
    const previousFixtures = previousGameweek
      ? existingFixtureList.filter(
          (fixture) => fixture.gameweek_id === previousGameweek.id,
        )
      : [];
    const previousComplete =
      !previousGameweek ||
      (previousFixtures.length > 0 &&
        previousFixtures.every((fixture) => isTerminal(fixture.status)));
    const hasPredictions = currentFixtures.some((fixture) =>
      fixtureIdsWithPredictions.has(fixture.id),
    );
    const hasTerminalFixtures =
      currentFixtures.length > 0 && currentFixtures.some((fixture) => isTerminal(fixture.status));

    if (hasPredictions) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "predictions already exist",
      });
      continue;
    }

    if (!previousComplete) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "previous gameweek is not complete",
      });
      continue;
    }

    if (hasTerminalFixtures) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "gameweek already has terminal fixtures",
      });
      continue;
    }

    const selectedBaseExternalIds = currentFixtures
      .filter(
        (fixture) =>
          fixture.external_provider === "football_data" &&
          fixture.external_competition_code === season.base_competition_code &&
          fixture.external_fixture_id,
      )
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value));
    const selectedBaseFixture = externalFixtureList.find((fixture) =>
      selectedBaseExternalIds.includes(fixture.external_fixture_id),
    );
    const group =
      (selectedBaseFixture
        ? groups.find(
            (candidate) =>
              candidate.key === getExternalFixtureGroupKey(selectedBaseFixture),
          )
        : null) ??
      groups.find((candidate) =>
        candidate.fixtures.some(
          (fixture) => !usedExternalFixtureIds.has(fixture.external_fixture_id),
        ),
      ) ??
      null;

    if (!group) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "no future base-competition fixture group available",
      });
      continue;
    }

    const eligibleGroupFixtures = group.fixtures.filter(
      (fixture) =>
        isSelectableExternalStatus(fixture.status) &&
        new Date(fixture.kickoff_at) > now &&
        (!usedExternalFixtureIds.has(fixture.external_fixture_id) ||
          selectedBaseExternalIds.includes(fixture.external_fixture_id)),
    );
    const expectedCount = getExpectedExternalPickCount(eligibleGroupFixtures.length);
    const selectedCount = selectedBaseExternalIds.length;
    const neededCount = Math.max(0, expectedCount - selectedCount);
    const firstKickoff = group.fixtures[0]?.kickoff_at ?? null;
    const deadline = firstKickoff
      ? addHours(new Date(firstKickoff), -deadlineBufferHours)
      : null;

    if (!firstKickoff || !deadline) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "fixture group has no kickoff",
      });
      continue;
    }

    if (neededCount === 0) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "fixture selection already complete",
      });
      continue;
    }

    const availableFixtures = eligibleGroupFixtures.filter(
      (fixture) => !selectedBaseExternalIds.includes(fixture.external_fixture_id),
    );
    const selectedFixtures = deterministicShuffle(
      availableFixtures,
      gameweek.id,
    ).slice(0, neededCount);
    const timeUntilFirstKickoff = formatDistanceToNowStrict(new Date(firstKickoff), {
      addSuffix: true,
    });

    const candidate = {
      gameweek_id: gameweek.id,
      gameweek_number: gameweek.gameweek_number,
      gameweek_name: gameweek.name,
      picker_id: gameweek.fixture_picker_id,
      picker_name: getPickerName(gameweek),
      first_kickoff: firstKickoff,
      deadline_at: deadline.toISOString(),
      time_until_first_kickoff: timeUntilFirstKickoff,
      selected_count: selectedCount,
      expected_count: expectedCount,
      fixtures_needed: neededCount,
      would_select: selectedFixtures.map((fixture) => ({
        external_fixture_id: fixture.external_fixture_id,
        home_team: fixture.home_team,
        away_team: fixture.away_team,
        kickoff_at: fixture.kickoff_at,
        external_matchday: fixture.external_matchday,
        external_stage: fixture.external_stage,
      })),
      due: now >= deadline,
    };
    candidateGameweeks.push(candidate);

    if (now < deadline) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "auto-pick deadline has not arrived",
        deadline_at: deadline.toISOString(),
      });
      continue;
    }

    if (selectedFixtures.length < neededCount) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: "not enough eligible base-competition fixtures",
        needed: neededCount,
        available: selectedFixtures.length,
      });
      continue;
    }

    if (dryRun) {
      continue;
    }

    const rows = selectedFixtures.map((fixture) =>
      buildLocalFixtureFromExternal({
        fixture,
        gameweekId: gameweek.id,
        competitionName: season.base_competition_name,
      }),
    );
    const { error: insertError } = await supabase.from("fixtures").insert(rows);

    if (insertError) {
      skipped.push({
        gameweek_id: gameweek.id,
        gameweek_number: gameweek.gameweek_number,
        reason: insertError.message,
      });
      continue;
    }

    for (const fixture of selectedFixtures) {
      usedExternalFixtureIds.add(fixture.external_fixture_id);
    }

    await upsertFixturesPickedActivity({
      supabase,
      gameweekId: gameweek.id,
      actioningUserId: null,
      source: "auto",
    });

    createdCount += rows.length;
    updatedGameweeks += 1;
  }

  return {
    dry_run: dryRun,
    season,
    deadline_buffer_hours: deadlineBufferHours,
    candidate_gameweeks: candidateGameweeks,
    created_count: createdCount,
    updated_gameweeks: updatedGameweeks,
    skipped,
  };
}
