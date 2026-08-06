"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { savePickEntry, type PickEntryActionState } from "@/app/(app)/my-picks/actions";
import TeamIdentity from "@/components/picks/TeamIdentity";

export type PickFixture = { id: string; homeTeamName: string; awayTeamName: string; homeTeamCrestUrl: string | null; awayTeamCrestUrl: string | null; kickoffAt: string; status: string };
type Category = "home_win" | "away_win" | "draw" | "team_win" | "team_lose" | "team_score" | "clean_sheet";
type TeamSide = "home" | "away" | "";
type FixtureChoice = { category: Category | ""; side: TeamSide };
type InitialSelection = { category: string; fixtureId: string; selectedTeamSide: string | null };

const CATEGORIES: Array<{ key: Category; label: string; needsTeam: boolean }> = [
  { key: "home_win", label: "Home Winner", needsTeam: false },
  { key: "away_win", label: "Away Winner", needsTeam: false },
  { key: "draw", label: "Draw", needsTeam: false },
  { key: "team_win", label: "Team to Win", needsTeam: true },
  { key: "team_lose", label: "Team to Lose", needsTeam: true },
  { key: "team_score", label: "Team to Score", needsTeam: true },
  { key: "clean_sheet", label: "Clean Sheet", needsTeam: true },
];
const CATEGORY_BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));
const initialActionState: PickEntryActionState = { ok: false, message: "" };

