export const dynamic = "force-dynamic";

import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import SubmitButton from "@/components/forms/SubmitButton";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";
import { savePickerFixtures } from "./actions";
import { redirect } from "next/navigation";

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

const slotNumbers = [1, 2, 3, 4];

function isTerminalFixtureStatus(status: string) {
  return ["completed", "postponed", "void"].includes(status);
}

function formatDateTimeLocal(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(date.getTime() - offsetMs);

  return localDate.toISOString().slice(0, 16);
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

  const { data: activeSeason } = await getActiveSeason(supabase, "id");

  const eligibleGameweeks = activeSeason
    ? await getEligiblePickerGameweeks({
        supabase,
        userId: user.id,
        activeSeasonId: activeSeason.id,
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
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
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
