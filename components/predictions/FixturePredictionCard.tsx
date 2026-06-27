import PredictionOutcomeBadge from "./PredictionOutcomeBadge";
import type { Fixture, Prediction } from "./types";

type FixturePredictionCardProps = {
  fixture: Fixture;
  predictions: Prediction[];
  currentUserId: string;
  jokerPredictionKeys: Set<string>;
  ownJokerFixtureIds: Set<string>;
  jokersLeft: number;
};

function formatKickoff(kickoffAt: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(kickoffAt));
}

function getPredictionDisplayName(prediction: Prediction) {
  if (Array.isArray(prediction.profiles)) {
    return prediction.profiles[0]?.display_name ?? "Unknown player";
  }

  return prediction.profiles?.display_name ?? "Unknown player";
}

function sortPredictions(a: Prediction, b: Prediction) {
  const getOutcomeRank = (prediction: Prediction) => {
    if (prediction.is_exact_score) return 1;
    if (prediction.is_correct_result) return 2;
    if (prediction.points !== null) return 3;
    return 4;
  };

  const outcomeDiff = getOutcomeRank(a) - getOutcomeRank(b);

  if (outcomeDiff !== 0) {
    return outcomeDiff;
  }

  return getPredictionDisplayName(a).localeCompare(getPredictionDisplayName(b));
}

export default function FixturePredictionCard({
  fixture,
  predictions,
  currentUserId,
  jokerPredictionKeys,
  ownJokerFixtureIds,
  jokersLeft,
}: FixturePredictionCardProps) {
  const ownPrediction = predictions.find(
    (prediction) => prediction.user_id === currentUserId,
  );

  const isLocked =
    new Date(fixture.kickoff_at) <= new Date() ||
    fixture.status !== "scheduled";

  const hasActualResult =
    fixture.home_score !== null && fixture.away_score !== null;

  const hasJoker = ownJokerFixtureIds.has(fixture.id);
  const jokerDisabled = isLocked || (!hasJoker && jokersLeft <= 0);

  const sortedPredictions = [...predictions].sort(sortPredictions);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="fixture_id" value={fixture.id} />

      <p className="text-xs text-slate-500">
        {formatKickoff(fixture.kickoff_at)} · {fixture.competition}
      </p>

      {isLocked ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {hasActualResult ? "Actual result" : "Result pending"}
          </p>

          <p className="mt-1 text-lg font-bold text-white">
            {fixture.home_team} {hasActualResult ? fixture.home_score : "-"} -{" "}
            {hasActualResult ? fixture.away_score : "-"} {fixture.away_team}
          </p>

          {ownPrediction ? (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Your prediction
              </p>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold tabular-nums">
                  {hasJoker ? (
                    <span title="Joker used" className="text-amber-300">
                      🃏
                    </span>
                  ) : null}

                  <span>
                    {ownPrediction.home_score} - {ownPrediction.away_score}
                  </span>
                </span>

                <PredictionOutcomeBadge prediction={ownPrediction} />
              </div>
            </div>
          ) : (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Your prediction
              </p>
              <p className="mt-1 text-sm text-slate-400">
                No prediction entered.
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="font-medium">{fixture.home_team}</p>
              <p className="font-medium">{fixture.away_team}</p>
            </div>

            <div className="flex items-center gap-2">
              <input
                name={`home_score_${fixture.id}`}
                type="number"
                inputMode="numeric"
                min="0"
                defaultValue={ownPrediction?.home_score ?? ""}
                className="h-10 w-12 rounded-lg bg-slate-800 text-center text-lg font-bold outline-none"
                aria-label={`${fixture.home_team} score`}
              />
              <span className="text-slate-500">-</span>
              <input
                name={`away_score_${fixture.id}`}
                type="number"
                inputMode="numeric"
                min="0"
                defaultValue={ownPrediction?.away_score ?? ""}
                className="h-10 w-12 rounded-lg bg-slate-800 text-center text-lg font-bold outline-none"
                aria-label={`${fixture.away_team} score`}
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
            <input
              name={`use_joker_${fixture.id}`}
              type="checkbox"
              disabled={jokerDisabled}
              defaultChecked={hasJoker}
              className="h-4 w-4 accent-emerald-500 disabled:cursor-not-allowed"
            />
            <span>
              Use Joker{" "}
              <span className="text-slate-500">
                {hasJoker
                  ? "(applied)"
                  : jokersLeft <= 0
                    ? "(none left)"
                    : "(double points)"}
              </span>
            </span>
          </label>
        </>
      )}

      {isLocked && sortedPredictions.length > 0 ? (
        <details className="mt-4 rounded-lg bg-slate-900 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-slate-300">
            View predictions ({sortedPredictions.length})
          </summary>

          <div className="mt-3 space-y-2">
            {sortedPredictions.map((prediction) => {
              const isOwnPrediction = prediction.user_id === currentUserId;
              const usedJoker = jokerPredictionKeys.has(
                `${prediction.fixture_id}:${prediction.user_id}`,
              );

              return (
                <div
                  key={`${prediction.fixture_id}-${prediction.user_id}`}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-slate-800 pt-2 first:border-t-0 first:pt-0 ${
                    isOwnPrediction ? "font-bold text-white" : "text-slate-200"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {getPredictionDisplayName(prediction)}
                    {isOwnPrediction ? (
                      <span className="ml-1 text-xs font-medium text-emerald-300">
                        (you)
                      </span>
                    ) : null}
                  </span>

                  <span className="flex w-20 justify-end gap-1 text-right font-semibold tabular-nums">
                    {usedJoker ? (
                      <span title="Joker used" className="text-amber-300">
                        🃏
                      </span>
                    ) : null}
                    <span>
                      {prediction.home_score} - {prediction.away_score}
                    </span>
                  </span>

                  <span className="flex w-28 justify-end">
                    <PredictionOutcomeBadge prediction={prediction} />
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}