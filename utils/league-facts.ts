import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { upsertActivityNotification } from "@/utils/activity";

type SupabaseLikeClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

type FactFixture = {
  id: string;
  home_team: string;
  away_team: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

type WeeklyLeaderboardRow = {
  rank: number;
  name: string;
  points: number;
};

type MovementRow = {
  name: string;
  movement: number;
};

type PredictionFactRow = {
  fixture_id: string;
  user_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  is_exact_score: boolean | null;
  is_correct_result: boolean | null;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type SeasonPredictionFactRow = PredictionFactRow & {
  fixtures:
    | {
        home_team: string;
        away_team: string;
        home_score: number | null;
        away_score: number | null;
        gameweeks:
          | {
              id: string;
              gameweek_number: number;
            }
          | {
              id: string;
              gameweek_number: number;
            }[]
          | null;
      }
    | {
        home_team: string;
        away_team: string;
        home_score: number | null;
        away_score: number | null;
        gameweeks:
          | {
              id: string;
              gameweek_number: number;
            }
          | {
              id: string;
              gameweek_number: number;
            }[]
          | null;
      }[]
    | null;
};

type JokerFactRow = {
  fixture_id: string;
  user_id: string;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type LeaderboardFactRow = {
  user_id: string;
  rank: number | null;
  total_points: number;
  profiles:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null;
};

type LeagueFactCandidate = {
  factType: string;
  subjectKey: string;
  title: string;
  body: string;
  interestingness: number;
  metadata?: Record<string, unknown>;
};

function getDisplayName(
  profile:
    | {
        display_name: string;
      }
    | {
        display_name: string;
      }[]
    | null,
) {
  if (Array.isArray(profile)) {
    return profile[0]?.display_name ?? "Someone";
  }

  return profile?.display_name ?? "Someone";
}

function getResult(homeScore: number, awayScore: number) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

function getFixtureResult(fixture: FactFixture) {
  if (fixture.home_score === null || fixture.away_score === null) {
    return null;
  }

  return getResult(fixture.home_score, fixture.away_score);
}

function formatFixtureName(fixture: FactFixture) {
  return `${fixture.home_team} v ${fixture.away_team}`;
}

function formatPercentage(count: number, total: number) {
  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((count / total) * 100)}%`;
}

function formatPlayerList(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function getSeasonGameweek(prediction: SeasonPredictionFactRow) {
  const fixture = Array.isArray(prediction.fixtures)
    ? prediction.fixtures[0]
    : prediction.fixtures;
  const gameweek = Array.isArray(fixture?.gameweeks)
    ? fixture?.gameweeks[0]
    : fixture?.gameweeks;

  return gameweek ?? null;
}

function getSeasonFixture(prediction: SeasonPredictionFactRow) {
  return Array.isArray(prediction.fixtures)
    ? prediction.fixtures[0]
    : prediction.fixtures;
}

function addCandidate(
  candidates: LeagueFactCandidate[],
  candidate: LeagueFactCandidate | null,
) {
  if (!candidate || candidate.interestingness <= 0) {
    return;
  }

  candidates.push(candidate);
}

function countByKey<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function getTopCount(counts: Map<string, number>) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

function getPreviousGameweekHighs({
  seasonPredictions,
  currentGameweekNumber,
}: {
  seasonPredictions: SeasonPredictionFactRow[];
  currentGameweekNumber: number;
}) {
  const weeklyPoints = new Map<string, number>();
  const weeklyExactCounts = new Map<number, number>();

  for (const prediction of seasonPredictions) {
    const gameweek = getSeasonGameweek(prediction);

    if (!gameweek || gameweek.gameweek_number >= currentGameweekNumber) {
      continue;
    }

    const pointsKey = `${gameweek.gameweek_number}:${prediction.user_id}`;
    weeklyPoints.set(
      pointsKey,
      (weeklyPoints.get(pointsKey) ?? 0) + (prediction.points ?? 0),
    );

    if (prediction.is_exact_score) {
      weeklyExactCounts.set(
        gameweek.gameweek_number,
        (weeklyExactCounts.get(gameweek.gameweek_number) ?? 0) + 1,
      );
    }
  }

  return {
    previousTopWeeklyPoints:
      weeklyPoints.size > 0 ? Math.max(...weeklyPoints.values()) : 0,
    previousMostExactScores:
      weeklyExactCounts.size > 0 ? Math.max(...weeklyExactCounts.values()) : 0,
  };
}

function buildFixturePredictionFacts({
  fixtures,
  predictions,
}: {
  fixtures: FactFixture[];
  predictions: PredictionFactRow[];
}) {
  const candidates: LeagueFactCandidate[] = [];

  for (const fixture of fixtures) {
    if (fixture.status !== "completed") {
      continue;
    }

    const fixturePredictions = predictions.filter(
      (prediction) => prediction.fixture_id === fixture.id,
    );

    if (fixturePredictions.length < 2) {
      continue;
    }

    const correctCount = fixturePredictions.filter(
      (prediction) => prediction.is_correct_result,
    ).length;
    const exactCount = fixturePredictions.filter(
      (prediction) => prediction.is_exact_score,
    ).length;
    const fixtureName = formatFixtureName(fixture);

    addCandidate(
      candidates,
      correctCount === 0
        ? {
            factType: "fixture_stumped_league",
            subjectKey: fixture.id,
            title: "Nobody saw that coming",
            body: `Nobody got the result right for ${fixtureName}.`,
            interestingness: 82 + fixturePredictions.length,
            metadata: {
              fixtureId: fixture.id,
              fixtureName,
              predictionCount: fixturePredictions.length,
            },
          }
        : null,
    );

    addCandidate(
      candidates,
      exactCount === 0 && fixturePredictions.length >= 4
        ? {
            factType: "no_exact_scores_fixture",
            subjectKey: fixture.id,
            title: "Scores all over the place",
            body: `${fixtureName} did not produce a single exact-score prediction.`,
            interestingness: 48 + fixturePredictions.length,
            metadata: {
              fixtureId: fixture.id,
              fixtureName,
              predictionCount: fixturePredictions.length,
            },
          }
        : null,
    );

    const actualResult = getFixtureResult(fixture);

    if (!actualResult) {
      continue;
    }

    const resultCounts = countByKey(fixturePredictions, (prediction) =>
      getResult(prediction.home_score, prediction.away_score),
    );
    const mostPredictedResult = getTopCount(resultCounts);

    if (mostPredictedResult && mostPredictedResult[0] !== actualResult) {
      const wrongShare = formatPercentage(
        mostPredictedResult[1],
        fixturePredictions.length,
      );

      addCandidate(candidates, {
        factType: "most_predicted_outcome_wrong",
        subjectKey: fixture.id,
        title: "The crowd picked the wrong side",
        body: `${wrongShare} of players picked the wrong outcome in ${fixtureName} (${mostPredictedResult[1]} of ${fixturePredictions.length}).`,
        interestingness:
          64 +
          mostPredictedResult[1] * 2 +
          (mostPredictedResult[1] / fixturePredictions.length) * 18,
        metadata: {
          fixtureId: fixture.id,
          fixtureName,
          actualResult,
          mostPredictedResult: mostPredictedResult[0],
          mostPredictedCount: mostPredictedResult[1],
          predictionCount: fixturePredictions.length,
          wrongShare,
        },
      });
    }

    const correctShare = correctCount / fixturePredictions.length;
    const correctPredictors = fixturePredictions
      .filter((prediction) => prediction.is_correct_result)
      .map((prediction) => getDisplayName(prediction.profiles));

    addCandidate(
      candidates,
      correctCount > 0 && correctShare <= 0.34 && fixturePredictions.length >= 4
        ? {
            factType: "prediction_split_upset",
            subjectKey: fixture.id,
            title: "A proper prediction upset",
            body:
              correctCount === 1
                ? `Only ${correctPredictors[0]} called ${fixtureName} correctly.`
                : `Only ${correctCount} of ${fixturePredictions.length} players called ${fixtureName} correctly.`,
            interestingness: 70 + (1 - correctShare) * 24,
            metadata: {
              fixtureId: fixture.id,
              fixtureName,
              correctCount,
              correctPredictors,
              predictionCount: fixturePredictions.length,
            },
          }
        : null,
    );
  }

  return candidates;
}

function buildJokerFacts({
  fixtures,
  predictions,
  jokers,
}: {
  fixtures: FactFixture[];
  predictions: PredictionFactRow[];
  jokers: JokerFactRow[];
}) {
  if (jokers.length === 0) {
    return [];
  }

  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const predictionMap = new Map(
    predictions.map((prediction) => [
      `${prediction.fixture_id}:${prediction.user_id}`,
      prediction,
    ]),
  );
  const candidates: LeagueFactCandidate[] = [];

  const jokerResults = jokers
    .map((joker) => {
      const prediction = predictionMap.get(
        `${joker.fixture_id}:${joker.user_id}`,
      );
      const fixture = fixtureMap.get(joker.fixture_id);

      if (!prediction || !fixture) {
        return null;
      }

      return {
        name: getDisplayName(joker.profiles),
        fixture,
        points: prediction.points ?? 0,
      };
    })
    .filter(Boolean) as {
    name: string;
    fixture: FactFixture;
    points: number;
  }[];

  const bestJoker = [...jokerResults].sort((a, b) => b.points - a.points)[0];
  const failedJokers = jokerResults.filter((joker) => joker.points === 0);

  addCandidate(
    candidates,
    bestJoker && bestJoker.points > 0
      ? {
          factType: "joker_success",
          subjectKey: `${bestJoker.fixture.id}:${bestJoker.name}`,
          title: "Joker well played",
          body: `${bestJoker.name} landed ${bestJoker.points} points with a Joker on ${formatFixtureName(bestJoker.fixture)}.`,
          interestingness: 86 + bestJoker.points,
          metadata: {
            playerName: bestJoker.name,
            fixtureId: bestJoker.fixture.id,
            fixtureName: formatFixtureName(bestJoker.fixture),
            points: bestJoker.points,
          },
        }
      : null,
  );

  addCandidate(
    candidates,
    failedJokers.length > 0
      ? {
          factType: "joker_disaster",
          subjectKey: failedJokers.map((joker) => joker.name).join(":"),
          title: "Joker gone wrong",
          body: `${formatPlayerList(
            failedJokers.map((joker) => joker.name),
          )} got nothing from the Joker this week.`,
          interestingness: 84 + failedJokers.length * 3,
          metadata: {
            playerNames: failedJokers.map((joker) => joker.name),
            failedJokerCount: failedJokers.length,
          },
        }
      : null,
  );

  return candidates;
}

function buildSeasonTrendFacts({
  seasonPredictions,
  leaderboardRows,
  currentGameweekNumber,
}: {
  seasonPredictions: SeasonPredictionFactRow[];
  leaderboardRows: LeaderboardFactRow[];
  currentGameweekNumber: number;
}) {
  const candidates: LeagueFactCandidate[] = [];
  const recentWindowStart = Math.max(1, currentGameweekNumber - 2);
  const recentTotals = new Map<string, { name: string; points: number }>();
  const seasonScorelines = new Map<string, number>();
  const teamPredictionStats = new Map<
    string,
    { correct: number; total: number }
  >();

  for (const prediction of seasonPredictions) {
    const fixture = getSeasonFixture(prediction);
    const gameweek = getSeasonGameweek(prediction);

    if (!fixture || !gameweek) {
      continue;
    }

    const scoreline = `${prediction.home_score}-${prediction.away_score}`;
    seasonScorelines.set(scoreline, (seasonScorelines.get(scoreline) ?? 0) + 1);

    if (gameweek.gameweek_number >= recentWindowStart) {
      const current =
        recentTotals.get(prediction.user_id) ??
        {
          name: getDisplayName(prediction.profiles),
          points: 0,
        };
      current.points += prediction.points ?? 0;
      recentTotals.set(prediction.user_id, current);
    }

    for (const teamName of [fixture.home_team, fixture.away_team]) {
      const current =
        teamPredictionStats.get(teamName) ??
        {
          correct: 0,
          total: 0,
        };
      current.total += 1;
      if (prediction.is_correct_result) {
        current.correct += 1;
      }
      teamPredictionStats.set(teamName, current);
    }
  }

  if (currentGameweekNumber >= 3 && recentTotals.size > 0) {
    const recentRanked = [...recentTotals.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });
    const bestRecent = recentRanked[0];
    const coldRecent = recentRanked[recentRanked.length - 1];

    addCandidate(candidates, {
      factType: "best_last_three_gameweeks",
      subjectKey: bestRecent.name,
      title: "Form player",
      body: `${bestRecent.name} has the best score over the last three gameweeks with ${bestRecent.points} points.`,
      interestingness: 62 + Math.min(bestRecent.points, 30),
      metadata: {
        playerName: bestRecent.name,
        points: bestRecent.points,
        windowStart: recentWindowStart,
        windowEnd: currentGameweekNumber,
      },
    });

    addCandidate(
      candidates,
      coldRecent.points <= Math.max(3, bestRecent.points * 0.35)
        ? {
            factType: "cold_last_three_gameweeks",
            subjectKey: coldRecent.name,
            title: "Cold spell",
            body: `${coldRecent.name} has only ${coldRecent.points} point${coldRecent.points === 1 ? "" : "s"} across the last three gameweeks.`,
            interestingness: 54 + Math.max(0, bestRecent.points - coldRecent.points),
            metadata: {
              playerName: coldRecent.name,
              points: coldRecent.points,
              windowStart: recentWindowStart,
              windowEnd: currentGameweekNumber,
            },
          }
        : null,
    );
  }

  const topScoreline = getTopCount(seasonScorelines);

  addCandidate(
    candidates,
    topScoreline && topScoreline[1] >= 4
      ? {
          factType: "common_predicted_scoreline_season",
          subjectKey: topScoreline[0],
          title: "Favourite scoreline",
          body: `${topScoreline[0]} is the most common predicted scoreline this season so far.`,
          interestingness: 48 + topScoreline[1],
          metadata: {
            scoreline: topScoreline[0],
            count: topScoreline[1],
          },
        }
      : null,
  );

  const teamStats = [...teamPredictionStats.entries()]
    .filter(([, stats]) => stats.total >= 6)
    .map(([teamName, stats]) => ({
      teamName,
      correctRate: stats.correct / stats.total,
      ...stats,
    }));
  const easiestTeam = [...teamStats].sort(
    (a, b) => b.correctRate - a.correctRate,
  )[0];
  const hardestTeam = [...teamStats].sort(
    (a, b) => a.correctRate - b.correctRate,
  )[0];

  addCandidate(
    candidates,
    easiestTeam && easiestTeam.correctRate >= 0.7
      ? {
          factType: "easiest_team_to_predict",
          subjectKey: easiestTeam.teamName,
          title: "Everyone has a read on them",
          body: `${easiestTeam.teamName} have been the easiest team to predict so far.`,
          interestingness: 52 + easiestTeam.correctRate * 20,
          metadata: easiestTeam,
        }
      : null,
  );

  addCandidate(
    candidates,
    hardestTeam && hardestTeam.correctRate <= 0.34
      ? {
          factType: "hardest_team_to_predict",
          subjectKey: hardestTeam.teamName,
          title: "Prediction troublemaker",
          body: `${hardestTeam.teamName} have been the hardest team to predict so far.`,
          interestingness: 58 + (1 - hardestTeam.correctRate) * 22,
          metadata: hardestTeam,
        }
      : null,
  );

  const rankedRows = leaderboardRows
    .filter((row) => row.rank !== null)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const closestGap = rankedRows
    .slice(0, -1)
    .map((row, index) => {
      const next = rankedRows[index + 1];
      return {
        playerA: getDisplayName(row.profiles),
        playerB: getDisplayName(next.profiles),
        gap: row.total_points - next.total_points,
        rank: row.rank,
      };
    })
    .filter((gap) => gap.gap >= 0)
    .sort((a, b) => a.gap - b.gap)[0];

  addCandidate(
    candidates,
    closestGap && closestGap.gap <= 2
      ? {
          factType: "closest_leaderboard_gap",
          subjectKey: `${closestGap.playerA}:${closestGap.playerB}`,
          title: "Nothing in it",
          body:
            closestGap.gap === 0
              ? `${closestGap.playerA} and ${closestGap.playerB} are level in the table.`
              : `${closestGap.playerA} is only ${closestGap.gap} point${closestGap.gap === 1 ? "" : "s"} ahead of ${closestGap.playerB}.`,
          interestingness: 70 - closestGap.gap * 4,
          metadata: closestGap,
        }
      : null,
  );

  return candidates;
}

export async function generateLeagueFactNotifications({
  supabase,
  seasonId,
  gameweekId,
  gameweekNumber,
  gameweekName,
  isDoubleGameweek,
  fixtures,
  weeklyLeaderboard,
  biggestRisers,
  biggestFallers,
}: {
  supabase: SupabaseLikeClient;
  seasonId: string;
  gameweekId: string;
  gameweekNumber: number;
  gameweekName: string;
  isDoubleGameweek: boolean;
  fixtures: FactFixture[];
  weeklyLeaderboard: WeeklyLeaderboardRow[];
  biggestRisers: MovementRow[];
  biggestFallers: MovementRow[];
}) {
  const completedFixtures = fixtures.filter(
    (fixture) =>
      fixture.status === "completed" &&
      fixture.home_score !== null &&
      fixture.away_score !== null,
  );

  if (completedFixtures.length === 0 || weeklyLeaderboard.length === 0) {
    return [];
  }

  const fixtureIds = completedFixtures.map((fixture) => fixture.id);
  const { data: predictions } = await supabase
    .from("predictions")
    .select(
      `
      fixture_id,
      user_id,
      home_score,
      away_score,
      points,
      is_exact_score,
      is_correct_result,
      profiles (
        display_name
      )
    `,
    )
    .in("fixture_id", fixtureIds);
  const predictionRows = (predictions as PredictionFactRow[] | null) ?? [];

  if (predictionRows.length === 0) {
    return [];
  }

  const { data: currentJokers } = await supabase
    .from("joker_usage")
    .select(
      `
      fixture_id,
      user_id,
      profiles (
        display_name
      )
    `,
    )
    .in("fixture_id", fixtureIds)
    .is("refunded_at", null);
  const jokerRows = (currentJokers as JokerFactRow[] | null) ?? [];

  const { data: seasonPredictions } = await supabase
    .from("predictions")
    .select(
      `
      fixture_id,
      user_id,
      home_score,
      away_score,
      points,
      is_exact_score,
      is_correct_result,
      profiles (
        display_name
      ),
      fixtures!inner (
        home_team,
        away_team,
        home_score,
        away_score,
        status,
        gameweeks!inner (
          id,
          gameweek_number,
          season_id
        )
      )
    `,
    )
    .eq("fixtures.status", "completed")
    .eq("fixtures.gameweeks.season_id", seasonId);
  const seasonPredictionRows =
    (seasonPredictions as SeasonPredictionFactRow[] | null) ?? [];

  const { data: leaderboardRows } = await supabase
    .from("leaderboard_entries")
    .select(
      `
      user_id,
      rank,
      total_points,
      profiles (
        display_name
      )
    `,
    )
    .eq("season_id", seasonId)
    .order("rank", { ascending: true });
  const typedLeaderboardRows =
    (leaderboardRows as LeaderboardFactRow[] | null) ?? [];

  const candidates: LeagueFactCandidate[] = [];
  const topWeekly = weeklyLeaderboard[0];
  const currentExactCount = predictionRows.filter(
    (prediction) => prediction.is_exact_score,
  ).length;
  const { previousTopWeeklyPoints, previousMostExactScores } =
    getPreviousGameweekHighs({
      seasonPredictions: seasonPredictionRows,
      currentGameweekNumber: gameweekNumber,
    });
  const maxBasePoints = completedFixtures.length * 5;
  const maxWeeklyPoints = isDoubleGameweek
    ? maxBasePoints * 2
    : maxBasePoints + 5;

  addCandidate(
    candidates,
    previousTopWeeklyPoints > 0 && topWeekly.points > previousTopWeeklyPoints
      ? {
          factType: "gameweek_high_score_record",
          subjectKey: topWeekly.name,
          title: "New weekly points record",
          body: `${topWeekly.name} set a new weekly high with ${topWeekly.points} points in ${gameweekName}.`,
          interestingness: 98 + (topWeekly.points - previousTopWeeklyPoints),
          metadata: {
            playerName: topWeekly.name,
            points: topWeekly.points,
            previousRecord: previousTopWeeklyPoints,
          },
        }
      : topWeekly.points >= Math.max(8, maxBasePoints)
        ? {
            factType: "gameweek_high_score",
            subjectKey: topWeekly.name,
            title: "Big week at the top",
            body: `${topWeekly.name} led ${gameweekName} with ${topWeekly.points} points.`,
            interestingness: 58 + topWeekly.points,
            metadata: {
              playerName: topWeekly.name,
              points: topWeekly.points,
            },
          }
        : null,
  );

  addCandidate(
    candidates,
    previousMostExactScores > 0 && currentExactCount > previousMostExactScores
      ? {
          factType: "exact_score_record",
          subjectKey: String(currentExactCount),
          title: "Exact-score record broken",
          body: `${gameweekName} produced ${currentExactCount} exact scores, a new season high.`,
          interestingness: 90 + currentExactCount * 2,
          metadata: {
            exactScoreCount: currentExactCount,
            previousRecord: previousMostExactScores,
          },
        }
      : currentExactCount === 0 && predictionRows.length >= 4
        ? {
            factType: "no_exact_scores_gameweek",
            subjectKey: gameweekId,
            title: "No perfect calls",
            body: `Nobody landed an exact score in ${gameweekName}.`,
            interestingness: 72 + predictionRows.length,
            metadata: {
              predictionCount: predictionRows.length,
            },
          }
        : null,
  );

  addCandidate(
    candidates,
    topWeekly.points >= Math.ceil(maxWeeklyPoints * 0.8)
      ? {
          factType: "near_perfect_gameweek",
          subjectKey: topWeekly.name,
          title: "Nearly perfect",
          body: `${topWeekly.name} scored ${topWeekly.points} of a possible ${maxWeeklyPoints} points in ${gameweekName}.`,
          interestingness: 88 + (topWeekly.points / maxWeeklyPoints) * 12,
          metadata: {
            playerName: topWeekly.name,
            points: topWeekly.points,
            maxPoints: maxWeeklyPoints,
          },
        }
      : null,
  );

  const weeklyScoreline = getTopCount(
    countByKey(
      predictionRows,
      (prediction) => `${prediction.home_score}-${prediction.away_score}`,
    ),
  );

  addCandidate(
    candidates,
    weeklyScoreline && weeklyScoreline[1] >= 3
      ? {
          factType: "popular_scoreline_gameweek",
          subjectKey: weeklyScoreline[0],
          title: "Scoreline of choice",
          body: `${weeklyScoreline[0]} was the most popular predicted scoreline in ${gameweekName}.`,
          interestingness: 45 + weeklyScoreline[1] * 3,
          metadata: {
            scoreline: weeklyScoreline[0],
            count: weeklyScoreline[1],
          },
        }
      : null,
  );

  for (const riser of biggestRisers) {
    addCandidate(candidates, {
      factType: "biggest_riser",
      subjectKey: riser.name,
      title: "Climber of the week",
      body: `${riser.name} climbed ${riser.movement} position${riser.movement === 1 ? "" : "s"} after ${gameweekName}.`,
      interestingness: 62 + riser.movement * 6,
      metadata: riser,
    });
  }

  for (const faller of biggestFallers) {
    const fall = Math.abs(faller.movement);
    addCandidate(candidates, {
      factType: "biggest_faller",
      subjectKey: faller.name,
      title: "Slip of the week",
      body: `${faller.name} dropped ${fall} position${fall === 1 ? "" : "s"} after ${gameweekName}.`,
      interestingness: 58 + fall * 5,
      metadata: faller,
    });
  }

  candidates.push(
    ...buildFixturePredictionFacts({
      fixtures: completedFixtures,
      predictions: predictionRows,
    }),
    ...buildJokerFacts({
      fixtures: completedFixtures,
      predictions: predictionRows,
      jokers: jokerRows,
    }),
    ...buildSeasonTrendFacts({
      seasonPredictions: seasonPredictionRows,
      leaderboardRows: typedLeaderboardRows,
      currentGameweekNumber: gameweekNumber,
    }),
  );

  const selectedFacts = candidates
    .sort((a, b) => {
      if (b.interestingness !== a.interestingness) {
        return b.interestingness - a.interestingness;
      }

      return a.factType.localeCompare(b.factType);
    })
    .reduce<LeagueFactCandidate[]>((selected, candidate) => {
      if (selected.length >= 3) {
        return selected;
      }

      if (selected.some((fact) => fact.factType === candidate.factType)) {
        return selected;
      }

      return [...selected, candidate];
    }, []);

  if (selectedFacts.length > 0) {
    await upsertActivityNotification({
      eventKey: `league_facts:${gameweekId}`,
      type: "info",
      title: `${gameweekName} highlights`,
      body: `${selectedFacts.length} highlight${
        selectedFacts.length === 1 ? "" : "s"
      } from ${gameweekName}.`,
      seasonId,
      gameweekId,
      metadata: {
        gameweekId,
        gameweekName,
        highlights: selectedFacts.map((fact) => ({
          title: fact.title,
          body: fact.body,
          factType: fact.factType,
          subjectKey: fact.subjectKey,
          interestingness: Math.round(fact.interestingness),
          ...fact.metadata,
        })),
      },
    });
  }

  return selectedFacts;
}
