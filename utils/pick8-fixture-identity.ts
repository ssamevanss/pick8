export function logicalPick8FixtureKey(fixture: {
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const home = fixture.homeTeamId === null
    ? fixture.homeTeamName.trim().toLocaleLowerCase("en")
    : `id:${fixture.homeTeamId}`;
  const away = fixture.awayTeamId === null
    ? fixture.awayTeamName.trim().toLocaleLowerCase("en")
    : `id:${fixture.awayTeamId}`;
  return `${home}|${away}`;
}
