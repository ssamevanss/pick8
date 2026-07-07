import PredictionOutcomeBadge from "./PredictionOutcomeBadge";
import TeamIdentity from "./TeamIdentity";
import EmojiReactionControls from "@/components/social/EmojiReactionControls";
import { togglePredictionReaction } from "@/utils/social-actions";
import {
  calculateProvisionalPredictionScore,
  getScoreResult,
  isLiveExternalStatus,
} from "@/utils/provisional-scoring";
import type {
  ExternalFixtureScore,
  Fixture,
  FixtureTeamForm,
  Prediction,
  ReactionSummary,
  TeamFormResult,
} from "./types";

type FixturePredictionCardProps = {
  fixture: Fixture;
  predictions: Prediction[];
  currentUserId: string;
  jokerPredictionKeys: string[];
  ownJokerFixtureIds: string[];
  jokersLeft: number;
  teamForm: FixtureTeamForm;
  isDoubleGameweek?: boolean;
  externalScore?: ExternalFixtureScore | null;
  predictionReactionsByKey?: Record<string, ReactionSummary[]>;
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
  return getScoreResult(prediction.home_score, prediction.away_score);
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

function formatExternalStatus(status: string | null | undefined) {
  if (!status) return "Provider";

  const labels: Record<string, string> = {
    IN_PLAY: "Live",
    LIVE: "Live",
    PAUSED: "Paused",
    TIMED: "Timed",
    SCHEDULED: "Scheduled",
    FINISHED: "Final",
    POSTPONED: "Postponed",
    SUSPENDED: "Suspended",
    CANCELLED: "Cancelled",
  };

  return labels[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function formatLastSynced(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
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

function LockedPredictionRow({
  prediction,
  currentUserId,
  usedJoker,
  reactions,
  exactAsDisplayed,
  exactIsLive,
}: {
  prediction: Prediction;
  currentUserId: string;
  usedJoker: boolean;
  reactions: ReactionSummary[];
  exactAsDisplayed: boolean;
  exactIsLive: boolean;
}) {
  const isOwnPrediction = prediction.user_id === currentUserId;
  const displayName = getPredictionDisplayName(prediction);

  return (
    <div
      className={`rounded-lg border px-2 py-1.5 text-xs sm:text-sm ${
        isOwnPrediction
          ? "border-emerald-300/30 bg-emerald-300/10 text-white ring-1 ring-emerald-300/20"
          : "border-white/10 bg-slate-950/55 text-slate-200"
      }`}
    >
      <div className="flex min-h-7 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate ${
            isOwnPrediction ? "font-black" : "font-semibold"
          }`}
          title={displayName}
        >
          {displayName}
          {isOwnPrediction ? (
            <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
              You
            </span>
          ) : null}
        </span>

        <span className="shrink-0 font-black tabular-nums text-white">
          {prediction.home_score}-{prediction.away_score}
        </span>

        {exactAsDisplayed ? (
          <span
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
              exactIsLive
                ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-200"
                : "border-amber-300/40 bg-amber-300/15 text-amber-200"
            }`}
            title={exactIsLive ? "Exact right now" : "Exact score"}
            aria-label={exactIsLive ? "Exact right now" : "Exact score"}
          >
            ★
          </span>
        ) : null}

        {usedJoker ? (
          <span
            title="Joker used"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-200/60 bg-amber-300 text-[12px] text-slate-950"
          >
            🃏
          </span>
        ) : null}

        {!isOwnPrediction ? (
          <EmojiReactionControls
            action={togglePredictionReaction}
            hiddenFields={{
              fixture_id: prediction.fixture_id,
              prediction_user_id: prediction.user_id,
            }}
            reactions={reactions}
            compact
            ariaLabel={`React to ${displayName}'s prediction`}
          />
        ) : null}
      </div>
    </div>
  );
}

