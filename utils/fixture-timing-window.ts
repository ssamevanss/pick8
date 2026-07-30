export type FixtureTimingWindow = {
  start: string;
  end: string;
  warningStart: string;
  warningEnd: string;
  source: "selected-fixtures" | "base-competition" | "base-matchday-cycle";
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

export function buildLeagueFixtureTimingWindow({
  currentBaseGroup,
  nextBaseGroup,
}: {
  currentBaseGroup: FixtureGroupTiming | null;
  nextBaseGroup: FixtureGroupTiming | null;
}): FixtureTimingWindow | null {
  if (!currentBaseGroup) {
    return null;
  }

  const start = currentBaseGroup.firstKickoffAt;
  const end = nextBaseGroup
    ? new Date(
        new Date(nextBaseGroup.firstKickoffAt).getTime() -
          24 * 60 * 60 * 1000,
      ).toISOString()
    : currentBaseGroup.lastKickoffAt;

  return {
    start,
    end,
    warningStart: start,
    warningEnd: end,
    source: "base-matchday-cycle",
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
  const formatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = formatter.format(new Date(timingWindow.start));
  const end = formatter.format(new Date(timingWindow.end));

  return `${start} to ${end}`;
}

export type FixtureGroupTimingRow = {
  external_matchday: number | null;
  external_stage?: string | null;
  kickoff_at: string;
};

export type FixtureGroupTiming = {
  key: string;
  firstKickoffAt: string;
  lastKickoffAt: string;
};

function getFixtureGroupKey(fixture: FixtureGroupTimingRow) {
  if (fixture.external_matchday !== null) {
    return `matchday:${fixture.external_matchday}`;
  }

  if (fixture.external_stage) {
    return `stage:${fixture.external_stage}`;
  }

  return `date:${fixture.kickoff_at.slice(0, 10)}`;
}

export function buildFixtureGroupTimings(
  fixtures: FixtureGroupTimingRow[],
): FixtureGroupTiming[] {
  const groups = new Map<string, string[]>();

  for (const fixture of fixtures) {
    const key = getFixtureGroupKey(fixture);
    groups.set(key, [...(groups.get(key) ?? []), fixture.kickoff_at]);
  }

  return [...groups.entries()]
    .flatMap(([key, kickoffs]) => {
      const sortedKickoffs = kickoffs
        .map((kickoff) => new Date(kickoff).getTime())
        .filter((kickoff) => Number.isFinite(kickoff))
        .sort((a, b) => a - b);

      if (sortedKickoffs.length === 0) {
        return [];
      }

      return {
        key,
        firstKickoffAt: new Date(sortedKickoffs[0]).toISOString(),
        lastKickoffAt: new Date(
          sortedKickoffs[sortedKickoffs.length - 1],
        ).toISOString(),
      };
    })
    .sort(
      (a, b) =>
        new Date(a.firstKickoffAt).getTime() -
        new Date(b.firstKickoffAt).getTime(),
    );
}

export function getSpecialFixtureCutoff({
  baseGroups,
  currentGroupKey,
}: {
  baseGroups: FixtureGroupTiming[];
  currentGroupKey: string | null;
}) {
  if (baseGroups.length < 2) {
    return null;
  }

  const currentIndex = currentGroupKey
    ? baseGroups.findIndex((group) => group.key === currentGroupKey)
    : 0;
  const nextGroup = baseGroups[(currentIndex >= 0 ? currentIndex : 0) + 1];

  if (!nextGroup) {
    return null;
  }

  return new Date(
    new Date(nextGroup.firstKickoffAt).getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function isKickoffBeforeSpecialFixtureCutoff({
  kickoffAt,
  cutoff,
}: {
  kickoffAt: string;
  cutoff: string | null;
}) {
  if (!cutoff) {
    return true;
  }

  return new Date(kickoffAt).getTime() < new Date(cutoff).getTime();
}
