// Inherited Who You Got cron endpoints that no longer exist in Pick8. They are answered with 410 Gone
// (not 404) and a one-line log so an external scheduler that still calls one is visible in the logs.
// The response never runs the old handler, reads the cron secret, or touches the database.

export const RETIRED_CRON_ROUTES: ReadonlySet<string> = new Set([
  "auto-pick-fixtures",
  "import-external-fixtures",
  "refresh-external-fixtures",
  "refresh-standings",
  "send-prediction-reminders",
  "sync-external-results",
]);

export function retiredCronRouteResponse(name: string, method: string): Response {
  if (!RETIRED_CRON_ROUTES.has(name)) {
    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  console.warn(JSON.stringify({ service: "pick8-retired-route", route: `/api/cron/${name}`, method }));
  return Response.json(
    { ok: false, error: "This endpoint has been retired." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
