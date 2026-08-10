export type FixtureSyncMode = "provider" | "manual";

export function isFixtureSyncMode(value: string): value is FixtureSyncMode {
  return value === "provider" || value === "manual";
}

export function shouldSyncProviderFixtures(mode: FixtureSyncMode) {
  return mode === "provider";
}

export function providerManagedMatchdays<
  T extends { fixture_sync_mode: FixtureSyncMode },
>(matchdays: T[]) {
  return matchdays.filter((matchday) => shouldSyncProviderFixtures(matchday.fixture_sync_mode));
}

export function getFixtureAutomationPlan(
  mode: FixtureSyncMode,
  operation: "fixtures" | "results",
) {
  if (mode === "provider") return "provider_sync" as const;
  return operation === "results" ? "score_local_state" as const : "skip" as const;
}
