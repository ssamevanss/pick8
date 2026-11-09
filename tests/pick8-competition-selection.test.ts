import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompetitionStandings,
  competitionSelectionOptions,
  competitionSelectionQuery,
  isCompetitionFinal,
  resolveCurrentCompetition,
  resolveSelectedCompetition,
  type StandingsCompetition,
  type StandingsEntry,
  type StandingsMatchday,
} from "../utils/pick8-standings.ts";

const RANGES = [[1, 5], [6, 10], [11, 15], [16, 20]] as const;
const competitions = (activeIndex: number): StandingsCompetition[] => RANGES.map(([start, end], index) => ({
  id: `comp-${index + 1}`,
  name: `Competition ${index + 1} · Matchdays ${start}–${end}`,
  start_matchday: start,
  end_matchday: end,
  status: index < activeIndex ? "completed" : index === activeIndex ? "active" : "upcoming",
}));
const matchdays: StandingsMatchday[] = Array.from({ length: 20 }, (_, index) => ({
  id: `md${index + 1}`, matchday_number: index + 1, status: index < 12 ? "completed" : "upcoming", locks_at: null,
}));
const entry = (user: string, matchday: number, score: number, submitted = true): StandingsEntry => ({
  id: `${user}-${matchday}`, user_id: user, matchday_id: `md${matchday}`, submitted_at: submitted ? "2026-08-01T00:00:00Z" : null, calculated_score: score,
});
const ids = (options: ReturnType<typeof competitionSelectionOptions>) => options.map((option) => option.competition.id);

test("options list the current competition and earlier ones, newest first, without future competitions", () => {
  const list = competitions(2);
  const current = resolveCurrentCompetition(list, matchdays[11]);
  const options = competitionSelectionOptions(list, current);
  assert.deepEqual(ids(options), ["comp-3", "comp-2", "comp-1"]);
  assert.deepEqual(options.map((option) => option.isCurrent), [true, false, false]);
});

test("the current competition is derived, not hardcoded: when competition 4 is current, 3 becomes historical", () => {
  const list = competitions(3);
  const options = competitionSelectionOptions(list, resolveCurrentCompetition(list, matchdays[15]));
  assert.deepEqual(ids(options), ["comp-4", "comp-3", "comp-2", "comp-1"]);
  assert.equal(options.find((option) => option.isCurrent)?.competition.id, "comp-4");
});

test("with no current competition only completed competitions are offered", () => {
  const list = competitions(0).map((competition, index) => ({ ...competition, status: index < 2 ? "completed" : "upcoming" }));
  assert.deepEqual(ids(competitionSelectionOptions(list, null)), ["comp-2", "comp-1"]);
});

test("the competition parameter defaults to current and rejects unknown, future or repeated ids", () => {
  const list = competitions(2);
  const options = competitionSelectionOptions(list, list[2]);
  assert.equal(resolveSelectedCompetition(options, undefined).selected?.competition.id, "comp-3");
  assert.deepEqual(
    { id: resolveSelectedCompetition(options, "comp-1").selected?.competition.id, invalid: resolveSelectedCompetition(options, "comp-1").invalidRequest },
    { id: "comp-1", invalid: false },
  );
  for (const bad of ["comp-4", "nope", "' or 1=1 --", ""]) {
    const result = resolveSelectedCompetition(options, bad);
    assert.equal(result.selected?.competition.id, "comp-3", bad);
    assert.equal(result.invalidRequest, bad !== "", bad);
  }
  assert.equal(resolveSelectedCompetition(options, ["comp-2", "comp-1"]).selected?.competition.id, "comp-2");
  assert.equal(resolveSelectedCompetition([], "comp-1").selected, null);
});

test("standings are isolated per competition even when handed every entry in the season", () => {
  const profiles = [{ id: "ann", display_name: "Ann" }, { id: "bob", display_name: "Bob" }];
  const allEntries = [
    entry("ann", 1, 40), entry("ann", 5, 10), entry("bob", 3, 30), // competition 1: ann 50, bob 30
    entry("ann", 6, -10), entry("bob", 7, 20), entry("bob", 10, 15), // competition 2: bob 35, ann -10
    entry("ann", 11, 25), entry("bob", 12, 5), entry("ann", 13, 7, false), // competition 3: ann 25 (draft ignored), bob 5
  ];
  const [one, two, three] = competitions(2).slice(0, 3);
  const summary = (competition: StandingsCompetition) => buildCompetitionStandings(profiles, allEntries, matchdays, competition)
    .map((row) => `${row.rank}:${row.profile.id}:${row.points}:${row.played}`);
  assert.deepEqual(summary(one), ["1:ann:50:2", "2:bob:30:1"]);
  assert.deepEqual(summary(two), ["1:bob:35:2", "2:ann:-10:1"]);
  assert.deepEqual(summary(three), ["1:ann:25:1", "2:bob:5:1"]);
});

test("a competition with matchdays absent or no entries yields empty progress, not another competition's scores", () => {
  const profiles = [{ id: "ann", display_name: "Ann" }];
  const rows = buildCompetitionStandings(profiles, [entry("ann", 1, 40)], matchdays, competitions(2)[2]);
  assert.deepEqual(rows.map((row) => [row.points, row.played]), [[0, 0]]);
  assert.equal(buildCompetitionStandings(profiles, [entry("ann", 1, 40)], [], competitions(2)[0]).at(0)?.points, 0);
});

test("a paused player stays in the competitions they played and stays out of ones they did not", () => {
  const paused = { id: "ann", display_name: "Ann", pick8_participation_active: false };
  const entries = [entry("ann", 2, 12)];
  const [one, two] = competitions(2);
  assert.equal(buildCompetitionStandings([paused], entries, matchdays, one).length, 1);
  assert.equal(buildCompetitionStandings([paused], entries, matchdays, two).length, 0);
});

test("selecting a competition keeps other query parameters and drops the parameter for the current one", () => {
  assert.equal(competitionSelectionQuery("view=competition", "comp-1", "comp-3"), "view=competition&competition=comp-1");
  assert.equal(competitionSelectionQuery("view=competition&competition=comp-1", "comp-2", "comp-3"), "view=competition&competition=comp-2");
  assert.equal(competitionSelectionQuery("view=competition&competition=comp-1", "comp-3", "comp-3"), "view=competition");
  assert.equal(competitionSelectionQuery("competition=comp-1", "comp-3", "comp-3"), "");
});

test("Final standings requires every matchday in range to exist and be completed, whatever the stored status says", () => {
  const [one, two] = competitions(2);
  assert.equal(isCompetitionFinal(one, matchdays), true);
  assert.equal(isCompetitionFinal(two, matchdays.map((md) => md.matchday_number === 8 ? { ...md, status: "scoring" } : md)), false);
  assert.equal(isCompetitionFinal(two, matchdays.filter((md) => md.matchday_number !== 9)), false);
  assert.equal(isCompetitionFinal(competitions(2)[2], matchdays), false);
  assert.equal(isCompetitionFinal({ ...one, status: "completed" } as StandingsCompetition, []), false);
});
