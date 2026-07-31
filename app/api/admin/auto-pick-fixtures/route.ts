import {
  autoPickMissingFixtures,
  getEligibleActiveAutoPickSeason,
} from "@/utils/external-auto-pick";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" || profile.status !== "approved") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null };
}

async function handleAutoPick(request: Request) {
  const { error: authError } = await requireAdmin();

  if (authError) {
    return authError;
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

  const searchParams = new URL(request.url).searchParams;
  const seasonId = searchParams.get("season_id");
  const dryRun = searchParams.get("dry_run") !== "0";

  if (!seasonId) {
    return Response.json({ error: "season_id is required" }, { status: 400 });
  }

  const { season, error: seasonError } = await getEligibleActiveAutoPickSeason({
    supabase,
    seasonId,
  });

  if (!season) {
    return Response.json({
      ok: false,
      error: seasonError?.message ?? "Selected season is not an eligible active season",
    }, { status: seasonError ? 500 : 400 });
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

export async function GET(request: Request) {
  return handleAutoPick(request);
}

export async function POST(request: Request) {
  return handleAutoPick(request);
}
