const fixtureScores = [
  ["Home Winner", "Home win: 5 + winning goal difference", "Home loss: −5 per goal of losing margin · Draw: 0"],
  ["Away Winner", "Away win: 10 + winning goal difference", "Away loss: −5 per goal of losing margin · Draw: 0"],
  ["Draw", "Correct: 15 + either team’s goal total", "Incorrect: 0"],
  ["Team to Win", "Selected team wins: 10", "Loss or draw: −10"],
  ["Team to Lose", "Selected team loses: 10", "Win or draw: −10"],
  ["Team to Score", "Selected team scores: 10", "No goals: −10"],
  ["Clean Sheet", "Selected team concedes 0: 10", "Concedes 1 or more: −10"],
] as const;

const ranges = ["1–5", "6–10", "11–15", "16–20", "21–25", "26–30", "31–35", "36–38"];

export default function RulesPage() {
  return <div className="space-y-5">
    <header className="brand-card p-5 sm:p-7"><p className="brand-eyebrow">Player guide</p><h1 className="brand-title mt-2">Pick8 Rules</h1><p className="brand-subtitle mt-2">Seven fixture picks, one total-goals prediction, and a full Premier League season to climb the tables.</p></header>

    <section className="brand-card p-5 sm:p-6"><h2 className="text-2xl font-black text-white">Competition format</h2><p className="mt-3 text-sm leading-6 text-slate-300">Pick8 follows all 38 Premier League matchdays. Every finalized matchday score contributes to both its mini-competition table and the overall 38-matchday table.</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{ranges.map((range, index) => <div className="brand-card-soft p-3 text-center" key={range}><p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Competition {index + 1}</p><p className="mt-1 font-black text-white">Matchdays {range}</p></div>)}</div><p className="mt-3 text-sm text-slate-400">Most mini-competitions last five matchdays. The final competition lasts three.</p></section>

    <section className="brand-card p-5 sm:p-6"><h2 className="text-2xl font-black text-white">Making picks</h2><p className="mt-3 text-sm leading-6 text-slate-300">On a normal matchday, assign Home Winner, Away Winner, Draw, Team to Win, Team to Lose, Team to Score, and Clean Sheet to seven different fixtures. One fixture cannot be used twice; normally about three fixtures remain unused.</p><p className="mt-3 text-sm leading-6 text-slate-300">Also predict Total Goals across the full matchday. It does not consume a fixture. If fewer than seven eligible fixtures exist, use one unique category per available fixture and leave the remaining categories unused. Postponed and cancelled fixtures are unavailable for new picks.</p></section>

    <section className="brand-card p-5 sm:p-6"><h2 className="text-2xl font-black text-white">Scoring</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{fixtureScores.map(([title, correct, other]) => <article className="brand-card-soft p-4" key={title}><h3 className="font-black text-emerald-200">{title}</h3><p className="mt-2 text-sm text-white">{correct}</p><p className="mt-1 text-xs leading-5 text-slate-400">{other}</p></article>)}<article className="brand-card-soft p-4"><h3 className="font-black text-emerald-200">Total Goals</h3><p className="mt-2 text-sm text-white">Exact finished-fixture matchday total: 10</p><p className="mt-1 text-xs text-slate-400">Incorrect: 0</p></article></div><div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-slate-200"><p><strong>Examples:</strong> Home Winner 3–1 = 7; home loss 2–4 = −10. Away Winner 4–2 = 12. Correct Draw: 0–0 = 15, 1–1 = 16, 2–2 = 17, 3–3 = 18.</p></div></section>

    <section className="grid gap-4 md:grid-cols-2"><article className="brand-card p-5"><h2 className="text-xl font-black text-white">Deadlines and visibility</h2><p className="mt-3 text-sm leading-6 text-slate-300">Save drafts and edit submitted picks until the matchday deadline—the earliest eligible fixture kickoff. Your picks remain visible to you. Other players’ submitted picks stay hidden until lock, then become visible to active players. Another player’s draft is never shown as submitted; an unsubmitted entry appears as “No submitted entry”.</p></article><article className="brand-card p-5"><h2 className="text-xl font-black text-white">Results and postponed fixtures</h2><p className="mt-3 text-sm leading-6 text-slate-300">Only finished fixtures with final scores are scored. Picks on postponed or cancelled fixtures are void and receive no positive or negative points; those fixtures also do not count toward Total Goals. The final matchday total is stored once every fixture is finished, postponed, or cancelled. Provider corrections may trigger automatic recalculation.</p></article></section>
  </div>;
}
