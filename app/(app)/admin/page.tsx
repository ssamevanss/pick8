export const dynamic = "force-dynamic";

import AdminAddFixtureForm from "@/components/admin/AdminAddFixtureForm";
import AdminCreateGameweekForm from "@/components/admin/AdminCreateGameweekForm";
import AdminManageFixtureCard from "@/components/admin/AdminManageFixtureCard";
import AdminResultFixtureCard from "@/components/admin/AdminResultFixtureCard";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminUserCard, {
  type AdminUser,
} from "@/components/admin/AdminUserCard";
import GameweekSelector from "@/components/gameweeks/GameweekSelector";
import type { Fixture, Gameweek } from "@/components/predictions/types";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  assignFixturePickers,
  createGameweekWithFixtures,
  generateMissingGameweeks,
  saveFixturePickerOrder,
  updateFixtureResults,
} from "./actions";
import SubmitButton from "@/components/forms/SubmitButton";
import AdminSeasonSetupCard from "@/components/admin/AdminSeasonSetupCard";
import AdminFixturePickerOrderCard from "@/components/admin/AdminFixturePickerOrderCard";

type Profile = {
  id: string;
  display_name: string;
};

type AdminTab = "create" | "fixtures" | "results" | "users";

function getSelectedTab(tab: string | undefined): AdminTab {
  if (
    tab === "create" ||
    tab === "fixtures" ||
    tab === "results" ||
    tab === "users"
  ) {
    return tab;
  }

  return "fixtures";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    gameweek?: string;
    tab?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedTab = getSelectedTab(params.tab);
  const selectedGameweekId = params.gameweek;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard?error=Admin access required");
  }

  const { data: activeSeason } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("is_active", true)
    .single();

  const { data: pickerOrder } = activeSeason
  ? await supabase
      .from("fixture_picker_order")
      .select("user_id, sort_order")
      .eq("season_id", activeSeason.id)
      .order("sort_order", { ascending: true })
  : { data: null };

  const { data: gameweeks } = activeSeason
    ? await supabase
        .from("gameweeks")
        .select("id, gameweek_number, name")
        .eq("season_id", activeSeason.id)
        .order("gameweek_number", { ascending: true })
    : { data: null };

  const gameweekList = (gameweeks ?? []) as Gameweek[];

  const gameweekIds = gameweekList.map((gameweek) => gameweek.id);

  const { data: fixtureRows } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("gameweek_id")
          .in("gameweek_id", gameweekIds)
      : { data: [] };

  const gameweekIdsWithFixtures = new Set(
    (fixtureRows ?? []).map((fixture) => fixture.gameweek_id),
  );

  const latestGameweekWithFixtures =
    [...gameweekList]
      .reverse()
      .find((gameweek) => gameweekIdsWithFixtures.has(gameweek.id)) ?? null;

  const selectedGameweek =
    gameweekList.find((gameweek) => gameweek.id === selectedGameweekId) ??
    latestGameweekWithFixtures ??
    gameweekList[gameweekList.length - 1] ??
    null;

  const nextGameweekNumber =
    gameweekList.length > 0
      ? Math.max(...gameweekList.map((gameweek) => gameweek.gameweek_number)) +
        1
      : 1;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  const { data: adminUsers, error: adminUsersError } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, status")
    .order("status", { ascending: false })
    .order("display_name", { ascending: true });

  const { data: fixtures, error } = selectedGameweek
    ? await supabase
        .from("fixtures")
        .select(
          "id, gameweek_id, home_team, away_team, kickoff_at, competition, status, home_score, away_score",
        )
        .eq("gameweek_id", selectedGameweek.id)
        .order("kickoff_at", { ascending: true })
    : { data: null, error: null };

  const fixtureList = (fixtures as Fixture[] | null) ?? [];
  const userList = (adminUsers as AdminUser[] | null) ?? [];
  const pendingUsers = userList.filter((adminUser) => adminUser.status === "pending");
  const approvedUsers = userList.filter(
    (adminUser) => adminUser.status === "approved",
  );
  const rejectedUsers = userList.filter(
    (adminUser) => adminUser.status === "rejected",
  );
  const disabledUsers = userList.filter(
    (adminUser) => adminUser.status === "disabled",
  );

  return (
    <>
      <h1 className="text-3xl font-bold">Admin</h1>
      <p className="mt-2 text-sm text-slate-400">
        Create gameweeks, manage fixtures, enter final results, and manage
        users.
      </p>

      <AdminTabs
        selectedTab={selectedTab}
        selectedGameweekId={selectedGameweek?.id ?? null}
      />

      {params.saved ? (
        <p className="mt-4 rounded-xl bg-emerald-950 p-3 text-sm text-emerald-300">
          Saved successfully.
        </p>
      ) : null}

      {params.error ? (
        <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-300">
          {params.error}
        </p>
      ) : null}

      {selectedTab === "create" ? (
        <>
          <AdminSeasonSetupCard
            activeSeasonId={activeSeason?.id ?? null}
            activeSeasonName={activeSeason?.name ?? null}
            existingGameweekCount={gameweekList.length}
            action={generateMissingGameweeks}
          />

          <AdminFixturePickerOrderCard
            activeSeasonId={activeSeason?.id ?? null}
            profiles={(profiles as Profile[] | null) ?? []}
            pickerOrder={
              (pickerOrder as { user_id: string; sort_order: number }[] | null) ?? []
            }
            saveAction={saveFixturePickerOrder}
            assignAction={assignFixturePickers}
          />
        </>
      ) : null}

      {selectedTab === "fixtures" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <GameweekSelector
            gameweeks={gameweekList}
            selectedGameweekId={selectedGameweek?.id ?? null}
            basePath="/admin?tab=fixtures"
          />

          <h2 className="text-xl font-semibold">Manage fixtures</h2>
          <p className="mt-2 text-sm text-slate-400">
            Edit teams, kickoff times, and competitions for the selected
            gameweek.
          </p>

          {error ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No fixtures found for this gameweek.
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
            {fixtureList.map((fixture) => (
              <AdminManageFixtureCard key={fixture.id} fixture={fixture} />
            ))}

            <AdminAddFixtureForm gameweekId={selectedGameweek?.id ?? null} />
          </div>
          <details className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300">
              Advanced: manually create a gameweek
            </summary>

            <div className="mt-4">
              <AdminCreateGameweekForm
                activeSeasonId={activeSeason?.id ?? null}
                nextGameweekNumber={nextGameweekNumber}
                profiles={(profiles as Profile[] | null) ?? []}
                action={createGameweekWithFixtures}
              />
            </div>
          </details>
        </section>
      ) : null}

      {selectedTab === "results" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <GameweekSelector
            gameweeks={gameweekList}
            selectedGameweekId={selectedGameweek?.id ?? null}
            basePath="/admin?tab=results"
          />

          <h2 className="text-xl font-semibold">Enter results</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add final scores for the selected gameweek. This will calculate
            prediction points and update the leaderboard.
          </p>

          {error ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {error.message}
            </p>
          ) : null}

          {!error && fixtureList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No fixtures found for this gameweek.
            </p>
          ) : null}

          <form action={updateFixtureResults} className="mt-4 space-y-3">
            {fixtureList.map((fixture) => (
              <AdminResultFixtureCard key={fixture.id} fixture={fixture} />
            ))}

            {fixtureList.length > 0 ? (
              <SubmitButton
                idleLabel="Save results"
                pendingLabel="Saving results..."
                className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
              />
            ) : null}
          </form>
        </section>
      ) : null}

      {selectedTab === "users" ? (
        <section className="mt-6 rounded-2xl bg-slate-900 p-4 shadow-lg">
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="mt-2 text-sm text-slate-400">
            Review account requests and manage display names and roles for league
            members.
          </p>

          {adminUsersError ? (
            <p className="mt-4 rounded-xl bg-red-950 p-4 text-sm text-red-300">
              {adminUsersError.message}
            </p>
          ) : null}

          {!adminUsersError && userList.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
              No users found.
            </p>
          ) : null}

          <div className="mt-6 space-y-8">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Pending approval</h3>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                  {pendingUsers.length}
                </span>
              </div>

              {pendingUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No pending account requests.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {pendingUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Approved users</h3>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  {approvedUsers.length}
                </span>
              </div>

              {approvedUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No approved users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {approvedUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Disabled users</h3>
                <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-300 ring-1 ring-slate-500/30">
                  {disabledUsers.length}
                </span>
              </div>

              {disabledUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No disabled users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {disabledUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Rejected users</h3>
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300 ring-1 ring-red-500/30">
                  {rejectedUsers.length}
                </span>
              </div>

              {rejectedUsers.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
                  No rejected users.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {rejectedUsers.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      currentUserId={user!.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}