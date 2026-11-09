import { playerDisplayName, type buildStandings } from "@/utils/pick8-standings";

function scoreLabel(score: number | null) {
  if (score === null) return "Pending";
  return score > 0 ? `+${score}` : String(score);
}

export default function StandingsTable({
  rows,
  latestColumn,
}: {
  rows: ReturnType<typeof buildStandings>;
  latestColumn: "latest" | "average";
}) {
  return (
    <div className="brand-table">
      <table className="w-full table-auto text-left text-sm">
        <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400 sm:text-xs">
          <tr>
            <th scope="col" className="px-2 py-3 sm:px-4">Rank</th>
            <th scope="col" className="px-2 py-3 sm:px-4">Player</th>
            <th scope="col" className="px-2 py-3 text-right sm:px-4"><span className="sm:hidden" aria-hidden="true">Pts</span><span className="sr-only sm:not-sr-only">Points</span></th>
            <th scope="col" className="px-2 py-3 text-right sm:px-4"><span className="sm:hidden" aria-hidden="true">Pld</span><span className="sr-only sm:not-sr-only">Played</span></th>
            <th scope="col" className="px-2 py-3 text-right sm:px-4">{latestColumn === "latest" ? "Latest" : <><span className="sm:hidden" aria-hidden="true">Avg</span><span className="sr-only sm:not-sr-only">Average</span></>}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row) => (
            <tr key={row.profile.id}>
              <td className="px-2 py-3 sm:px-4"><span className="brand-pill whitespace-nowrap">#{row.rank}</span></td>
              <td className="px-2 py-3 font-bold leading-tight text-white [overflow-wrap:anywhere] sm:px-4">{playerDisplayName(row.profile)}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right font-black text-emerald-200 sm:px-4">{scoreLabel(row.points)}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right text-slate-300 sm:px-4">{row.played}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right text-slate-300 sm:px-4">{latestColumn === "latest" ? scoreLabel(row.latest) : row.played ? row.average.toFixed(1) : "0.0"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
