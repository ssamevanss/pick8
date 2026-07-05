export const dynamic = "force-dynamic";

import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import SubmitButton from "@/components/forms/SubmitButton";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { saveExternalPickerFixtures, savePickerFixtures } from "./actions";
import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

type PickerGameweek = Gameweek & {
  fixture_picker_id: string | null;
  season_id: string;
};

type FixtureStatusRow = {
  status: string;
};

type FixtureActionRow = {
  id: string;
  status: string;
};

type ActiveSeasonPickerConfig = {
  id: string;
  base_provider: string | null;
  base_competition_code: string | null;
  base_competition_name: string | null;
};

type PickerFixture = Fixture & {
  external_provider: string | null;
  external_fixture_id: string | null;
  external_competition_code: string | null;
  external_round: string | null;
  external_matchday: number | null;
  external_status: string | null;
  external_last_synced_at: string | null;
};

type ExternalFixtureCacheRow = {
  id: string;
  provider: string;
  external_fixture_id: string;
  external_competition_code: string;
  external_round: string | null;
  external_matchday: number | null;
  external_stage: string | null;
  external_group: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  last_synced_at: string | null;
};

type UsedExternalFixtureRow = {
  external_provider: string | null;
  external_fixture_id: string | null;
  gameweek_id: string;
};

const slotNumbers = [1, 2, 3, 4];
const selectableExternalStatuses = ["TIMED", "SCHEDULED"];

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

function formatDateTimeLocal(value: string) {
  return formatInTimeZone(value, "Europe/London", "yyyy-MM-dd'T'HH:mm");
}

function formatKickoff(value: string) {
  return formatInTimeZone(value, "Europe/London", "EEE d MMM yyyy, HH:mm");
}

function formatKickoffDate(value: string) {
  return formatInTimeZone(value, "Europe/London", "EEE d MMM yyyy");
}

function formatLastImported(value: string | null) {
  return value
    ? formatInTimeZone(value, "Europe/London", "EEE d MMM yyyy, HH:mm")
    : "Unknown";
}

function getExternalGroupKey(fixture: ExternalFixtureCacheRow) {
  if (fixture.external_matchday !== null) {
    return `matchday:${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return `stage:${fixture.external_stage}`;
  }

  return `date:${formatKickoffDate(fixture.kickoff_at)}`;
}

function getExternalGroupLabel(fixture: ExternalFixtureCacheRow) {
  if (fixture.external_matchday !== null) {
    return `Matchday ${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return fixture.external_stage;
  }

  return formatKickoffDate(fixture.kickoff_at);
}

function groupExternalFixtures(fixtures: ExternalFixtureCacheRow[]) {
  const groups = new Map<
    string,
    { label: string; fixtures: ExternalFixtureCacheRow[] }
  >();

  for (const fixture of fixtures) {
    const key = getExternalGroupKey(fixture);
    const existingGroup = groups.get(key);

    groups.set(key, {
      label: existingGroup?.label ?? getExternalGroupLabel(fixture),
      fixtures: [...(existingGroup?.fixtures ?? []), fixture],
    });
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    fixtures: group.fixtures.sort(
      (a, b) =>
        new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
    ),
  }));
}

function getExpectedExternalPickCount(groupSize: number) {
  return Math.min(4, groupSize);
}

async function getEligiblePickerGameweeks({
  supabase,
  userId,
  activeSeasonId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  activeSeasonId: string;
}) {
  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("id, season_id, gameweek_number, name, fixture_picker_id")
    .eq("season_id", activeSeasonId)
    .eq("fixture_picker_id", userId)
    .order("gameweek_number", { ascending: true });

  const assignedGameweeks = (gameweeks as PickerGameweek[] | null) ?? [];
  const eligibleGameweeks: PickerGameweek[] = [];

  for (const gameweek of assignedGameweeks) {
    let previousGameweekComplete = gameweek.gameweek_number === 1;

    if (gameweek.gameweek_number === 1) {
      previousGameweekComplete = true;
    } else {
      const { data: previousGameweek } = await supabase
        .from("gameweeks")
        .select("id")
        .eq("season_id", gameweek.season_id)
        .eq("gameweek_number", gameweek.gameweek_number - 1)
        .maybeSingle();

      if (!previousGameweek) {
        continue;
      }

      const { data: previousFixtures } = await supabase
        .from("fixtures")
        .select("status")
        .eq("gameweek_id", previousGameweek.id);

      const previousFixtureList =
        (previousFixtures as FixtureStatusRow[] | null) ?? [];

      previousGameweekComplete =
        previousFixtureList.length > 0 &&
        previousFixtureList.every((fixture) =>
          isTerminalFixtureStatus(fixture.status),
        );
    }

    if (!previousGameweekComplete) {
      continue;
    }

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, status")
      .eq("gameweek_id", gameweek.id);

    const fixtureList = (fixtures as FixtureActionRow[] | null) ?? [];
    const allFixturesClosed =
      fixtureList.length > 0 &&
      fixtureList.every((fixture) => isTerminalFixtureStatus(fixture.status));

    if (allFixturesClosed) {
      continue;
    }

    const fixtureIds = fixtureList.map((fixture) => fixture.id);
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
      eligibleGameweeks.push(gameweek);
    }
  }

  return eligibleGameweeks;
}

