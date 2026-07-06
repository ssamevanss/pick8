export type FixtureSelectionStatusFixture = {
  external_provider?: string | null;
  external_fixture_id?: string | null;
};

export function getFixtureSelectionStatus(
  fixtures: FixtureSelectionStatusFixture[],
) {
  const hasFixtures = fixtures.length > 0;
  const isExternalSelection =
    hasFixtures &&
    fixtures.every(
      (fixture) => fixture.external_provider && fixture.external_fixture_id,
    );
  const expectedCount = isExternalSelection ? fixtures.length : 4;

  return {
    expectedCount,
    selectedCount: fixtures.length,
    isExternalSelection,
    isComplete: hasFixtures && fixtures.length >= expectedCount,
  };
}
