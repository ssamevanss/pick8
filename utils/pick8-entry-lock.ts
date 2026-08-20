export const PICK8_MATCHDAY_LOCKED_MESSAGE =
  "This Matchday has now locked at the first fixture kickoff. No entry changes were saved.";

export type Pick8EntryWriteGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export async function runPick8EntryWriteWhileOpen<T>({
  matchdayStatus,
  firstKickoff,
  now = Date.now(),
  write,
}: {
  matchdayStatus: string;
  firstKickoff: string | null;
  now?: number;
  write: () => Promise<T>;
}): Promise<Pick8EntryWriteGuardResult<T>> {
  const deadline = firstKickoff ? Date.parse(firstKickoff) : Number.NaN;
  if (
    matchdayStatus === "completed" ||
    !Number.isFinite(deadline) ||
    now >= deadline
  ) {
    return { ok: false, message: PICK8_MATCHDAY_LOCKED_MESSAGE };
  }

  return { ok: true, value: await write() };
}
