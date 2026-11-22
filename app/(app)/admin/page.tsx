import Link from "next/link";
import MatchdaySelectNavigation from "@/components/picks/MatchdaySelectNavigation";
import { redirect } from "next/navigation";
import { getRequestAuthContext, type Pick8Profile } from "@/utils/app-context";
import { createAdminClient } from "@/utils/supabase/admin";
import { updateProfile } from "./profile-actions";
import SubmitButton from "@/components/forms/SubmitButton";
import CronHealthSection from "@/components/admin/CronHealthSection";
import { loadCronHealth } from "@/utils/pick8-cron-executions-store";
import {
  buildCurrentSubmissionRows,
  sortPick8AdminProfiles,
  type Pick8SubmissionStatus,
} from "@/utils/pick8-admin-status";
import {
  resolveDashboardMatchday,
  type StandingsMatchday,
} from "@/utils/pick8-standings";

const STATUS_LABELS: Record<Pick8SubmissionStatus, string> = {
  not_submitted: "Not Submitted",
  draft: "Draft",
  submitted: "Submitted",
};

const STATUS_CLASSES: Record<Pick8SubmissionStatus, string> = {
  not_submitted: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  draft: "border-amber-300/35 bg-amber-300/10 text-amber-100",
  submitted: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; saved?: string; matchday?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, profile } = await getRequestAuthContext();

  if (!user || !profile?.is_admin || !profile.is_active) {
    redirect("/dashboard?error=Admin+access+required");
  }
  const admin = createAdminClient();
  const requestNow = new Date().getTime();

  const [{ data: profileData, error: profileError }, { data: season, error: seasonError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, display_name, is_admin, is_active, pick8_participation_active, created_at, updated_at"),
    supabase
      .from("seasons")
      .select("id, name")
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (profileError) {
    console.error("Pick8 admin profile load failed", {
      code: profileError.code,
      message: profileError.message,
    });
  }
  if (seasonError) {
    console.error("Pick8 admin active season load failed", {
      code: seasonError.code,
      message: seasonError.message,
    });
  }
  const profiles = sortPick8AdminProfiles((profileData as Pick8Profile[] | null) ?? []);

  let selectedMatchday: StandingsMatchday | null = null;
  let matchdays: StandingsMatchday[] = [];
  let fixtureCount = 0;
  let submissionEntries: Array<{ user_id: string; submitted_at: string | null }> = [];
  let submissionError: string | null = profileError?.message ?? seasonError?.message ?? null;

  if (!submissionError && season) {
    const { data: matchdayData, error: matchdayError } = await supabase
      .from("matchdays")
      .select("id, matchday_number, status, locks_at")
      .eq("season_id", season.id)
      .order("matchday_number");
    if (matchdayError) {
      console.error("Pick8 admin matchday load failed", {
        code: matchdayError.code,
        message: matchdayError.message,
      });
      submissionError = matchdayError.message;
    } else {
      matchdays = (matchdayData ?? []) as StandingsMatchday[];
      const requestedNumber = typeof params.matchday === "string" && /^\d+$/.test(params.matchday)
        ? Number(params.matchday) : null;
      selectedMatchday = matchdays.find((matchday) => matchday.matchday_number === requestedNumber)
        ?? resolveDashboardMatchday(matchdays, requestNow) ?? matchdays[0] ?? null;
    }
  }

  if (selectedMatchday) {
    const [{ data, error }, { count, error: fixturesError }] = await Promise.all([
      admin.from("entries").select("user_id, submitted_at").eq("matchday_id", selectedMatchday.id),
      supabase.from("fixtures").select("id", { count: "exact", head: true }).eq("matchday_id", selectedMatchday.id),
    ]);
    fixtureCount = count ?? 0;
    if (fixturesError) submissionError = fixturesError.message;
    if (error) {
      console.error("Pick8 admin submission status load failed", {
        code: error.code,
        message: error.message,
        matchdayId: selectedMatchday.id,
      });
      submissionError = error.message;
    }
    else submissionEntries = data ?? [];
  }

  // Monitoring is informational: an unreadable history must never break the rest of the admin page.
  const cronHealth = await loadCronHealth().catch((error) => {
    console.error("Pick8 admin cron health load failed", {
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return null;
  });

  const submissionRows = selectedMatchday
    ? buildCurrentSubmissionRows(profiles, submissionEntries)
    : [];
  const submissionCounts = submissionRows.reduce(
    (counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }),
    { submitted: 0, draft: 0, not_submitted: 0 },
  );

  return (
    <div className="space-y-6">
      <header className="brand-card p-5 sm:p-6">
        <p className="brand-eyebrow">Administration</p>
        <h1 className="brand-title mt-2">Pick8 operations</h1>
        <p className="brand-subtitle mt-2">
          Check matchday submissions and manage player access and participation.
        </p>
      </header>

      {params.error || profileError ? (
        <p className="brand-alert-danger">{params.error ?? "Users could not be loaded. Please try again."}</p>
      ) : null}
      {params.saved ? <p className="brand-alert-success">Profile saved.</p> : null}

      <section className="brand-card p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="brand-eyebrow">Selected matchday</p>
            <h2 className="mt-1 text-2xl font-black text-white">
              {selectedMatchday ? `Matchday ${selectedMatchday.matchday_number} · ${selectedMatchday.status.charAt(0).toUpperCase()}${selectedMatchday.status.slice(1)}` : "Submission status"}
            </h2>
          </div>
          {selectedMatchday ? (
            <p className="text-sm font-bold text-slate-300">
              <span className="text-emerald-200">{submissionCounts.submitted} Submitted</span>
              <span aria-hidden="true"> · </span>
              <span className="text-amber-100">{submissionCounts.draft} Draft</span>
              <span aria-hidden="true"> · </span>
              <span className="text-rose-200">{submissionCounts.not_submitted} Not Submitted</span>
            </p>
          ) : null}
        </div>

        {selectedMatchday && matchdays.length ? <MatchdaySelectNavigation
          currentMatchday={selectedMatchday.matchday_number}
          matchdays={matchdays.map((matchday) => ({ number: matchday.matchday_number, label: `Matchday ${matchday.matchday_number} · ${matchday.status.charAt(0).toUpperCase()}${matchday.status.slice(1)}` }))}
          className="mt-4 w-full sm:max-w-sm"
        /> : null}
        {!submissionError && selectedMatchday && fixtureCount === 0 ? <p className="brand-alert-warning mt-3">Fixtures have not been populated for this matchday yet. Picks can be entered once fixtures are available.</p> : null}

        {submissionError ? (
          <p className="brand-alert-danger mt-4">Submission status could not be loaded. Please try again.</p>
        ) : !season ? (
          <p className="mt-4 text-sm text-slate-400">There is no active Pick8 season.</p>
        ) : !selectedMatchday ? (
          <p className="mt-4 text-sm text-slate-400">There are no matchdays in the active season.</p>
        ) : submissionRows.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-4">
              <span>Player / picks</span><span>Status</span>
            </div>
            <ul className="divide-y divide-white/10">
              {submissionRows.map(({ profile: item, status }) => (
                <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0"><span className="block truncate text-sm font-bold text-white">{item.display_name}</span>
                  {fixtureCount > 0 ? <Link className="text-sm text-sky-300 underline" href={`/admin/entries?player=${item.id}&matchday=${selectedMatchday.id}`}>{status === "not_submitted" ? "Enter picks" : "View / correct picks"}</Link> : <span className="text-sm text-slate-400">Awaiting fixtures</span>}</div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_CLASSES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No eligible participants are available for this matchday.</p>
        )}
      </section>

      <CronHealthSection data={cronHealth} />

      <section>
        <div className="mb-4">
          <p className="brand-eyebrow">Users</p>
          <h2 className="mt-1 text-2xl font-black text-white">Player management</h2>
          <p className="mt-1 text-sm text-slate-400">
            Account access controls login. Pick8 participation controls entry into open matchdays; historical results are retained.
          </p>
        </div>

        <div className="space-y-3">
          {profiles.map((item) => {
            const isCurrentUser = item.id === user.id;
            return (
              <form key={item.id} action={updateProfile} className="brand-card p-4 sm:p-5">
                <input type="hidden" name="user_id" value={item.id} />
                <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(24rem,1.3fr)_auto] lg:items-end">
                  <div className="min-w-0">
                    <label className="text-sm text-slate-300" htmlFor={`display-name-${item.id}`}>Display name</label>
                    <input id={`display-name-${item.id}`} name="display_name" defaultValue={item.display_name} required maxLength={80} className="brand-input" />
                    <p className="mt-2 truncate text-xs text-slate-500" title={item.email ?? "No email"}>
                      {item.email ?? "No email"}{isCurrentUser ? " · This is you" : ""}
                    </p>
                  </div>

                  <fieldset className="grid gap-2 sm:grid-cols-3">
                    <legend className="sr-only">Access for {item.display_name}</legend>
                    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-slate-200">
                      {isCurrentUser ? <input type="hidden" name="is_active" value="on" /> : null}
                      <input type="checkbox" name="is_active" defaultChecked={item.is_active} disabled={isCurrentUser} className="h-5 w-5 shrink-0 accent-emerald-400" />
                      Account active
                    </label>
                    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-slate-200">
                      <input type="checkbox" name="pick8_participation_active" defaultChecked={item.pick8_participation_active} className="h-5 w-5 shrink-0 accent-emerald-400" />
                      Pick8 participation active
                    </label>
                    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-slate-200">
                      {isCurrentUser ? <input type="hidden" name="is_admin" value="on" /> : null}
                      <input type="checkbox" name="is_admin" defaultChecked={item.is_admin} disabled={isCurrentUser} className="h-5 w-5 shrink-0 accent-emerald-400" />
                      Administrator
                    </label>
                  </fieldset>

                  <SubmitButton idleLabel="Save" pendingLabel="Saving…" className="brand-button-primary w-full lg:w-auto" />
                </div>
              </form>
            );
          })}

          {!profileError && profiles.length === 0 ? (
            <p className="brand-card p-5 text-sm text-slate-400">No users found.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
