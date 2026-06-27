import { createClient } from "@/utils/supabase/server";

export default async function TestSupabasePage() {
  const supabase = await createClient();

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, home_team, away_team, kickoff_at, competition")
    .order("kickoff_at", { ascending: true });

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <h1 className="text-3xl font-bold">Supabase Test</h1>

      <section className="mt-6 rounded-2xl bg-slate-900 p-4">
        <h2 className="text-xl font-semibold">Seasons</h2>

        {seasonsError ? (
          <pre className="mt-3 whitespace-pre-wrap text-red-400">
            {seasonsError.message}
          </pre>
        ) : (
          <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
            {JSON.stringify(seasons, null, 2)}
          </pre>
        )}
      </section>

      <section className="mt-6 rounded-2xl bg-slate-900 p-4">
        <h2 className="text-xl font-semibold">Fixtures</h2>

        {fixturesError ? (
          <pre className="mt-3 whitespace-pre-wrap text-red-400">
            {fixturesError.message}
          </pre>
        ) : (
          <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
            {JSON.stringify(fixtures, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}