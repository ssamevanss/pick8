import PredictionOutcomeBadge from "./PredictionOutcomeBadge";
import TeamIdentity from "./TeamIdentity";
import type { Fixture, FixtureTeamForm, Prediction, TeamFormResult } from "./types";

type FixturePredictionCardProps = {
  fixture: Fixture;
  predictions: Prediction[];
  currentUserId: string;
  jokerPredictionKeys: Set<string>;
  ownJokerFixtureIds: Set<string>;
  jokersLeft: number;
  teamForm: FixtureTeamForm;
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
  const pickTypeDiff =
    getPredictionPickRank(a) - getPredictionPickRank(b);

  if (pickTypeDiff !== 0) {
    return pickTypeDiff;
  }

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

function getPredictionPickType(prediction: Prediction) {
  if (prediction.home_score > prediction.away_score) return "home";
  if (prediction.home_score < prediction.away_score) return "away";
  return "draw";
}

function getPredictionPickRank(prediction: Prediction) {
  const type = getPredictionPickType(prediction);

  if (type === "home") return 1;
  if (type === "draw") return 2;
  return 3;
}

function getSplitStats(predictions: Prediction[]) {
  const total = predictions.length;
  const home = predictions.filter(
    (prediction) => getPredictionPickType(prediction) === "home",
  ).length;
  const draw = predictions.filter(
    (prediction) => getPredictionPickType(prediction) === "draw",
  ).length;
  const away = predictions.filter(
    (prediction) => getPredictionPickType(prediction) === "away",
  ).length;

  const toPercentage = (count: number) =>
    total === 0 ? 0 : Math.round((count / total) * 100);

  return {
    total,
    home: { count: home, percentage: toPercentage(home) },
    draw: { count: draw, percentage: toPercentage(draw) },
    away: { count: away, percentage: toPercentage(away) },
  };
}

function formatFormDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function FormResultPill({ result }: { result: TeamFormResult["result"] }) {
  const className =
    result === "W"
      ? "bg-emerald-400 text-slate-950"
      : result === "D"
        ? "bg-slate-600 text-white"
        : "bg-red-400 text-slate-950";

  return (
    <span
      className={`grid h-6 w-6 place-items-center rounded-full text-xs font-black ${className}`}
    >
      {result}
    </span>
  );
}

function TeamFormList({
  title,
  results,
}: {
  title: string;
  results: TeamFormResult[];
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {results.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No recent form yet</p>
      ) : (
        <div className="mt-3 space-y-2">
          {results.map((result) => (
            <div
              key={result.fixtureId}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-sm"
            >
              <FormResultPill result={result.result} />
              <span className="min-w-0 truncate text-slate-300">
                {result.venue} vs {result.opponent}
              </span>
              <span className="text-right text-xs font-semibold text-slate-500">
                {result.goalsFor}-{result.goalsAgainst} ·{" "}
                {formatFormDate(result.kickoffAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictionSplit({
  fixture,
  predictions,
}: {
  fixture: Fixture;
  predictions: Prediction[];
}) {
  const split = getSplitStats(predictions);
  const segments = [
    {
      key: "home",
      label: "Home",
      count: split.home.count,
      percentage: split.home.percentage,
      className: "bg-emerald-400",
    },
    {
      key: "draw",
      label: "Draw",
      count: split.draw.count,
      percentage: split.draw.percentage,
      className: "bg-amber-300",
    },
    {
      key: "away",
      label: "Away",
      count: split.away.count,
      percentage: split.away.percentage,
      className: "bg-sky-400",
    },
  ];

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Prediction split
        </p>
        <p className="text-xs text-slate-500">
          {split.total} prediction{split.total === 1 ? "" : "s"}
        </p>
      </div>

      {split.total === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No prediction split is available yet.
        </p>
      ) : (
        <>
          <div
            className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800"
            role="img"
            aria-label={`${fixture.home_team} win ${split.home.percentage} percent, draw ${split.draw.percentage} percent, ${fixture.away_team} win ${split.away.percentage} percent`}
          >
            {segments.map((segment) => (
              <span
                key={segment.key}
                className={segment.className}
                style={{
                  width: `${segment.percentage}%`,
                  minWidth: segment.count > 0 ? "0.4rem" : 0,
                }}
              />
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {segments.map((segment) => (
              <div key={segment.key} className="rounded-lg bg-slate-900/70 p-2">
                <p className="font-bold text-white">{segment.label}</p>
                <p className="mt-1 text-slate-400">
                  {segment.percentage}% · {segment.count}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function FixturePredictionCard({
  fixture,
  predictions,
  currentUserId,
  jokerPredictionKeys,
  ownJokerFixtureIds,
  jokersLeft,
  teamForm,
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
  const predictionGroups = [
    {
      label: `${fixture.home_team} win`,
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "home",
      ),
    },
    {
      label: "Draw",
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "draw",
      ),
    },
    {
      label: `${fixture.away_team} win`,
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "away",
      ),
    },
  ].filter((group) => group.predictions.length > 0);

  return (
    <div className="brand-card-soft p-4">
      <input type="hidden" name="fixture_id" value={fixture.id} />

      <p className="text-xs text-slate-500">
        {formatKickoff(fixture.kickoff_at)} · {fixture.competition}
      </p>

      {isLocked ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {hasActualResult ? "Actual result" : "Result pending"}
          </p>

          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamIdentity teamName={fixture.home_team} />
            <span className="rounded-xl bg-slate-950 px-3 py-2 text-lg font-black tabular-nums text-white">
              {hasActualResult ? fixture.home_score : "-"} -{" "}
              {hasActualResult ? fixture.away_score : "-"}
            </span>
            <TeamIdentity teamName={fixture.away_team} align="right" />
          </div>

          {ownPrediction ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Your prediction
              </p>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold tabular-nums">
                  {hasJoker ? (
                    <span
                      title="Joker used"
                      className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] font-black text-slate-950"
                    >
                      J
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
            <div className="mt-3 border-t border-white/10 pt-3">
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
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <TeamIdentity teamName={fixture.home_team} />
            <div className="mt-2">
              <TeamIdentity teamName={fixture.away_team} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <input
                name={`home_score_${fixture.id}`}
                type="number"
                inputMode="numeric"
                min="0"
                defaultValue={ownPrediction?.home_score ?? ""}
                className="h-12 w-16 appearance-none rounded-xl border border-white/10 bg-slate-900 text-center text-xl font-black outline-none transition focus:border-emerald-400/60 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label={`${fixture.home_team} score`}
              />
              <span className="text-slate-500">-</span>
              <input
                name={`away_score_${fixture.id}`}
                type="number"
                inputMode="numeric"
                min="0"
                defaultValue={ownPrediction?.away_score ?? ""}
                className="h-12 w-16 appearance-none rounded-xl border border-white/10 bg-slate-900 text-center text-xl font-black outline-none transition focus:border-emerald-400/60 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label={`${fixture.away_team} score`}
              />
            </div>

            {jokerDisabled ? (
              <div
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-bold ${
                  hasJoker
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
                title={
                  hasJoker
                    ? "Joker applied"
                    : isLocked
                      ? "Fixture locked"
                      : "No Jokers left"
                }
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ring-1 ring-inset ${
                    hasJoker
                      ? "bg-amber-300 text-slate-950 ring-amber-500/30"
                      : "bg-slate-950/70 text-slate-500 ring-slate-700"
                  }`}
                >
                  J
                </span>

                <span>
                  {hasJoker
                    ? "Joker active"
                    : isLocked
                      ? "Locked"
                      : "No Jokers left"}
                </span>

                {hasJoker ? (
                  <span className="rounded-full bg-slate-950/60 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
                    2x
                  </span>
                ) : null}
              </div>
            ) : (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-slate-900 px-3 py-2 text-sm font-bold text-slate-300 transition hover:border-amber-500/40 hover:text-white">
                <input
                  name={`use_joker_${fixture.id}`}
                  type="checkbox"
                  defaultChecked={hasJoker}
                  className="peer sr-only"
                />

                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/70 text-xs font-black ring-1 ring-inset ring-slate-700 transition peer-checked:bg-amber-300 peer-checked:text-slate-950 peer-checked:ring-amber-500/30">
                  J
                </span>

                <span className="transition peer-checked:text-amber-200">
                  Joker
                </span>

                <span className="rounded-full bg-slate-950/60 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 transition peer-checked:text-amber-200">
                  2x
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {isLocked ? (
        <PredictionSplit fixture={fixture} predictions={sortedPredictions} />
      ) : null}

      <details className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-slate-300">
          View form
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TeamFormList title={fixture.home_team} results={teamForm.home} />
          <TeamFormList title={fixture.away_team} results={teamForm.away} />
        </div>
      </details>

      {isLocked && sortedPredictions.length > 0 ? (
        <details className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-slate-300">
            View predictions ({sortedPredictions.length})
          </summary>

          <div className="mt-3 space-y-4">
            {predictionGroups.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {group.label}
                </p>
                <div className="mt-2 space-y-2">
                  {group.predictions.map((prediction) => {
                    const isOwnPrediction = prediction.user_id === currentUserId;
                    const usedJoker = jokerPredictionKeys.has(
                      `${prediction.fixture_id}:${prediction.user_id}`,
                    );

                    return (
                      <div
                        key={`${prediction.fixture_id}-${prediction.user_id}`}
                        className={`grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center ${
                          isOwnPrediction
                            ? "font-bold text-white ring-1 ring-emerald-400/30"
                            : "text-slate-200"
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

                        <span className="flex justify-end gap-1 text-right font-semibold tabular-nums">
                          {usedJoker ? (
                            <span
                              title="Joker used"
                              className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] font-black text-slate-950"
                            >
                              J
                            </span>
                          ) : null}
                          <span>
                            {prediction.home_score} - {prediction.away_score}
                          </span>
                        </span>

                        <span className="col-span-2 flex justify-start sm:col-span-1 sm:justify-end">
                          <PredictionOutcomeBadge prediction={prediction} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