function GroupStatusBadge({
  groupType,
  displayedResultType,
  isLive,
}: {
  groupType: "home" | "draw" | "away";
  displayedResultType: "home" | "draw" | "away" | null;
  isLive: boolean;
}) {
  if (!displayedResultType) {
    return null;
  }

  const isCorrectGroup = groupType === displayedResultType;

  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${
        isCorrectGroup
          ? isLive
            ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-200"
            : "border-emerald-300/35 bg-emerald-300/10 text-emerald-200"
          : "border-red-300/30 bg-red-400/10 text-red-200"
      }`}
    >
      {isCorrectGroup
        ? "Result"
        : isLive
          ? "Off track"
          : "Incorrect"}
    </span>
  );
}

function JokerPlayingCard({
  selected,
  muted = false,
}: {
  selected: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={`relative grid h-10 w-8 shrink-0 place-items-center rounded-lg border text-[9px] font-black shadow-sm transition ${
        selected
          ? "border-amber-100 bg-gradient-to-br from-amber-200 to-amber-400 text-slate-950 shadow-lg shadow-amber-500/30 ring-2 ring-amber-200/60"
          : muted
            ? "border-slate-700 bg-slate-900 text-slate-500"
            : "border-amber-300/35 bg-slate-950/90 text-amber-200 opacity-75"
      }`}
      aria-hidden="true"
    >
      <span className="absolute left-1 top-0.5 text-[8px]">J</span>
      <span className="text-[12px] leading-none">2x</span>
      <span className="absolute bottom-0.5 right-1 rotate-180 text-[8px]">
        J
      </span>
    </span>
  );
}

function JokerControl({
  fixtureId,
  hasJoker,
  disabled,
  isLocked,
}: {
  fixtureId: string;
  hasJoker: boolean;
  disabled: boolean;
  isLocked: boolean;
}) {
  if (disabled) {
    return (
      <div
        className={`inline-flex min-h-11 items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-xs font-bold shadow-sm ${
          hasJoker
            ? "border-amber-300/50 bg-gradient-to-br from-amber-300/25 to-amber-600/10 text-amber-100 shadow-amber-950/30"
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
        <JokerPlayingCard selected={hasJoker} muted={!hasJoker} />
        <span className="hidden leading-tight min-[380px]:inline">
          {hasJoker ? "Joker" : isLocked ? "Locked" : "No Jokers"}
        </span>
      </div>
    );
  }

  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-amber-300/25 bg-gradient-to-br from-slate-900 to-amber-950/20 px-2.5 py-1.5 text-xs font-bold text-slate-200 shadow-sm shadow-black/20 transition hover:border-amber-300/50 hover:text-white has-[:checked]:border-amber-200 has-[:checked]:from-amber-300/35 has-[:checked]:to-amber-600/25 has-[:checked]:text-amber-50 has-[:checked]:shadow-lg has-[:checked]:shadow-amber-950/40 has-[:checked]:ring-2 has-[:checked]:ring-amber-300/35">
      <input
        name={`use_joker_${fixtureId}`}
        type="checkbox"
        defaultChecked={hasJoker}
        className="peer sr-only"
        aria-label={hasJoker ? "Joker active for 2x points" : "Use Joker for 2x points on this fixture"}
      />

      <span className="peer-checked:hidden">
        <JokerPlayingCard selected={false} />
      </span>
      <span className="hidden peer-checked:inline">
        <JokerPlayingCard selected />
      </span>

      <span className="transition peer-checked:hidden min-[380px]:inline">
        Joker
      </span>
      <span className="hidden transition peer-checked:inline">
        Joker active
      </span>
    </label>
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
  isDoubleGameweek = false,
  externalScore,
  predictionReactionsByKey = {},
}: FixturePredictionCardProps) {
  const jokerPredictionKeySet = new Set(jokerPredictionKeys);
  const ownJokerFixtureIdSet = new Set(ownJokerFixtureIds);
  const ownPrediction = predictions.find(
    (prediction) => prediction.user_id === currentUserId,
  );

  const isLocked =
    new Date(fixture.kickoff_at) <= new Date() ||
    fixture.status !== "scheduled";

  const hasActualResult =
    fixture.home_score !== null && fixture.away_score !== null;
  const hasExternalDisplayScore =
    !hasActualResult &&
    isLiveExternalStatus(externalScore?.status) &&
    externalScore?.home_score !== null &&
    externalScore?.home_score !== undefined &&
    externalScore?.away_score !== null &&
    externalScore?.away_score !== undefined;
  const displayedHomeScore = hasActualResult
    ? fixture.home_score
    : hasExternalDisplayScore
      ? externalScore.home_score
      : null;
  const displayedAwayScore = hasActualResult
    ? fixture.away_score
    : hasExternalDisplayScore
      ? externalScore.away_score
      : null;
  const scoreLabel = hasActualResult
    ? "Actual result"
    : hasExternalDisplayScore
      ? formatExternalStatus(externalScore?.status)
      : "Result pending";
  const externalSyncedText = hasExternalDisplayScore
    ? formatLastSynced(externalScore?.last_synced_at ?? fixture.external_last_synced_at)
    : null;
  const displayedResultType =
    displayedHomeScore !== null && displayedAwayScore !== null
      ? getScoreResult(displayedHomeScore, displayedAwayScore)
      : null;
  const ownLiveOutcome =
    hasExternalDisplayScore && ownPrediction
      ? calculateProvisionalPredictionScore({
          predictionHome: ownPrediction.home_score,
          predictionAway: ownPrediction.away_score,
          actualHome: displayedHomeScore ?? 0,
          actualAway: displayedAwayScore ?? 0,
          usedJoker: !isDoubleGameweek && ownJokerFixtureIdSet.has(fixture.id),
          isDoubleGameweek,
        }).outcome
      : null;

  const hasJoker = !isDoubleGameweek && ownJokerFixtureIdSet.has(fixture.id);
  const jokerDisabled =
    isLocked || isDoubleGameweek || (!hasJoker && jokersLeft <= 0);

  const sortedPredictions = [...predictions].sort(sortPredictions);
  const predictionGroups = [
    {
      type: "home" as const,
      label: `${fixture.home_team} win`,
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "home",
      ),
    },
    {
      type: "draw" as const,
      label: "Draw",
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "draw",
      ),
    },
    {
      type: "away" as const,
      label: `${fixture.away_team} win`,
      predictions: sortedPredictions.filter(
        (prediction) => getPredictionPickType(prediction) === "away",
      ),
    },
  ].filter((group) => group.predictions.length > 0);

  return (
    <div id={`fixture-${fixture.id}`} className="brand-card-soft scroll-mt-24 p-4">
      <input type="hidden" name="fixture_id" value={fixture.id} />

      <p className="text-xs text-slate-500">
        {formatKickoff(fixture.kickoff_at)} · {fixture.competition}
      </p>

      {isLocked ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {scoreLabel}
          </p>

          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamIdentity teamName={fixture.home_team} />
            <div className="text-center">
              <span
                className={`rounded-xl px-3 py-2 text-lg font-black tabular-nums text-white ${
                  hasExternalDisplayScore
                    ? "bg-emerald-400/15 ring-1 ring-emerald-300/30"
                    : "bg-slate-950"
                }`}
              >
                {displayedHomeScore ?? "-"} - {displayedAwayScore ?? "-"}
              </span>
              {hasExternalDisplayScore ? (
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  {formatExternalStatus(externalScore?.status)}
                  {externalSyncedText ? ` · updated ${externalSyncedText}` : ""}
                </p>
              ) : null}
            </div>
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
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-950 shadow-sm shadow-amber-950/30"
                    >
                      Joker <span className="text-[9px]">2x</span>
                    </span>
                  ) : null}

                  <span>
                    {ownPrediction.home_score} - {ownPrediction.away_score}
                  </span>
                </span>

                {hasExternalDisplayScore ? (
                  <span
                    className={`inline-flex min-w-24 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${
                      ownLiveOutcome === "exact"
                        ? "bg-amber-300/10 text-amber-200 ring-amber-300/30"
                        : ownLiveOutcome === "result"
                          ? "bg-emerald-300/10 text-emerald-200 ring-emerald-300/30"
                          : "bg-red-300/10 text-red-200 ring-red-300/30"
                    }`}
                  >
                    Pending:{" "}
                    {ownLiveOutcome === "exact"
                      ? "Exact"
                      : ownLiveOutcome === "result"
                        ? "Result"
                        : "Off track"}
                  </span>
                ) : (
                  <PredictionOutcomeBadge prediction={ownPrediction} />
                )}
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
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/55 p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
            <TeamIdentity teamName={fixture.home_team} compact />

            <div className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-slate-950/60 p-1.5">
              <input
                name={`home_score_${fixture.id}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                defaultValue={ownPrediction?.home_score ?? ""}
                data-score-input="true"
                autoComplete="off"
                className="h-11 w-11 appearance-none rounded-xl border border-white/10 bg-slate-900 text-center text-xl font-black text-white outline-none transition focus:border-emerald-300/60 disabled:border-emerald-300/30 disabled:bg-emerald-300/10 disabled:text-white disabled:opacity-100"
                aria-label={`${fixture.home_team} score`}
              />
              <span className="text-sm font-black text-slate-500">-</span>
              <input
                name={`away_score_${fixture.id}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                defaultValue={ownPrediction?.away_score ?? ""}
                data-score-input="true"
                autoComplete="off"
                className="h-11 w-11 appearance-none rounded-xl border border-white/10 bg-slate-900 text-center text-xl font-black text-white outline-none transition focus:border-emerald-300/60 disabled:border-emerald-300/30 disabled:bg-emerald-300/10 disabled:text-white disabled:opacity-100"
                aria-label={`${fixture.away_team} score`}
              />
            </div>

            <TeamIdentity teamName={fixture.away_team} align="right" compact />

            {isDoubleGameweek ? (
              <div className="col-span-3 flex justify-center pt-1 sm:col-span-1 sm:justify-end sm:pt-0">
                <span className="inline-flex min-h-11 items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-200">
                  Double GW 2x
                </span>
              </div>
            ) : (
              <div className="col-span-3 flex justify-center pt-1 sm:col-span-1 sm:justify-end sm:pt-0">
                <JokerControl
                  fixtureId={fixture.id}
                  hasJoker={hasJoker}
                  disabled={jokerDisabled}
                  isLocked={isLocked}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {isLocked ? (
        <PredictionSplit fixture={fixture} predictions={sortedPredictions} />
      ) : null}

      {!isLocked ? (
        <details className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-slate-300">
            View form
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TeamFormList title={fixture.home_team} results={teamForm.home} />
            <TeamFormList title={fixture.away_team} results={teamForm.away} />
          </div>
        </details>
      ) : null}

      {isLocked && sortedPredictions.length > 0 ? (
        <details className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-2.5 text-sm">
          <summary className="cursor-pointer select-none rounded-lg px-1 py-1 font-bold text-slate-300 outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-300/50">
            Predictions ({sortedPredictions.length})
          </summary>

          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1">
            {predictionGroups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {group.label}
                    </p>
                    <GroupStatusBadge
                      groupType={group.type}
                      displayedResultType={displayedResultType}
                      isLive={hasExternalDisplayScore}
                    />
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                    {group.predictions.length}
                  </span>
                </div>

                <div className="mt-1.5 space-y-1">
                  {group.predictions.map((prediction) => {
                    const usedJoker =
                      !isDoubleGameweek &&
                      jokerPredictionKeySet.has(
                        `${prediction.fixture_id}:${prediction.user_id}`,
                      );
                    const exactAsDisplayed =
                      displayedHomeScore !== null &&
                      displayedAwayScore !== null &&
                      prediction.home_score === displayedHomeScore &&
                      prediction.away_score === displayedAwayScore;

                    return (
                      <LockedPredictionRow
                        key={`${prediction.fixture_id}-${prediction.user_id}`}
                        prediction={prediction}
                        currentUserId={currentUserId}
                        usedJoker={usedJoker}
                        exactAsDisplayed={exactAsDisplayed}
                        exactIsLive={hasExternalDisplayScore}
                        reactions={
                          predictionReactionsByKey[
                            `${prediction.fixture_id}:${prediction.user_id}`
                          ] ?? []
                        }
                      />
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
