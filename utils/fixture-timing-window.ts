import { formatInTimeZone } from "date-fns-tz";

export type FixtureTimingWindow = {
  start: string;
  end: string;
  warningStart: string;
  warningEnd: string;
  source: "selected-fixtures" | "base-competition";
};

const warningBufferMs = 12 * 60 * 60 * 1000;

function getMinMaxKickoffs(kickoffValues: string[]) {
  const timestamps = kickoffValues
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) {
    return null;
  }

  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];

  return {
    start,
    end,
  };
}

export function buildFixtureTimingWindow({
  selectedFixtureKickoffs,
  baseCompetitionKickoffs,
}: {
  selectedFixtureKickoffs: string[];
  baseCompetitionKickoffs: string[];
}): FixtureTimingWindow | null {
  const selectedWindow = getMinMaxKickoffs(selectedFixtureKickoffs);

  if (selectedWindow) {
    return {
      start: new Date(selectedWindow.start).toISOString(),
      end: new Date(selectedWindow.end).toISOString(),
      warningStart: new Date(selectedWindow.start - warningBufferMs).toISOString(),
      warningEnd: new Date(selectedWindow.end + warningBufferMs).toISOString(),
      source: "selected-fixtures",
    };
  }

  const baseWindow = getMinMaxKickoffs(baseCompetitionKickoffs);

  if (!baseWindow) {
    return null;
  }

  return {
    start: new Date(baseWindow.start).toISOString(),
    end: new Date(baseWindow.end).toISOString(),
    warningStart: new Date(baseWindow.start - warningBufferMs).toISOString(),
    warningEnd: new Date(baseWindow.end + warningBufferMs).toISOString(),
    source: "base-competition",
  };
}

export function isKickoffOutsideTimingWindow({
  kickoffAt,
  timingWindow,
}: {
  kickoffAt: string;
  timingWindow: FixtureTimingWindow | null;
}) {
  if (!timingWindow) {
    return false;
  }

  const kickoffTime = new Date(kickoffAt).getTime();

  return (
    kickoffTime < new Date(timingWindow.warningStart).getTime() ||
    kickoffTime > new Date(timingWindow.warningEnd).getTime()
  );
}

export function formatTimingWindow(timingWindow: FixtureTimingWindow) {
  const start = formatInTimeZone(
    timingWindow.start,
    "Europe/London",
    "EEE d MMM HH:mm",
  );
  const end = formatInTimeZone(
    timingWindow.end,
    "Europe/London",
    "EEE d MMM HH:mm",
  );

  return `${start} to ${end}`;
}
