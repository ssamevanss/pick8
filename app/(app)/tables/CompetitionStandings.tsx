import StandingsTable from "@/components/tables/StandingsTable";
import { fetchAllRows } from "@/utils/paginated-read";
import { createInteractiveAdminClient } from "@/utils/supabase/admin";
import { requireSuccessfulDatabaseOperation } from "@/utils/supabase/resilience";
import {
  buildCompetitionStandings,
  competitionMatchdays,
  type StandingsCompetition,
  type StandingsEntry,
  type StandingsMatchday,
  type StandingsProfile,
} from "@/utils/pick8-standings";

/**
 * Standings for one competition id. Reads only entries on that competition's
 * matchdays, so another competition's scores never reach the table. Read-only
 * by construction: no actions or forms, whether the competition is current or past.
 */
export default async function CompetitionStandings({
  competition,
  matchdays,
  requestDeadlineSignal,
  requestId,
}: {
  competition: StandingsCompetition;
  matchdays: StandingsMatchday[];
  requestDeadlineSignal: AbortSignal;
  requestId: string | null;
}) {
  const admin = createInteractiveAdminClient({
    overallSignal: requestDeadlineSignal,
    context: { page: "tables", operation: "load-competition-standings", requestId },
  });
  const scopedMatchdays = competitionMatchdays(matchdays, competition);
  const [profilesResult, entries] = await Promise.all([
    admin.from("profiles").select("id, display_name, is_active, pick8_participation_active").order("display_name"),
    scopedMatchdays.length
      ? fetchAllRows<StandingsEntry>(({ from, to }) =>
          admin
            .from("entries")
            .select("id, user_id, matchday_id, submitted_at, calculated_score", { count: "exact" })
            .in("matchday_id", scopedMatchdays.map((matchday) => matchday.id))
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([] as StandingsEntry[]),
  ]);
  requireSuccessfulDatabaseOperation(profilesResult.error);
  const rows = buildCompetitionStandings(
    (profilesResult.data ?? []) as StandingsProfile[],
    entries,
    matchdays,
    competition,
  );
  return <StandingsTable rows={rows} latestColumn="latest" />;
}
