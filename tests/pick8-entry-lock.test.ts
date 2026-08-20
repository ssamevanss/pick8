import test from "node:test";
import assert from "node:assert/strict";
import {
  PICK8_MATCHDAY_LOCKED_MESSAGE,
  runPick8EntryWriteWhileOpen,
} from "../utils/pick8-entry-lock.ts";

const firstKickoff = "2026-08-22T05:00:00.000Z"; // Saturday 3:00pm Melbourne
const beforeKickoff = Date.parse("2026-08-22T04:59:00.000Z");
const afterKickoff = Date.parse("2026-08-22T05:02:00.000Z");

test("edit opened before kickoff and saved before kickoff is allowed", async () => {
  const editOpenedAt = Date.parse("2026-08-22T04:55:00.000Z");
  let selections = ["original"];

  assert.ok(editOpenedAt < Date.parse(firstKickoff));
  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "open",
    firstKickoff,
    now: beforeKickoff,
    write: async () => {
      selections = ["edited"];
      return selections;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(selections, ["edited"]);
});

test("edit opened before kickoff but saved after kickoff is rejected", async () => {
  const editOpenedAt = Date.parse("2026-08-22T04:55:00.000Z");
  let writeCalled = false;

  assert.ok(editOpenedAt < Date.parse(firstKickoff));
  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "open",
    firstKickoff,
    now: afterKickoff,
    write: async () => {
      writeCalled = true;
    },
  });

  assert.deepEqual(result, { ok: false, message: PICK8_MATCHDAY_LOCKED_MESSAGE });
  assert.equal(writeCalled, false);
});

test("direct server write invocation after first kickoff is rejected", async () => {
  let databaseRpcCalled = false;
  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "scoring",
    firstKickoff,
    now: afterKickoff,
    write: async () => {
      databaseRpcCalled = true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(databaseRpcCalled, false);
});

test("existing submitted entry remains unchanged after a rejected late edit", async () => {
  const persistedEntry = {
    totalGoals: 25,
    selections: ["home_win:fixture-1", "draw:fixture-2"],
    submittedAt: "2026-08-22T04:30:00.000Z",
  };
  const beforeAttempt = structuredClone(persistedEntry);

  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "open",
    firstKickoff,
    now: afterKickoff,
    write: async () => {
      persistedEntry.totalGoals = 30;
      persistedEntry.selections = ["away_win:fixture-3"];
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(persistedEntry, beforeAttempt);
});

test("new entry attempted after first kickoff is rejected", async () => {
  let persistedEntry: { submittedAt: string } | null = null;
  const result = await runPick8EntryWriteWhileOpen({
    matchdayStatus: "open",
    firstKickoff,
    now: afterKickoff,
    write: async () => {
      persistedEntry = { submittedAt: new Date(afterKickoff).toISOString() };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(persistedEntry, null);
});
