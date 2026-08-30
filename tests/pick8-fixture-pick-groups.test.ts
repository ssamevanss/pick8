import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPick8FixtureSelection,
  groupFixturePicks,
} from "../utils/pick8-selection-display.ts";

function pick({
  selectionId,
  playerId,
  playerName,
  category,
  selectedTeamSide = "home",
  displayedPoints,
}: {
  selectionId: string;
  playerId: string;
  playerName: string;
  category: string;
  selectedTeamSide?: string | null;
  displayedPoints: number | null;
}) {
  return {
    selectionId,
    playerId,
    playerName,
    category,
    selectedTeamSide,
    displayedPoints,
  };
}

test("fixture picks group players by underlying category and selected side", () => {
  const groups = groupFixturePicks([
    pick({ selectionId: "s1", playerId: "p1", playerName: "Zoe", category: "team_score", displayedPoints: 10 }),
    pick({ selectionId: "s2", playerId: "p2", playerName: "Adam", category: "team_score", displayedPoints: 10 }),
    pick({ selectionId: "s3", playerId: "p3", playerName: "beth", category: "team_score", displayedPoints: 10 }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].players.map(({ name }) => name), ["Adam", "beth", "Zoe"]);
  assert.equal(groups[0].displayedPoints, 10);
});

test("categories with similar display wording remain separate", () => {
  const groups = groupFixturePicks([
    pick({ selectionId: "home", playerId: "p1", playerName: "Aidan", category: "home_win", selectedTeamSide: "home", displayedPoints: 0 }),
    pick({ selectionId: "team", playerId: "p2", playerName: "Adam", category: "team_win", selectedTeamSide: "home", displayedPoints: -10 }),
  ]);

  assert.deepEqual(groups.map(({ category }) => category), ["home_win", "team_win"]);
  assert.deepEqual(groups.map((group) => formatPick8FixtureSelection(
    group.category,
    group.selectedTeamSide,
    { homeTeamName: "Liverpool FC", awayTeamName: "Nottingham Forest FC" },
  )), [
    "Home Winner — Liverpool FC",
    "Liverpool FC to Win — Team to Win",
  ]);
});

test("multiple correct categories sort before zero and negative groups", () => {
  const groups = groupFixturePicks([
    pick({ selectionId: "negative", playerId: "p1", playerName: "Negative", category: "team_win", displayedPoints: -10 }),
    pick({ selectionId: "zero", playerId: "p2", playerName: "Zero", category: "home_win", displayedPoints: 0 }),
    pick({ selectionId: "positive-ten", playerId: "p3", playerName: "Ten", category: "team_score", displayedPoints: 10 }),
    pick({ selectionId: "positive-fifteen", playerId: "p4", playerName: "Fifteen", category: "draw", selectedTeamSide: null, displayedPoints: 15 }),
    pick({ selectionId: "also-positive", playerId: "p5", playerName: "Clean", category: "clean_sheet", displayedPoints: 10 }),
  ]);

  assert.deepEqual(groups.map(({ category, displayedPoints }) => [category, displayedPoints]), [
    ["draw", 15],
    ["team_score", 10],
    ["clean_sheet", 10],
    ["home_win", 0],
    ["team_win", -10],
  ]);
});

test("the same category remains separate when a different team is selected", () => {
  const groups = groupFixturePicks([
    pick({ selectionId: "home", playerId: "p1", playerName: "Home", category: "team_score", selectedTeamSide: "home", displayedPoints: 10 }),
    pick({ selectionId: "away", playerId: "p2", playerName: "Away", category: "team_score", selectedTeamSide: "away", displayedPoints: -10 }),
  ]);

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].key, groups[1].key);
});
