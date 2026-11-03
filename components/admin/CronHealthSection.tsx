import { PICK8_TIME_ZONE } from "@/utils/pick8-fixture-state";
import type {
  Pick8CronExecution,
  Pick8CronHealth,
  Pick8CronJob,
  Pick8CronJobStatus,
} from "@/utils/pick8-cron-monitor";

const STATUS_LABELS: Record<Pick8CronJobStatus, string> = {
  healthy: "Healthy",
  awaiting_first_run: "Awaiting first run",
  missed: "Missed",
  failing: "Failing",
};

const STATUS_CLASSES: Record<Pick8CronJobStatus, string> = {
  healthy: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  awaiting_first_run: "border-slate-400/35 bg-slate-400/10 text-slate-200",
  missed: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  failing: "border-rose-400/35 bg-rose-400/10 text-rose-200",
};

const OUTCOME_LABELS: Record<string, string> = {
  success: "Success", no_op: "No-op", failure: "Failure", running: "Running",
};

function formatTime(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    timeZone: PICK8_TIME_ZONE, timeZoneName: "short",
  }).format(date);
}

/** Read-only view of automation history; renders an error line instead of failing the admin page. */
export default function CronHealthSection({
  data,
}: {
  data: { health: Pick8CronHealth; executionsByJob: Record<Pick8CronJob, Pick8CronExecution[]> } | null;
}) {
  return (
    <section className="brand-card p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="brand-eyebrow">Automation</p>
          <h2 className="mt-1 text-2xl font-black text-white">Scheduled jobs</h2>
        </div>
        {data ? (
          <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${data.health.healthy ? STATUS_CLASSES.healthy : STATUS_CLASSES.missed}`}>
            {data.health.healthy ? "All jobs on schedule" : "Attention needed"}
          </span>
        ) : null}
      </div>
      {data ? (
        <p className={`mt-3 text-xs ${data.health.monitoring.source === "invalid_config" ? "text-rose-200" : "text-slate-400"}`}>
          {data.health.monitoring.source === "invalid_config"
            ? "PICK8_CRON_MONITORING_SINCE is set but is not a valid ISO-8601 time with a zone; missed runs may go undetected."
            : data.health.monitoring.source === "none"
              ? "Monitoring is not armed yet: set PICK8_CRON_MONITORING_SINCE, or it starts at the first recorded run."
              : `Monitoring since ${formatTime(data.health.monitoring.since)}${data.health.monitoring.source === "first_run" ? " (first recorded run)" : ""}.`}
        </p>
      ) : null}
      {!data ? (
        <p className="brand-alert-danger mt-4">Automation history could not be loaded. Please try again.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10">
          {data.health.jobs.map((job) => {
            const recent = data.executionsByJob[job.job] ?? [];
            return (
              <li key={job.job} className="space-y-2 px-3 py-3 sm:px-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{job.job}</p>
                    <p className="text-xs text-slate-500">{job.schedule}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_CLASSES[job.status]}`}>
                    {STATUS_LABELS[job.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{job.reason}</p>
                <dl className="grid gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-2">
                  <div className="flex gap-2"><dt className="text-slate-500">Last attempt</dt><dd>{formatTime(job.lastAttemptAt)}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500">Last success</dt><dd>{formatTime(job.lastSuccessAt)}</dd></div>
                </dl>
                {job.lastError ? <p className="text-xs text-rose-200">Last error: {job.lastError}</p> : null}
                {recent.length ? (
                  <p className="flex flex-wrap gap-1.5" aria-label={`Recent ${job.job} runs, newest first`}>
                    {recent.map((run, index) => (
                      <span
                        key={`${run.started_at}-${index}`}
                        title={`${formatTime(run.started_at)} · ${OUTCOME_LABELS[run.outcome] ?? run.outcome}`}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                          run.outcome === "failure" ? STATUS_CLASSES.failing
                            : run.outcome === "running" ? STATUS_CLASSES.awaiting_first_run
                            : STATUS_CLASSES.healthy}`}
                      >
                        {OUTCOME_LABELS[run.outcome] ?? run.outcome}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