function remainingLabel(locksAt: string, now: number) {
  const remaining = new Date(locksAt).getTime() - now;
  if (remaining <= 0) return "Locked";
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes % 60}m`].filter(Boolean).join(" ");
}

function fixtureTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).format(new Date(value));
}

export default function MatchdayEntryForm({ matchdayId, locksAt, fixtures, initialSelections, initialTotalGoals, initiallyEditable, initiallySubmitted, initiallyHasEntry }: {
  matchdayId: string;
  locksAt: string;
  fixtures: PickFixture[];
  initialSelections: InitialSelection[];
  initialTotalGoals: number | null;
  initiallyEditable: boolean;
  initiallySubmitted: boolean;
  initiallyHasEntry: boolean;
}) {
  const [choices, setChoices] = useState<Record<string, FixtureChoice>>(() => Object.fromEntries(fixtures.map((fixture) => {
    const saved = initialSelections.find((item) => item.fixtureId === fixture.id);
    const category = CATEGORY_BY_KEY.has(saved?.category as Category) ? saved?.category as Category : "";
    const side = saved?.selectedTeamSide === "home" || saved?.selectedTeamSide === "away" ? saved.selectedTeamSide : "";
    return [fixture.id, { category, side }];
  })));
  const [totalGoals, setTotalGoals] = useState(initialTotalGoals === null ? "" : String(initialTotalGoals));
  const [submitted, setSubmitted] = useState(initiallySubmitted);
  const [hasSavedEntry, setHasSavedEntry] = useState(initiallyHasEntry);
  const [now, setNow] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (previousState: PickEntryActionState, formData: FormData) => {
      const result = await savePickEntry(previousState, formData);
      if (result.ok) {
        setHasSavedEntry(true);
        setSubmitted(result.intent !== "draft");
      }
      return result;
    },
    initialActionState,
  );
  const eligibleFixtures = useMemo(() => fixtures.filter((fixture) => !["cancelled", "postponed"].includes(fixture.status)), [fixtures]);
  const editable = initiallyEditable && now > 0 && now < new Date(locksAt).getTime();

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, []);

  const counts = new Map<Category, number>();
  for (const fixture of eligibleFixtures) {
    const category = choices[fixture.id]?.category;
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const duplicates = CATEGORIES.filter((category) => (counts.get(category.key) ?? 0) > 1);
  const duplicateKeys = new Set(duplicates.map((category) => category.key));
  const selectedCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const requiredCount = Math.min(7, eligibleFixtures.length);
  const missing = eligibleFixtures.length >= 7 ? CATEGORIES.filter((category) => !counts.has(category.key)) : [];
  const missingTeamCount = eligibleFixtures.filter((fixture) => {
    const choice = choices[fixture.id];
    return Boolean(choice?.category && CATEGORY_BY_KEY.get(choice.category)?.needsTeam && !choice.side);
  }).length;
  const complete = selectedCount === requiredCount && !duplicates.length && !missing.length && !missingTeamCount && totalGoals !== "";

  function changeCategory(fixtureId: string, category: Category | "") {
    setChoices((current) => {
      const previous = current[fixtureId] ?? { category: "", side: "" };
      let side: TeamSide = "";
      if (category === "home_win") side = "home";
      else if (category === "away_win") side = "away";
      else if (category && CATEGORY_BY_KEY.get(category)?.needsTeam) side = previous.side || "";
      return { ...current, [fixtureId]: { category, side } };
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="matchday_id" value={matchdayId} />
      <div className="brand-card-soft flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Time remaining</p><p className="mt-1 text-xl font-black text-white">{now ? remainingLabel(locksAt, now) : "Calculating…"}</p></div>
        <div className="text-right"><span className="brand-pill">{submitted ? "Submitted" : hasSavedEntry ? "Draft" : "Not started"}</span><p className="mt-2 text-sm text-slate-300">{selectedCount} of {requiredCount} fixture picks selected</p></div>
      </div>
      {now > 0 && !editable ? <p className="brand-alert-warning">This matchday is locked. Your picks are read-only.</p> : null}
      {state.message ? <p className={state.ok ? "brand-alert-success" : "brand-alert-danger"} role="status" aria-live="polite">{state.message}</p> : null}

      <section className="brand-card overflow-hidden">
        <div className="border-b border-white/10 px-4 py-4 sm:px-5"><h2 className="text-xl font-black text-white">Choose your picks</h2><p className="mt-1 text-sm text-slate-400">Assign one prediction category to each fixture you want to use.</p></div>
        <div className="divide-y divide-white/10">
          {fixtures.map((fixture) => {
            const unavailable = ["cancelled", "postponed"].includes(fixture.status);
            const choice = choices[fixture.id] ?? { category: "", side: "" };
            const category = choice.category ? CATEGORY_BY_KEY.get(choice.category) : undefined;
            const duplicated = Boolean(choice.category && duplicateKeys.has(choice.category));
            return (
              <div key={fixture.id} className={`grid gap-3 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(11rem,14rem)_minmax(9rem,12rem)] sm:items-center sm:px-5 ${duplicated ? "bg-red-500/10 ring-1 ring-inset ring-red-400/50" : ""}`}>
                <div className="flex items-center justify-between gap-2 text-xs sm:block"><span className="font-semibold text-slate-300">{fixtureTime(fixture.kickoffAt)}</span><span className={`capitalize sm:mt-1 sm:block ${unavailable ? "text-amber-300" : "text-slate-500"}`}>{fixture.status.replaceAll("_", " ")}{unavailable ? " · unavailable" : ""}</span></div>
                <div className="grid min-w-0 gap-1.5">
                  <TeamIdentity name={fixture.homeTeamName} crestUrl={fixture.homeTeamCrestUrl} />
                  <TeamIdentity name={fixture.awayTeamName} crestUrl={fixture.awayTeamCrestUrl} />
                </div>
                <label><span className="sr-only">Category for {fixture.homeTeamName} v {fixture.awayTeamName}</span><select name={`fixture_category_${fixture.id}`} value={choice.category} disabled={!editable || pending || unavailable} aria-invalid={duplicated} className={`brand-input mt-0 ${duplicated ? "border-red-400/80 bg-red-950/40" : ""}`} onChange={(event) => changeCategory(fixture.id, event.target.value as Category | "")}><option value="">Not selected</option>{CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
                {category?.needsTeam ? (
                  <label><span className="sr-only">Team for {category.label}</span><select name={`fixture_side_${fixture.id}`} value={choice.side} disabled={!editable || pending} className="brand-input mt-0" onChange={(event) => setChoices((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], side: event.target.value as TeamSide } }))}><option value="">Choose team</option><option value="home">{fixture.homeTeamName}</option><option value="away">{fixture.awayTeamName}</option></select></label>
                ) : <input type="hidden" name={`fixture_side_${fixture.id}`} value={choice.side} />}
              </div>
            );
          })}
          {!fixtures.length ? <p className="p-5 text-sm text-slate-400">No fixtures have been synced for this matchday.</p> : null}
        </div>
      </section>

      <div className={`rounded-xl border p-4 text-sm ${duplicates.length ? "border-red-400/40 bg-red-500/10 text-red-100" : complete ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
        {duplicates.length ? <p>Duplicate {duplicates.length === 1 ? "category" : "categories"}: {duplicates.map((item) => item.label).join(", ")}.</p> : complete ? <p>Entry complete and ready to {submitted ? "update" : "submit"}.</p> : <p>{selectedCount}/{requiredCount} fixture picks selected{missing.length ? ` · Missing: ${missing.map((item) => item.label).join(", ")}` : ""}{missingTeamCount ? ` · Choose ${missingTeamCount} team${missingTeamCount === 1 ? "" : "s"}` : ""}{totalGoals === "" ? " · Total Goals required" : ""}</p>}
      </div>

      <label className="block text-sm text-slate-200"><span className="font-bold text-white">Total Goals</span><span className="ml-2 text-xs text-slate-400">Across every matchday fixture</span><input className="brand-input max-w-48" type="number" name="total_goals" min="0" max="100" step="1" value={totalGoals} disabled={!editable || pending} onChange={(event) => setTotalGoals(event.target.value)} /></label>

      {editable ? submitted ? (
        <button className="brand-button-primary w-full sm:w-auto" type="submit" name="intent" value="save_changes" disabled={pending || duplicates.length > 0}>{pending ? "Saving…" : "Save Changes"}</button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2"><button className="brand-button-secondary" type="submit" name="intent" value="draft" disabled={pending}>{pending ? "Saving…" : "Save Draft"}</button><button className="brand-button-primary" type="submit" name="intent" value="submit" disabled={pending || duplicates.length > 0}>{pending ? "Submitting…" : "Submit Picks"}</button></div>
      ) : null}
    </form>
  );
}