export default async function PickFixturesPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string; error?: string; gameweek?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: activeSeason } = await getActiveSeason(
    supabase,
    "id, base_provider, base_competition_code, base_competition_name",
  );
  const activeSeasonConfig = activeSeason as ActiveSeasonPickerConfig | null;

  const eligibleGameweeks = activeSeason
    ? await getEligiblePickerGameweeks({
        supabase,
        userId: user.id,
        activeSeasonId: activeSeasonConfig!.id,
      })
    : [];

  if (!activeSeason) {
    return (
      <>
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Pick Fixtures</h1>
          <p className="mt-2 text-sm text-slate-400">
            Fixture picking will open once an admin activates a season.
          </p>
        </header>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-300">
            No active season
          </p>
          <p className="mt-2 text-sm text-slate-300">
            There is no live season for fixture selection yet.
          </p>
        </section>
      </>
    );
  }

  if (eligibleGameweeks.length === 0) {
    return (
      <>
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Pick Fixtures</h1>
          <p className="mt-2 text-sm text-slate-400">
            You are not currently assigned to pick fixtures for an unlocked
            active-season gameweek.
          </p>
        </header>

        <section className="rounded-2xl bg-slate-900 p-4 shadow-lg">
          <p className="text-sm font-semibold text-slate-300">
            Nothing to pick right now
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Your assigned gameweek may still be locked until the previous
            gameweek is complete, predictions may already exist, or you may not
            be scheduled as a picker.
          </p>
        </section>
      </>
    );
  }

  const selectedGameweek =
    eligibleGameweeks.find((gameweek) => gameweek.id === params.gameweek) ??
    eligibleGameweeks[0];

  const { data: fixtures, error: fixturesError } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score, external_provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_status, external_last_synced_at",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as PickerFixture[] | null) ?? [];
  const fixtureIds = fixtureList.map((fixture) => fixture.id);

  const { data: existingPrediction } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("fixture_id")
          .in("fixture_id", fixtureIds)
          .limit(1)
          .maybeSingle()
      : { data: null };

  const isLockedByPredictions = Boolean(existingPrediction);
  const pickerFixtures = fixtureList.slice(0, 4);
  const extraFixtureCount = Math.max(0, fixtureList.length - 4);
  const completedFixtureSlots = pickerFixtures.length;
  const isComplete = completedFixtureSlots === 4;
  const currentExternalFixtureIds = new Set(
    fixtureList
      .map((fixture) => fixture.external_fixture_id)
      .filter((value): value is string => Boolean(value)),
  );

  const externalFixturesConfigured =
    activeSeasonConfig?.base_provider === "football_data" &&
    Boolean(activeSeasonConfig.base_competition_code);

  const { data: seasonGameweeks } = activeSeasonConfig?.id
    ? await supabase
        .from("gameweeks")
        .select("id")
        .eq("season_id", activeSeasonConfig.id)
    : { data: null };

  const seasonGameweekIds =
    (seasonGameweeks as { id: string }[] | null)?.map((gameweek) => gameweek.id) ??
    [];

  const { data: usedExternalFixtures } =
    seasonGameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("external_provider, external_fixture_id, gameweek_id")
          .in("gameweek_id", seasonGameweekIds)
          .not("external_provider", "is", null)
          .not("external_fixture_id", "is", null)
      : { data: [] };

  const usedExternalFixtureList =
    (usedExternalFixtures as UsedExternalFixtureRow[] | null) ?? [];
  const externalFixtureUsedInAnotherGameweek = new Set(
    usedExternalFixtureList
      .filter((fixture) => fixture.gameweek_id !== selectedGameweek.id)
      .map((fixture) => `${fixture.external_provider}:${fixture.external_fixture_id}`),
  );

  const nowIso = new Date().toISOString();
  const { data: externalFixtures, error: externalFixturesError } =
    externalFixturesConfigured
      ? await supabase
          .from("external_fixtures")
          .select(
            "id, provider, external_fixture_id, external_competition_code, external_round, external_matchday, external_stage, external_group, home_team, away_team, kickoff_at, status, last_synced_at",
          )
          .eq("provider", activeSeasonConfig!.base_provider!)
          .eq(
            "external_competition_code",
            activeSeasonConfig!.base_competition_code!,
          )
          .in("status", selectableExternalStatuses)
          .gt("kickoff_at", nowIso)
          .order("kickoff_at", { ascending: true })
      : { data: null, error: null };

  const allExternalFixtureRows =
    (externalFixtures as ExternalFixtureCacheRow[] | null) ?? [];
  const selectableExternalFixtureRows = allExternalFixtureRows.filter(
    (fixture) =>
      !externalFixtureUsedInAnotherGameweek.has(
        `${fixture.provider}:${fixture.external_fixture_id}`,
      ) || currentExternalFixtureIds.has(fixture.external_fixture_id),
  );
  const externalFixtureGroups = groupExternalFixtures(
    selectableExternalFixtureRows,
  );
  const selectedExternalGroup =
    externalFixtureGroups.find((group) =>
      group.fixtures.some((fixture) =>
        currentExternalFixtureIds.has(fixture.external_fixture_id),
      ),
    ) ??
    externalFixtureGroups[0] ??
    null;
  const expectedExternalPickCount = selectedExternalGroup
    ? getExpectedExternalPickCount(selectedExternalGroup.fixtures.length)
    : 0;
  const currentSelectedExternalCount = selectedExternalGroup
    ? selectedExternalGroup.fixtures.filter((fixture) =>
        currentExternalFixtureIds.has(fixture.external_fixture_id),
      ).length
    : 0;
  const latestExternalImport =
    allExternalFixtureRows
      .map((fixture) => fixture.last_synced_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const inputClassName =
    "mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-800 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Pick Fixtures</h1>
        <p className="mt-2 text-sm text-slate-400">
          Choose the four fixtures for your assigned gameweek.
        </p>
      </header>

      {params.saved ? (
        <p className="mb-4 rounded-xl bg-emerald-950 p-3 text-sm text-emerald-300">
          Fixtures saved.
        </p>
      ) : null}

      {params.error ? (
        <p className="mb-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {params.error}
        </p>
      ) : null}

      <section className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <GameweekSelector
          gameweeks={eligibleGameweeks}
          selectedGameweekId={selectedGameweek?.id ?? null}
          basePath="/pick-fixtures"
        />

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {selectedGameweek?.name ||
                `Gameweek ${selectedGameweek.gameweek_number}`}
            </h2>
            <p className="text-sm text-slate-400">
              Fill in up to four fixtures, then save once.
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
              isComplete
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {isComplete
              ? "Ready"
              : `${completedFixtureSlots}/4 fixtures selected`}
          </span>
        </div>

        {fixturesError ? (
          <p className="rounded-xl bg-red-950 p-4 text-sm text-red-300">
            Could not load fixtures for this gameweek. Please try again shortly.
          </p>
        ) : null}

        {isLockedByPredictions ? (
          <p className="mb-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-300">
            Fixture selection is locked because predictions have already been
            entered. Ask an admin if a fixture needs to be changed.
          </p>
        ) : null}

        {extraFixtureCount > 0 ? (
          <p className="mb-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-300">
            This gameweek has {extraFixtureCount} extra fixture
            {extraFixtureCount === 1 ? "" : "s"} created by admin. Pickers can
            only edit the first four fixtures.
          </p>
        ) : null}

        {externalFixturesConfigured ? (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  External fixtures
                </p>
                <h3 className="mt-1 text-lg font-semibold">
                  {activeSeasonConfig?.base_competition_name ??
                    activeSeasonConfig?.base_competition_code}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Cached fixtures from football-data.org. Last imported:{" "}
                  {formatLastImported(latestExternalImport)}. If fixtures are
                  missing, ask an admin to refresh the external fixture cache.
                </p>
              </div>

              <span className="inline-flex w-fit rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                {currentSelectedExternalCount} of {expectedExternalPickCount}{" "}
                selected
              </span>
            </div>

            {externalFixturesError ? (
              <p className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-300">
                Could not load cached external fixtures.
              </p>
            ) : null}

            {!externalFixturesError && allExternalFixtureRows.length === 0 ? (
              <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
                No upcoming cached fixtures are available for this competition.
              </p>
            ) : null}

            {!externalFixturesError &&
            allExternalFixtureRows.length > 0 &&
            selectableExternalFixtureRows.length === 0 ? (
              <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
                Cached fixtures exist, but all selectable fixtures have already
                been used in another active-season gameweek.
              </p>
            ) : null}

            {selectedExternalGroup && !isLockedByPredictions ? (
              <form action={saveExternalPickerFixtures} className="mt-4">
                <input
                  type="hidden"
                  name="gameweek_id"
                  value={selectedGameweek.id}
                />
                <input
                  type="hidden"
                  name="expected_pick_count"
                  value={expectedExternalPickCount}
                />

                <div className="space-y-5">
                  <div key={selectedExternalGroup.key}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-slate-200">
                        {selectedExternalGroup.label}
                      </h4>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300">
                        Next group
                      </span>
                    </div>

                    <div className="grid gap-3">
                      {selectedExternalGroup.fixtures.map((fixture) => {
                        const isAlreadySelected =
                          currentExternalFixtureIds.has(
                            fixture.external_fixture_id,
                          );

                        return (
                          <label
                            key={fixture.external_fixture_id}
                            className="flex cursor-pointer gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 has-[:checked]:border-emerald-500/60 has-[:checked]:bg-emerald-500/10"
                          >
                            <input
                              type="checkbox"
                              name="external_fixture_id"
                              value={fixture.external_fixture_id}
                              defaultChecked={isAlreadySelected}
                              className="mt-1 h-4 w-4 accent-emerald-500"
                            />

                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-white">
                                {fixture.home_team || "Unknown home team"} vs{" "}
                                {fixture.away_team || "Unknown away team"}
                              </span>
                              <span className="mt-1 block text-xs text-slate-400">
                                {formatKickoff(fixture.kickoff_at)} ·{" "}
                                {fixture.external_matchday !== null
                                  ? `Matchday ${fixture.external_matchday}`
                                  : (fixture.external_stage ??
                                    fixture.external_round ??
                                    "Round TBC")}{" "}
                                · {fixture.status}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <p className="mt-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-400">
                  Select {expectedExternalPickCount} cached fixture
                  {expectedExternalPickCount === 1 ? "" : "s"}. Saving external fixtures
                  replaces the current editable picker fixtures for this
                  gameweek. Manual entry remains available below.
                </p>

                <SubmitButton
                  idleLabel="Save selected cached fixtures"
                  pendingLabel="Saving cached fixtures..."
                  className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
                />
              </form>
            ) : null}

            {isLockedByPredictions ? (
              <p className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-400">
                Cached fixture selection is read-only because predictions have
                already been entered.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-sm font-semibold text-slate-300">
              External fixtures are not configured for this season.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Use the manual fallback below.
            </p>
          </section>
        )}

        <div className="mb-3">
          <h3 className="text-lg font-semibold">Manual fallback</h3>
          <p className="text-sm text-slate-400">
            Enter fixtures manually or edit the current editable picks.
          </p>
        </div>

        <form action={savePickerFixtures} className="space-y-4">
          <input type="hidden" name="gameweek_id" value={selectedGameweek.id} />

          {slotNumbers.map((slotNumber) => {
            const fixture = pickerFixtures[slotNumber - 1];

            return (
              <div
                key={slotNumber}
                className="rounded-xl border border-slate-800 bg-slate-950 p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    Fixture {slotNumber}
                  </h3>

                  {fixture ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300">
                      Saved
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-400">
                      Empty
                    </span>
                  )}
                </div>

                <input
                  type="hidden"
                  name={`fixture_id_${slotNumber}`}
                  value={fixture?.id ?? ""}
                />

                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label className="text-sm text-slate-300">Home team</label>
                    <input
                      name={`home_team_${slotNumber}`}
                      defaultValue={fixture?.home_team ?? ""}
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Away team</label>
                    <input
                      name={`away_team_${slotNumber}`}
                      defaultValue={fixture?.away_team ?? ""}
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Kickoff</label>
                    <input
                      name={`kickoff_at_${slotNumber}`}
                      type="datetime-local"
                      defaultValue={
                        fixture ? formatDateTimeLocal(fixture.kickoff_at) : ""
                      }
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">
                      Competition
                    </label>
                    <input
                      name={`competition_${slotNumber}`}
                      defaultValue={fixture?.competition ?? "Premier League"}
                      disabled={isLockedByPredictions}
                      className={inputClassName}
                    />
                  </div>
                </div>

                {fixture && !isLockedByPredictions ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Clear all fields in this row and save to remove this
                    fixture.
                  </p>
                ) : null}
              </div>
            );
          })}

          {isLockedByPredictions ? (
            <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              These fixtures are now read-only for the picker.
            </p>
          ) : (
            <SubmitButton
              idleLabel="Save fixtures"
              pendingLabel="Saving fixtures..."
              className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
            />
          )}
        </form>
      </section>
    </>
  );
}
