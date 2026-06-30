import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveSeason } from "@/utils/seasons";

type GameweekRow = {
  id: string;
};

type FixtureRow = {
  id: string;
};

type NotificationRow = {
  id: string;
  event_key: string | null;
  metadata: Record<string, unknown> | null;
};

async function requireAdmin() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, error: new Response("Unauthorized", { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { supabase, error: new Response("Forbidden", { status: 403 }) };
  }

  return { supabase, error: null };
}

function getMetadataGameweekId(metadata: Record<string, unknown> | null) {
  const gameweekId = metadata?.gameweekId;

  return typeof gameweekId === "string" ? gameweekId : null;
}

function notificationMatchesGameweek(
  notification: NotificationRow,
  gameweekIds: Set<string>,
) {
  const metadataGameweekId = getMetadataGameweekId(notification.metadata);

  if (metadataGameweekId && gameweekIds.has(metadataGameweekId)) {
    return true;
  }

  const eventKey = notification.event_key ?? "";

  return (
    eventKey.startsWith("fixtures_picked:") ||
    eventKey.startsWith("gameweek_complete:") ||
    eventKey.startsWith("next_picker:")
  ) && gameweekIds.has(eventKey.split(":")[1] ?? "");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function GET(request: NextRequest) {
  const { supabase, error } = await requireAdmin();

  if (error) {
    return error;
  }

  const requestedSeasonId = request.nextUrl.searchParams.get("season_id");
  const { data: activeSeason } = requestedSeasonId
    ? { data: null }
    : await getActiveSeason(supabase, "id");

  const seasonId = requestedSeasonId || activeSeason?.id;

  if (!seasonId) {
    return Response.json(
      { error: "No season selected and no active season found" },
      { status: 400 },
    );
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", seasonId)
    .single();

  if (seasonError || !season) {
    return Response.json(
      { error: seasonError?.message ?? "Season not found" },
      { status: 404 },
    );
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, email, role, status")
    .order("display_name", { ascending: true });

  const { data: gameweeks } = await supabase
    .from("gameweeks")
    .select("*")
    .eq("season_id", seasonId)
    .order("gameweek_number", { ascending: true });

  const gameweekRows = (gameweeks as GameweekRow[] | null) ?? [];
  const gameweekIds = gameweekRows.map((gameweek) => gameweek.id);
  const gameweekIdSet = new Set(gameweekIds);

  const { data: fixtures } =
    gameweekIds.length > 0
      ? await supabase
          .from("fixtures")
          .select("*")
          .in("gameweek_id", gameweekIds)
          .order("kickoff_at", { ascending: true })
      : { data: [] };

  const fixtureRows = (fixtures as FixtureRow[] | null) ?? [];
  const fixtureIds = fixtureRows.map((fixture) => fixture.id);

  const { data: predictions } =
    fixtureIds.length > 0
      ? await supabase
          .from("predictions")
          .select("*")
          .in("fixture_id", fixtureIds)
      : { data: [] };

  const { data: jokerUsage } =
    fixtureIds.length > 0
      ? await supabase
          .from("joker_usage")
          .select("*")
          .in("fixture_id", fixtureIds)
      : { data: [] };

  const { data: leaderboardEntries } = await supabase
    .from("leaderboard_entries")
    .select("*")
    .eq("season_id", seasonId)
    .order("rank", { ascending: true });

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: true });

  const matchedNotifications = (
    (notifications as NotificationRow[] | null) ?? []
  ).filter((notification) =>
    notificationMatchesGameweek(notification, gameweekIdSet),
  );

  const exportedAt = new Date();
  const exportPayload = {
    exported_at: exportedAt.toISOString(),
    export_version: 1,
    notification_export_note:
      "Notifications are included only when metadata.gameweekId or event_key safely matches an exported gameweek.",
    season,
    profiles: profiles ?? [],
    gameweeks: gameweeks ?? [],
    fixtures: fixtures ?? [],
    predictions: predictions ?? [],
    joker_usage: jokerUsage ?? [],
    leaderboard_entries: leaderboardEntries ?? [],
    notifications: matchedNotifications,
  };

  const seasonName =
    typeof season.name === "string" && season.name.trim()
      ? season.name
      : seasonId;
  const dateStamp = exportedAt.toISOString().slice(0, 10);
  const filename = `football-predictor-${slugify(
    seasonName,
  )}-${seasonId.slice(0, 8)}-export-${dateStamp}.json`;

  return new Response(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
