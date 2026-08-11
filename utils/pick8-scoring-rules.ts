export function scorePick8TotalGoals({
  prediction,
  actualGoals,
  finalScoringReady,
}: {
  prediction: number | null;
  actualGoals: number | null;
  finalScoringReady: boolean;
}) {
  if (!finalScoringReady) return null;
  return prediction !== null && prediction === actualGoals ? 10 : 0;
}
