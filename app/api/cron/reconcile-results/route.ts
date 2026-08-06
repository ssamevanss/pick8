import { NextResponse } from "next/server";
import {
  authorizePick8Cron,
  runResultReconciliation,
} from "@/utils/pick8-cron-automation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizePick8Cron(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await runResultReconciliation());
  } catch (error) {
    console.error(JSON.stringify({
      service: "pick8-cron",
      route: "reconcile-results",
      success: false,
      error: error instanceof Error ? error.message : "Unexpected automation failure.",
    }));
    return NextResponse.json({ ok: false, error: "Result reconciliation failed." }, { status: 500 });
  }
}
