type TimingContext = Record<string, string | number | boolean | null | undefined>;

export function startServerTiming() {
  return process.env.DEBUG_TIMINGS === "1" ? performance.now() : null;
}

export function logServerTiming(
  label: string,
  startedAt: number | null,
  context: TimingContext = {},
) {
  if (startedAt === null) {
    return;
  }

  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  console.info("[timing]", { label, durationMs, ...context });
}

export async function withServerTiming<T>(
  label: string,
  operation: () => PromiseLike<T>,
  context: TimingContext = {},
) {
  const startedAt = startServerTiming();

  try {
    return await operation();
  } finally {
    logServerTiming(label, startedAt, context);
  }
}
