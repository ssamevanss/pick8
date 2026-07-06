export const dynamic = "force-dynamic";

const sections = [
  {
    title: "How to play",
    body: "Each gameweek, the selected fixtures open for predictions. Enter the score you think each match will finish with before that fixture kicks off.",
  },
  {
    title: "Scoring",
    body: "Incorrect result or no prediction: 0 points. Correct result: 3 points. Exact score: 5 points.",
  },
  {
    title: "Jokers",
    body: "A Joker doubles your points on one fixture. You have a limited number for the season, so choose carefully.",
  },
  {
    title: "Double Gameweeks",
    body: "In a Double Gameweek, every prediction point in that gameweek counts 2x. Jokers cannot be used, and Joker points do not stack with Double Gameweek points.",
  },
  {
    title: "Prediction locks",
    body: "Each fixture locks at kickoff. You can edit saved predictions before kickoff, but once a fixture starts, that prediction is locked.",
  },
  {
    title: "Seeing other predictions",
    body: "Other players’ predictions stay hidden until the fixture locks. After kickoff, you can see how the league called it.",
  },
  {
    title: "Fixture picker rotation",
    body: "Players take turns picking fixtures. The next picker can choose fixtures once the previous gameweek is complete.",
  },
  {
    title: "Leaderboard",
    body: "The table ranks players by total points. Exact scores and correct results are used as tie-breakers.",
  },
];

export default function RulesPage() {
  return (
    <>
      <header className="brand-card mb-6 p-5 sm:p-6">
        <p className="brand-eyebrow">League guide</p>
        <h1 className="brand-title mt-2">Rules</h1>
        <p className="brand-subtitle mt-2">
          A quick guide to scoring, Jokers, Double Gameweeks, and when picks lock.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <article key={section.title} className="brand-card p-4 sm:p-5">
            <h2 className="text-lg font-black text-white">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{section.body}</p>
          </article>
        ))}
      </section>

      <section className="brand-card mt-4 border-emerald-300/20 bg-emerald-300/10 p-4 sm:p-5">
        <h2 className="text-lg font-black text-white">The short version</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Predict every selected fixture, use Jokers when you fancy a bigger swing,
          watch for Double Gameweeks, and get your scores in before kickoff.
        </p>
      </section>
    </>
  );
}
