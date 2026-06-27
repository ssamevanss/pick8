type NotificationRow = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  created_at: string;
  metadata: ActivityMetadata | null;
};

type ActivityMetadata = {
  gameweekName?: string;
  pickerName?: string;
  kickoffText?: string;
  fixtures?: ActivityFixture[];
  weeklyLeaderboard?: WeeklyLeaderboardRow[];
  weeklyWinners?: WeeklyWinner[];
  biggestRisers?: MovementRow[];
  biggestFallers?: MovementRow[];
};

type ActivityFixture = {
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  kickoffAt?: string;
  status?: string;
};

type WeeklyLeaderboardRow = {
  rank: number;
  name: string;
  points: number;
};

type WeeklyWinner = {
  name: string;
  points: number;
};

type MovementRow = {
  name: string;
  movement: number;
};

type LeagueActivityFeedProps = {
  notifications: NotificationRow[];
};

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMovement(movement: number) {
  if (movement > 0) {
    return `+${movement}`;
  }

  return String(movement);
}

function ActivityShell({
  notification,
  children,
}: {
  notification: NotificationRow;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <p className="text-lg font-bold">{notification.title ?? "League update"}</p>
      {children}
      <p className="mt-4 text-xs text-slate-500">
        {formatCreatedAt(notification.created_at)}
      </p>
    </div>
  );
}

function FixturesSelectedActivity({
  notification,
}: {
  notification: NotificationRow;
}) {
  const fixtures = notification.metadata?.fixtures ?? [];

  return (
    <ActivityShell notification={notification}>
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}

      {fixtures.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {fixtures.map((fixture, index) => (
            <div
              key={`${fixture.homeTeam}-${fixture.awayTeam}-${index}`}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm"
            >
              <span className="font-semibold">{fixture.homeTeam}</span>
              <span className="px-2 text-slate-500">v</span>
              <span className="font-semibold">{fixture.awayTeam}</span>
            </div>
          ))}
        </div>
      ) : null}
    </ActivityShell>
  );
}

function ResultsAvailableActivity({
  notification,
}: {
  notification: NotificationRow;
}) {
  const metadata = notification.metadata ?? {};
  const fixtures = metadata.fixtures ?? [];
  const weeklyLeaderboard = metadata.weeklyLeaderboard ?? [];
  const biggestRisers = metadata.biggestRisers ?? [];
  const biggestFallers = metadata.biggestFallers ?? [];

  return (
    <ActivityShell notification={notification}>
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}

      {fixtures.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Results
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {fixtures.map((fixture, index) => (
              <div
                key={`${fixture.homeTeam}-${fixture.awayTeam}-${index}`}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{fixture.homeTeam}</span>
                  <span className="font-bold tabular-nums">
                    {fixture.homeScore ?? "-"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-semibold">{fixture.awayTeam}</span>
                  <span className="font-bold tabular-nums">
                    {fixture.awayScore ?? "-"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {weeklyLeaderboard.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Weekly leaderboard
          </p>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-800">
            {weeklyLeaderboard.slice(0, 5).map((row) => (
              <div
                key={`${row.rank}-${row.name}`}
                className="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-t border-slate-800 px-3 py-2 text-sm first:border-t-0"
              >
                <span className="text-slate-500">#{row.rank}</span>
                <span className="font-semibold">{row.name}</span>
                <span className="font-bold tabular-nums">
                  {row.points} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {biggestRisers.length > 0 || biggestFallers.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {biggestRisers.length > 0 ? (
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                Biggest risers
              </p>
              <div className="mt-2 space-y-1">
                {biggestRisers.map((row) => (
                  <p key={row.name} className="text-sm">
                    <span className="font-semibold">{row.name}</span>{" "}
                    <span className="text-emerald-300">
                      {formatMovement(row.movement)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {biggestFallers.length > 0 ? (
            <div className="rounded-lg bg-red-500/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-300">
                Biggest fallers
              </p>
              <div className="mt-2 space-y-1">
                {biggestFallers.map((row) => (
                  <p key={row.name} className="text-sm">
                    <span className="font-semibold">{row.name}</span>{" "}
                    <span className="text-red-300">
                      {formatMovement(row.movement)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </ActivityShell>
  );
}

function SimpleActivity({ notification }: { notification: NotificationRow }) {
  return (
    <ActivityShell notification={notification}>
      {notification.body ? (
        <p className="mt-2 text-sm text-slate-400">{notification.body}</p>
      ) : null}
    </ActivityShell>
  );
}

export default function LeagueActivityFeed({
  notifications,
}: LeagueActivityFeedProps) {
  return (
    <section className="mt-8 rounded-2xl bg-slate-900 p-4 shadow-lg">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">League activity</h2>
        <p className="text-sm text-slate-400">
          Recent updates from the league.
        </p>
      </div>

      {notifications.length === 0 ? (
        <p className="rounded-xl bg-slate-950 p-4 text-sm text-slate-400">
          No activity yet. Updates will appear here as fixtures are picked,
          predictions close, and results are entered.
        </p>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            if (notification.type === "fixtures_selected") {
              return (
                <FixturesSelectedActivity
                  key={notification.id}
                  notification={notification}
                />
              );
            }

            if (notification.type === "results_available") {
              return (
                <ResultsAvailableActivity
                  key={notification.id}
                  notification={notification}
                />
              );
            }

            return (
              <SimpleActivity
                key={notification.id}
                notification={notification}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}