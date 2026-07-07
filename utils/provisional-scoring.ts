type ScoreInput = {
  predictionHome: number;
  predictionAway: number;
  actualHome: number;
  actualAway: number;
  usedJoker?: boolean;
  isDoubleGameweek?: boolean;
};

export type ProvisionalOutcome = "exact" | "result" | "incorrect";

export type ProvisionalScoreResult = {
  outcome: ProvisionalOutcome;
  points: number;
  label: "Live exact" | "Live result" | "Off track";
};

export function getScoreResult(homeScore: number, awayScore: number) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

export function calculatePredictionPoints({
  predictionHome,
  predictionAway,
  actualHome,
  actualAway,
  usedJoker = false,
  isDoubleGameweek = false,
}: ScoreInput) {
  const isExactScore =
    predictionHome === actualHome && predictionAway === actualAway;
  const isCorrectResult =
    getScoreResult(predictionHome, predictionAway) ===
    getScoreResult(actualHome, actualAway);

  let points = 0;

  if (isExactScore) {
    points = 5;
  } else if (isCorrectResult) {
    points = 3;
  }

  if (isDoubleGameweek) {
    points *= 2;
  } else if (usedJoker) {
    points *= 2;
  }

  return {
    points,
    isExactScore,
    isCorrectResult,
  };
}

export function calculateProvisionalPredictionScore(
  input: ScoreInput,
): ProvisionalScoreResult {
  const score = calculatePredictionPoints(input);

  if (score.isExactScore) {
    return {
      outcome: "exact",
      points: score.points,
      label: "Live exact",
    };
  }

  if (score.isCorrectResult) {
    return {
      outcome: "result",
      points: score.points,
      label: "Live result",
    };
  }

  return {
    outcome: "incorrect",
    points: 0,
    label: "Off track",
  };
}

export function isLiveExternalStatus(status: string | null | undefined) {
  if (!status) return false;

  return ["IN_PLAY", "LIVE", "PAUSED"].includes(status);
}
