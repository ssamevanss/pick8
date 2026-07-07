import { formatInTimeZone } from "date-fns-tz";
import { addExternalFixturesToGameweek } from "@/app/(app)/admin/actions";
import SubmitButton from "@/components/forms/SubmitButton";
import { getExternalFixtureGroupKey } from "@/utils/external-fixtures";
import {
  isKickoffOutsideTimingWindow,
  type FixtureTimingWindow,
} from "@/utils/fixture-timing-window";
import type { FootballCompetitionOption } from "@/utils/football-competitions";

export type AdminExternalFixtureOption = {
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
  disabledReason?: string | null;
};

type AdminExternalFixturePickerCardProps = {
  gameweekId: string | null;
  configured: boolean;
  provider: string | null;
  competitionCode: string | null;
  competitionName: string | null;
  baseCompetitionCode: string | null;
  competitionOptions: FootballCompetitionOption[];
  timingWindowText: string | null;
  timingWindow: FixtureTimingWindow | null;
  fixtures: AdminExternalFixtureOption[];
};

function formatKickoff(value: string) {
  return formatInTimeZone(value, "Europe/London", "EEE d MMM yyyy, HH:mm");
}

function formatKickoffDate(value: string) {
  return formatInTimeZone(value, "Europe/London", "EEE d MMM yyyy");
}

function getGroupLabel(fixture: AdminExternalFixtureOption) {
  if (fixture.external_matchday !== null) {
    return `Matchday ${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return fixture.external_stage;
  }

  return formatKickoffDate(fixture.kickoff_at);
}

function groupFixtures(fixtures: AdminExternalFixtureOption[]) {
  const groups = new Map<
    string,
    { label: string; fixtures: AdminExternalFixtureOption[] }
  >();

  for (const fixture of fixtures) {
    const key = getExternalFixtureGroupKey(fixture);
    const existing = groups.get(key);

    groups.set(key, {
      label: existing?.label ?? getGroupLabel(fixture),
      fixtures: [...(existing?.fixtures ?? []), fixture],
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

export default function AdminExternalFixturePickerCard({
  gameweekId,
  configured,
  provider,
  competitionCode,
  competitionName,
  baseCompetitionCode,
  competitionOptions,
  timingWindowText,
  timingWindow,
  fixtures,
}: AdminExternalFixturePickerCardProps) {
  if (!gameweekId) {
    return null;
  }

  const groups = groupFixtures(fixtures);
  const isBaseCompetition = competitionCode === baseCompetitionCode;
  const hasTimingWarnings = fixtures.some((fixture) =>
    isKickoffOutsideTimingWindow({
      kickoffAt: fixture.kickoff_at,
      timingWindow,
    }),
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <h3 className="text-lg font-semibold">Add fixtures from match list</h3>
      <p className="mt-1 text-sm text-slate-400">
        Select cached fixtures for this gameweek. This does not call the
        provider directly.
      </p>

      <div className="mt-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-400">
        {configured ? (
          <>
            {provider} / {competitionCode}
            {competitionName ? ` - ${competitionName}` : ""}
          </>
        ) : (
          "Configure an active season base provider and competition to use cached fixtures."
        )}
      </div>

      {configured && competitionOptions.length > 1 ? (
        <form
          action="/admin"
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"
        >
          <input type="hidden" name="tab" value="gameweeks" />
          <input type="hidden" name="gameweek" value={gameweekId} />
          <label className="min-w-0">
            <span className="text-sm font-semibold text-slate-300">
              Browse competition
            </span>
            <select
              name="competition"
              defaultValue={competitionCode ?? ""}
              className="brand-input mt-1"
            >
              {competitionOptions.map((competition) => (
                <option
                  key={competition.external_competition_code}
                  value={competition.external_competition_code}
                >
                  {competition.name} ({competition.external_competition_code})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="brand-button-secondary sm:self-end">
            Browse
          </button>
        </form>
      ) : null}

      {configured && !isBaseCompetition ? (
        <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200">
          Special fixture override: this is not the season base competition.
        </p>
      ) : null}

      {!configured ? null : groups.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-400">
          No selectable cached fixtures are available for this competition.
        </p>
      ) : (
        <form action={addExternalFixturesToGameweek} className="mt-4 space-y-4">
          <input type="hidden" name="gameweek_id" value={gameweekId} />
          <input
            type="hidden"
            name="competition_code"
            value={competitionCode ?? ""}
          />

          {groups.map((group) => (
            <fieldset
              key={group.key}
              className="rounded-xl border border-slate-800 p-3"
            >
              <legend className="px-1 text-sm font-semibold text-slate-200">
                {group.label}
              </legend>

              <div className="mt-2 space-y-2">
                {group.fixtures.map((fixture) => {
                  const disabled = Boolean(fixture.disabledReason);
                  const outsideTimingWindow = isKickoffOutsideTimingWindow({
                    kickoffAt: fixture.kickoff_at,
                    timingWindow,
                  });

                  return (
                    <label
                      key={fixture.external_fixture_id}
                      className={`flex gap-3 rounded-lg border p-3 text-sm ${
                        disabled
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/60 opacity-60"
                          : outsideTimingWindow
                            ? "cursor-pointer border-amber-300/25 bg-amber-300/10"
                          : "cursor-pointer border-slate-700 bg-slate-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="external_fixture_id"
                        value={fixture.external_fixture_id}
                        disabled={disabled}
                        className="mt-1"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-white">
                          {fixture.home_team} vs {fixture.away_team}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {formatKickoff(fixture.kickoff_at)} ·{" "}
                          {fixture.external_competition_code}
                          {fixture.external_stage
                            ? ` · ${fixture.external_stage}`
                            : ""}
                          {fixture.external_matchday !== null
                            ? ` · Matchday ${fixture.external_matchday}`
                            : ""}
                          {fixture.external_round
                            ? ` · ${fixture.external_round}`
                            : ""}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Status: {fixture.status}
                          {fixture.disabledReason
                            ? ` · ${fixture.disabledReason}`
                            : ""}
                        </span>
                        {outsideTimingWindow && timingWindowText ? (
                          <span className="mt-1 block text-xs font-semibold text-amber-200">
                            Outside usual gameweek window ({timingWindowText})
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {hasTimingWarnings && timingWindowText ? (
            <label className="flex gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
              <input
                type="checkbox"
                name="confirm_timing_override"
                value="1"
                className="mt-1 h-4 w-4 accent-amber-300"
              />
              <span>
                This match is outside the usual gameweek window (
                {timingWindowText}). Add it anyway?
              </span>
            </label>
          ) : null}

          <SubmitButton
            idleLabel="Add selected fixtures"
            pendingLabel="Adding fixtures..."
            className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
          />
        </form>
      )}
    </div>
  );
}
