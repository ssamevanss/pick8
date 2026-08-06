import { NextResponse } from "next/server";
import {
  authorizePick8Cron,
  runDailyFixtureSync,
} from "@/utils/pick8-cron-automation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizePick8Cron(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await runDailyFixtureSync());
  } catch (error) {
    console.error(JSON.stringify({
      service: "pick8-cron",
      route: "sync-fixtures",
      success: false,
      error: error instanceof Error ? error.message : "Unexpected automation failure.",
    }));
    return NextResponse.json({ ok: false, error: "Fixture automation failed." }, { status: 500 });
  }
}
