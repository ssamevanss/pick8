"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { savePickEntry, type PickEntryActionState } from "@/app/(app)/my-picks/actions";
import CategorySelect from "@/components/picks/CategorySelect";
import SubmittedPick8Summary from "@/components/picks/SubmittedPick8Summary";
import TeamIdentity from "@/components/picks/TeamIdentity";
import {
  formatPick8Kickoff,
  getFixtureLifecycle,
  fixtureLifecycleLabel,
  isFixtureSelectionEditable,
} from "@/utils/pick8-fixture-state";
import {
  buildPick8EditorSnapshot,
  copyPick8EditorSnapshot,
} from "@/utils/pick8-entry-validation";
import { PICK8_MATCHDAY_LOCKED_MESSAGE } from "@/utils/pick8-entry-lock";
import type { Pick8Category } from "@/utils/pick8-entry-validation";

export type PickFixture = { id: string; homeTeamName: string; awayTeamName: string; homeTeamCrestUrl: string | null; awayTeamCrestUrl: string | null; kickoffAt: string; status: string; homeScore: number | null; awayScore: number | null };
type Category = Pick8Category;
type TeamSide = "home" | "away" | "";
type FixtureChoice = { category: Category | ""; side: TeamSide };
type InitialSelection = { category: string; fixtureId: string; selectedTeamSide: string | null; pointsAwarded: number | null };

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
  if (remaining <= 0) return "Initial submissions closed";
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes % 60}m`].filter(Boolean).join(" ");
}

function submittedTime(value: string | null) {
  if (!value) return null;
  const submittedAt = new Date(value);
  if (Number.isNaN(submittedAt.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
    timeZoneName: "short",
  }).format(submittedAt);
}

export default function MatchdayEntryForm({ matchdayId, reloadHref, locksAt, fixtures, initialSelections, initialTotalGoals, initiallyEditable, initiallySubmitted, initiallySubmittedAt, initiallyHasEntry, actualGoals, finalReady, finalMatchdayScore, totalGoalsPoints, fixtureSlate }: {
  matchdayId: string;
  reloadHref: string;
  locksAt: string;
  fixtures: PickFixture[];
  initialSelections: InitialSelection[];
  initialTotalGoals: number | null;
  initiallyEditable: boolean;
  initiallySubmitted: boolean;
  initiallySubmittedAt: string | null;
  initiallyHasEntry: boolean;
  actualGoals: number | null;
  finalReady: boolean;
  finalMatchdayScore: number | null;
  totalGoalsPoints: number | null;
  fixtureSlate?: ReactNode;
}) {
  const incomingPersistedState = useMemo(
    () => ({
      snapshot: buildPick8EditorSnapshot(fixtures.map((fixture) => fixture.id), initialSelections, initialTotalGoals),
      submitted: initiallySubmitted,
      submittedAt: initiallySubmittedAt,
      hasEntry: initiallyHasEntry,
    }),
    [fixtures, initialSelections, initialTotalGoals, initiallySubmitted, initiallySubmittedAt, initiallyHasEntry],
  );
  const [choices, setChoices] = useState<Record<string, FixtureChoice>>(() => copyPick8EditorSnapshot(incomingPersistedState.snapshot).choices as Record<string, FixtureChoice>);
  const [savedChoices, setSavedChoices] = useState<Record<string, FixtureChoice>>(() => copyPick8EditorSnapshot(incomingPersistedState.snapshot).choices as Record<string, FixtureChoice>);
  const [totalGoals, setTotalGoals] = useState(incomingPersistedState.snapshot.totalGoals);
  const [savedTotalGoals, setSavedTotalGoals] = useState(incomingPersistedState.snapshot.totalGoals);
  const [submitted, setSubmitted] = useState(initiallySubmitted);
  const [submittedAt, setSubmittedAt] = useState(initiallySubmittedAt);
  const [editing, setEditing] = useState(!initiallySubmitted);
  const [hasSavedEntry, setHasSavedEntry] = useState(initiallyHasEntry);
  const [now, setNow] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (previousState: PickEntryActionState, formData: FormData) => {
      const result = await savePickEntry(previousState, formData);
      if (result.ok) {
        setSavedChoices(choices);
        setSavedTotalGoals(totalGoals);
        setHasSavedEntry(true);
        setSubmitted(result.intent !== "draft");
        setSubmittedAt(result.submittedAt ?? null);
        if (result.intent !== "draft") setEditing(false);
      } else if (result.message === PICK8_MATCHDAY_LOCKED_MESSAGE && submitted) {
        const restored = copyPick8EditorSnapshot({
          choices: savedChoices,
          totalGoals: savedTotalGoals,
        });
        setChoices(restored.choices as Record<string, FixtureChoice>);
        setTotalGoals(restored.totalGoals);
        setEditing(false);
      }
      return result;
    },
    initialActionState,
  );
  const [appliedPersistedState, setAppliedPersistedState] = useState(incomingPersistedState);
  if (appliedPersistedState !== incomingPersistedState) {
    const refreshed = copyPick8EditorSnapshot(incomingPersistedState.snapshot);
    setAppliedPersistedState(incomingPersistedState);
    setChoices(refreshed.choices as Record<string, FixtureChoice>);
    setSavedChoices(copyPick8EditorSnapshot(incomingPersistedState.snapshot).choices as Record<string, FixtureChoice>);
    setTotalGoals(refreshed.totalGoals);
    setSavedTotalGoals(refreshed.totalGoals);
    setSubmitted(incomingPersistedState.submitted);
    setSubmittedAt(incomingPersistedState.submittedAt);
    setHasSavedEntry(incomingPersistedState.hasEntry);
    setEditing(!incomingPersistedState.submitted);
  }
  const eligibleFixtures = useMemo(() => fixtures, [fixtures]);
  const entryWindowOpen = now > 0 && now < new Date(locksAt).getTime();
  const outcomeUnknown = state.outcome === "unknown";
  const editable = initiallyEditable && entryWindowOpen && (!submitted || editing) && !outcomeUnknown;

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, []);

  function enterEditMode() {
    const restored = copyPick8EditorSnapshot({ choices: savedChoices, totalGoals: savedTotalGoals });
    setChoices(restored.choices as Record<string, FixtureChoice>);
    setTotalGoals(restored.totalGoals);
    setEditing(true);
  }

  function cancelEditing() {
    const restored = copyPick8EditorSnapshot({ choices: savedChoices, totalGoals: savedTotalGoals });
    setChoices(restored.choices as Record<string, FixtureChoice>);
    setTotalGoals(restored.totalGoals);
    setEditing(false);
  }

  const counts = new Map<Category, number>();
  for (const fixture of eligibleFixtures) {
    const category = choices[fixture.id]?.category;
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const duplicates = CATEGORIES.filter((category) => (counts.get(category.key) ?? 0) > 1);
  const duplicateKeys = new Set(duplicates.map((category) => category.key));
  const missing = CATEGORIES.filter((category) => !counts.has(category.key));
  const missingTeams = eligibleFixtures.flatMap((fixture) => {
    const choice = choices[fixture.id];
    const category = choice?.category ? CATEGORY_BY_KEY.get(choice.category) : undefined;
    return category?.needsTeam && !choice.side ? [category.label] : [];
  });
  const completedFixtureCount = CATEGORIES.filter((category) => {
    if ((counts.get(category.key) ?? 0) !== 1) return false;
    if (!category.needsTeam) return true;
    return eligibleFixtures.some((fixture) => choices[fixture.id]?.category === category.key && choices[fixture.id]?.side !== "");
  }).length;
  const parsedTotalGoals = Number(totalGoals);
  const totalGoalsComplete = totalGoals !== "" && Number.isInteger(parsedTotalGoals) && parsedTotalGoals >= 0 && parsedTotalGoals <= 100;
  const completedCount = completedFixtureCount + (totalGoalsComplete ? 1 : 0);
  const complete = completedCount === 8 && !duplicates.length;
  const topStatus = submitted
    ? "Submitted ✓"
    : complete
      ? "Ready to submit"
      : hasSavedEntry
        ? "Draft — Not submitted"
        : "Not started";
  const topStatusDetail = submitted && submittedAt
    ? `Submitted ${submittedTime(submittedAt)}`
    : `${completedCount} of 8 selections completed · ${hasSavedEntry ? "Draft — Not submitted" : "Entry has not been submitted"}`;

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

  const selectedChoices = fixtures.flatMap((fixture) => {
    const choice = choices[fixture.id];
    const category = choice?.category ? CATEGORY_BY_KEY.get(choice.category) : null;
    if (!choice?.category || !category) return [];
    const persistedSelection = initialSelections.find((selection) => selection.fixtureId === fixture.id && selection.category === category.key);
    return [{ category: category.key, fixtureId: fixture.id, selectedTeamSide: choice.side || null, pointsAwarded: persistedSelection?.pointsAwarded ?? null }];
  });

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="matchday_id" value={matchdayId} />
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${submitted ? "border-emerald-300/40 bg-emerald-300/15" : complete ? "border-emerald-300/30 bg-emerald-300/10" : hasSavedEntry ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/5"}`}>
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{now > 0 && !entryWindowOpen ? "Matchday in progress" : "Time remaining"}</p><p className="mt-1 text-xl font-black text-white">{now ? remainingLabel(locksAt, now) : "Calculating…"}</p></div>
        <div className="text-right"><p className={`text-lg font-black ${submitted || complete ? "text-emerald-200" : hasSavedEntry ? "text-amber-100" : "text-white"}`}>{topStatus}</p><p className="mt-1 text-sm text-slate-300">{topStatusDetail}</p></div>
      </div>
      {now > 0 && !submitted && !entryWindowOpen ? <p className="brand-alert-warning">The submission deadline has passed. This entry is read-only.</p> : null}
      {state.message ? <p className={state.ok ? "brand-alert-success" : outcomeUnknown ? "brand-alert-warning" : "brand-alert-danger"} role="status" aria-live="polite">{state.message}</p> : null}
      {outcomeUnknown ? <a className="brand-button-primary block w-full text-center" href={reloadHref}>Reload saved entry</a> : null}

      {submitted && !editing ? (
        <div className="space-y-5 sm:space-y-6">
          <SubmittedPick8Summary
            fixtures={fixtures}
            selections={selectedChoices}
            totalGoals={totalGoals}
            actualGoals={actualGoals}
            finalReady={finalReady}
            finalMatchdayScore={finalMatchdayScore}
            totalGoalsPoints={totalGoalsPoints}
            now={now}
            action={entryWindowOpen && initiallyEditable ? <button type="button" className="brand-button-primary w-full sm:w-auto" onClick={enterEditMode}>Edit submission</button> : <span className="brand-pill">Matchday locked</span>}
          />
          {fixtureSlate}
        </div>
      ) : <>
      <section className="brand-card">
        <div className="border-b border-white/10 px-4 py-4 sm:px-5"><h2 className="text-xl font-black text-white">Choose your picks</h2><p className="mt-1 text-sm text-slate-400">Assign one prediction category to each fixture you want to use.</p></div>
        <div className="divide-y divide-white/10">
          {fixtures.map((fixture) => {
            const unavailable = ["cancelled", "postponed"].includes(fixture.status);
            const fixtureState = getFixtureLifecycle({ kickoff_at: fixture.kickoffAt, status: fixture.status }, now || 0);
            const fixtureEditable = editable && now > 0 && isFixtureSelectionEditable({ kickoff_at: fixture.kickoffAt, status: fixture.status }, now);
            const choice = choices[fixture.id] ?? { category: "", side: "" };
            const category = choice.category ? CATEGORY_BY_KEY.get(choice.category) : undefined;
            const duplicated = Boolean(choice.category && duplicateKeys.has(choice.category));
            const fixtureComplete = Boolean(choice.category && !duplicated && (!category?.needsTeam || choice.side));
            return (
              <div key={fixture.id} className={`grid gap-3 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(11rem,14rem)_minmax(9rem,12rem)] sm:items-center sm:px-5 ${duplicated ? "bg-red-500/10 ring-1 ring-inset ring-red-400/50" : fixtureComplete ? "bg-emerald-400/[0.04]" : ""}`}>
                <input type="hidden" name={`fixture_category_${fixture.id}`} value={choice.category} />
                <input type="hidden" name={`fixture_side_${fixture.id}`} value={choice.side} />
                <div className="flex items-center justify-between gap-2 text-xs sm:block"><span className="font-semibold text-slate-300">{formatPick8Kickoff(fixture.kickoffAt)}</span><span className={`sm:mt-1 sm:block ${unavailable ? "text-amber-300" : fixtureState === "live" ? "text-emerald-300" : "text-slate-500"}`}>{fixtureLifecycleLabel(fixtureState)}{!fixtureEditable && choice.category && !unavailable ? " · pick locked" : ""}</span></div>
                <div className="grid min-w-0 gap-1.5">
                  <TeamIdentity name={fixture.homeTeamName} crestUrl={fixture.homeTeamCrestUrl} />
                  <TeamIdentity name={fixture.awayTeamName} crestUrl={fixture.awayTeamCrestUrl} />
                </div>
                <CategorySelect
                  value={choice.category}
                  disabled={!fixtureEditable || pending || unavailable}
                  invalid={duplicated}
                  ariaLabel={`Category for ${fixture.homeTeamName} v ${fixture.awayTeamName}`}
                  options={CATEGORIES.map((item) => ({
                    key: item.key,
                    label: item.label,
                    muted: item.key !== choice.category && (counts.get(item.key) ?? 0) > 0,
                  }))}
                  onChange={(value) => changeCategory(fixture.id, value)}
                />
                {category?.needsTeam ? (
                  <label><span className="sr-only">Team for {category.label}</span><select value={choice.side} disabled={!fixtureEditable || pending} className="brand-input mt-0" onChange={(event) => setChoices((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], side: event.target.value as TeamSide } }))}><option value="">Choose team</option><option value="home">{fixture.homeTeamName}</option><option value="away">{fixture.awayTeamName}</option></select></label>
                ) : null}
              </div>
            );
          })}
          {!fixtures.length ? <p className="p-5 text-sm text-slate-400">No fixtures have been synced for this matchday.</p> : null}
          <div className={`p-4 text-center sm:p-5 ${totalGoalsComplete ? "bg-emerald-400/[0.07]" : "bg-white/[0.02]"}`}>
            <input type="hidden" name="total_goals" value={totalGoals} />
            <div className="min-w-0" id="total-goals-description">
              <h3 className={`text-lg font-black ${totalGoalsComplete ? "text-emerald-200" : "text-white"}`}>8. Total Goals Across All Matches</h3>
            </div>
            <label className="mx-auto mt-4 block min-w-0 max-w-48">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400">Your prediction</span>
              <input
                className={`brand-input mt-0 h-14 min-w-0 max-w-full text-center text-2xl font-black ${totalGoalsComplete ? "border-emerald-400/50 bg-emerald-400/10 text-white" : "border-white/20"}`}
                type="number"
                min="0"
                max="100"
                step="1"
                inputMode="numeric"
                value={totalGoals}
                disabled={!editable || pending || !entryWindowOpen}
                aria-required="true"
                aria-describedby="total-goals-description"
                onChange={(event) => setTotalGoals(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <div className={`rounded-xl border p-4 text-sm ${duplicates.length ? "border-red-400/40 bg-red-500/10 text-red-100" : complete ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
        {complete ? <p><strong>Ready to submit.</strong> 8 of 8 selections completed.</p> : <><p>{completedCount} of 8 selections completed.</p><p className="mt-1">Missing: {[...missing.map((item) => item.label), ...missingTeams.map((label) => `${label} team`), ...(!totalGoalsComplete ? ["Total Goals"] : [])].join(", ") || "Resolve the duplicate categories below"}.</p>{duplicates.map((item) => <p key={item.key} className="mt-1 font-semibold">{item.label} is selected more than once.</p>)}</>}
      </div>

      {editable ? submitted ? (
        <div className="grid w-full gap-3 sm:grid-cols-2"><button className="brand-button-primary w-full" type="submit" name="intent" value="save_changes" disabled={pending || !complete}>{pending ? "Saving…" : "Save edited submission"}</button><button className="brand-button-secondary w-full" type="button" disabled={pending} onClick={cancelEditing}>Cancel editing</button></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2"><button className="brand-button-secondary" type="submit" name="intent" value="draft" disabled={pending}>{pending ? "Saving…" : "Save Draft"}</button><button className="brand-button-primary" type="submit" name="intent" value="submit" disabled={pending || !complete}>{pending ? "Submitting…" : "Submit Picks"}</button></div>
      ) : null}
      </>}
    </form>
  );
}
