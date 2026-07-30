import {
  autoPickMissingFixtures,
  getEligibleActiveAutoPickSeason,
} from "@/utils/external-auto-pick";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured.",
      warning: "CRON_SECRET is not set; refusing auto-pick request.",
    };
  }

  const authorization = request.headers.get("authorization");
  const token = new URL(request.url).searchParams.get("token");

  if (authorization === `Bearer ${cronSecret}` || token === cronSecret) {
    return { ok: true, warning: null };
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized",
    warning: null,
  };
}

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);

  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        error: auth.error,
        warning: auth.warning,
      },
      { status: auth.status },
    );
  }

  let supabase: ReturnType<typeof createAdminClient>;

  try {
    supabase = createAdminClient();
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create Supabase admin client.",
      },
      { status: 500 },
    );
  }

  const { season } = await getEligibleActiveAutoPickSeason({ supabase });
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";

  if (!season) {
    return Response.json({
      ok: true,
      skipped_run: true,
      reason: "no eligible active football-data season",
      dry_run: dryRun,
      candidate_gameweeks: [],
      created_count: 0,
      updated_gameweeks: 0,
      skipped: [],
    });
  }

  try {
    const result = await autoPickMissingFixtures({
      supabase,
      season,
      dryRun,
    });

    return Response.json({
      ok: true,
      skipped_run: false,
      ...result,
    });
  } catch (autoPickError) {
    return Response.json(
      {
        ok: false,
        error:
          autoPickError instanceof Error
            ? autoPickError.message
            : "Could not auto-pick fixtures.",
      },
      { status: 500 },
    );
  }
}
