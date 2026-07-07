type ScoreSide = {
  home: number | null;
  away: number | null;
};

type PredictionScoringScore = ScoreSide & {
  source: "regularTime" | "fullTime" | "unavailable";
  duration: string | null;
  warning: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readScoreSide(value: unknown): ScoreSide {
  const record = asRecord(value);

  return {
    home: asNumber(record?.home),
    away: asNumber(record?.away),
  };
}

function hasCompleteScore(score: ScoreSide) {
  return score.home !== null && score.away !== null;
}

export function getProviderScoreObject(rawPayload: unknown) {
  const match = asRecord(rawPayload);

  return asRecord(match?.score);
}

export function getPredictionScoringScoreFromProviderScore(
  providerScore: unknown,
): PredictionScoringScore {
  const score = asRecord(providerScore);
  const duration =
    typeof score?.duration === "string" ? score.duration : null;
  const regularTime = readScoreSide(score?.regularTime);
  const fullTime = readScoreSide(score?.fullTime);

  // Score prediction games use the 90-minute result. In football-data.org
  // knockout payloads, `fullTime` can include extra-time goals while
  // `regularTime` is the normal-time score.
  if (hasCompleteScore(regularTime)) {
    return {
      ...regularTime,
      source: "regularTime",
      duration,
      warning: null,
    };
  }

  if (duration === "REGULAR" && hasCompleteScore(fullTime)) {
    return {
      ...fullTime,
      source: "fullTime",
      duration,
      warning: null,
    };
  }

  if ((duration === null || duration === "REGULAR") && hasCompleteScore(fullTime)) {
    return {
      ...fullTime,
      source: "fullTime",
      duration,
      warning: null,
    };
  }

  if (
    (duration === "EXTRA_TIME" || duration === "PENALTY_SHOOTOUT") &&
    hasCompleteScore(fullTime)
  ) {
    return {
      home: null,
      away: null,
      source: "unavailable",
      duration,
      warning:
        "Provider score includes extra-time/penalty context but regularTime is missing; skipped to avoid scoring normal predictions with the wrong score.",
    };
  }

  return {
    home: null,
    away: null,
    source: "unavailable",
    duration,
    warning: null,
  };
}

export function getPredictionScoringScoreFromProviderPayload(rawPayload: unknown) {
  return getPredictionScoringScoreFromProviderScore(
    getProviderScoreObject(rawPayload),
  );
}
