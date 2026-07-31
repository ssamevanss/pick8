import Link from "next/link";
import { createLeague } from "../actions";
import { footballDataCompetitionOptions } from "@/utils/football-competitions";
import SubmitButton from "@/components/forms/SubmitButton";

const supportedCompetitionCodes = new Set(["PL", "PD", "SA", "BL1", "FL1"]);

export default async function CreateLeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center justify-center py-2 text-white sm:py-6">
      <div className="brand-card w-full p-5 sm:p-7">
        <p className="brand-eyebrow">New private league</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
          Create league
        </h1>
        <p className="brand-subtitle mt-2">
          Create a private league for your group. Your league can continue
          across seasons; this form sets up the first season and chooses where
          its fixtures come from.
        </p>
        {error ? <p className="brand-alert-danger mt-4">{error}</p> : null}
        <form action={createLeague} className="mt-6 space-y-5">
          <input
            type="hidden"
            name="creation_key"
            value={crypto.randomUUID()}
          />
          <label className="block">
            <span className="text-sm font-semibold text-slate-200">
              League name
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">
              This is your long-running group. You can use the same league
              across future seasons.
            </span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              placeholder="e.g. Friday Football Picks"
              className="brand-input mt-2"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-200">
              Current season name
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">
              This is the first season inside your league.
            </span>
            <input
              name="initial_season_name"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Premier League 2026/27"
              className="brand-input mt-2"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-200">
              Base competition
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">
              Used to create the season’s gameweeks and fixture schedule.
            </span>
            <select
              name="base_competition_code"
              required
              defaultValue=""
              className="brand-input mt-2"
            >
              <option value="" disabled>
                Choose a competition
              </option>
              {footballDataCompetitionOptions
                .filter((competition) =>
                  supportedCompetitionCodes.has(
                    competition.external_competition_code,
                  ),
                )
                .map((competition) => (
                  <option
                    key={competition.external_competition_code}
                    value={competition.external_competition_code}
                  >
                    {competition.name}
                  </option>
                ))}
            </select>
          </label>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
            <SubmitButton
              idleLabel="Create league"
              pendingLabel="Creating..."
              className="brand-button-primary w-full sm:w-auto sm:min-w-40"
            />
            <Link
              href="/leagues"
              className="brand-button-secondary w-full sm:w-auto sm:min-w-40"
            >
              Back to League Hub
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
