import { NextResponse } from "next/server";
import { authorizePick8Cron } from "@/utils/pick8-cron-automation";
import { loadCronHealth } from "@/utils/pick8-cron-executions-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Read-only automation health for an external uptime monitor (cron-job.org). Same Bearer credential
 * as the cron routes. 200 = healthy or still bootstrapping, 503 = a job missed its schedule or is
 * failing, or history cannot be read. Never triggers any sync. Body carries no errors or payloads.
 */
export async function GET(request: Request) {
  const unauthorized = authorizePick8Cron(request);
  if (unauthorized) return unauthorized;
  try {
    const { health } = await loadCronHealth();
    return NextResponse.json({
      ok: health.healthy,
      status: health.healthy ? "healthy" : "unhealthy",
      checkedAt: health.checkedAt,
      monitoring: health.monitoring,
      jobs: health.jobs.map(({ job, status, reason, lastAttemptAt, lastSuccessAt }) => ({
        job, status, reason, lastAttemptAt, lastSuccessAt,
      })),
    }, { status: health.healthy ? 200 : 503, headers: NO_STORE });
  } catch (error) {
    console.error(JSON.stringify({
      service: "pick8-cron-monitor", event: "health_unavailable", success: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "Unexpected failure",
    }));
    return NextResponse.json({ ok: false, status: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
