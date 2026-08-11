export function resolveCategoryMenuPlacement({
  fullHeight,
  availableBelow,
  availableAbove,
}: {
  fullHeight: number;
  availableBelow: number;
  availableAbove: number;
}) {
  const below = Math.max(0, availableBelow);
  const above = Math.max(0, availableAbove);

  if (fullHeight <= below) return { direction: "down" as const, maxHeight: null };
  if (fullHeight <= above) return { direction: "up" as const, maxHeight: null };
  return below >= above
    ? { direction: "down" as const, maxHeight: Math.floor(below) }
    : { direction: "up" as const, maxHeight: Math.floor(above) };
}
