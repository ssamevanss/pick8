export const dynamic = "force-dynamic";

import SubmitButton from "@/components/forms/SubmitButton";
import BugReportForm from "@/components/settings/BugReportForm";
import ToastTrigger from "@/components/toast/ToastTrigger";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { saveEmailPreferences, submitBugReport } from "./actions";

type SearchParams = Promise<{
  saved?: string;
  reported?: string;
  error?: string;
}>;

type PreferenceRow = {
  predictions_open_enabled: boolean;
  prediction_reminders_enabled: boolean;
  picker_notifications_enabled: boolean;
  weekly_summary_enabled: boolean;
};

function PreferenceToggle({
  name,
  title,
  description,
  defaultChecked,
}: {
  name: keyof PreferenceRow;
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-emerald-300/30">
      <span className="min-w-0">
        <span className="block font-bold text-white">{title}</span>
        <span className="mt-1 block text-sm text-slate-400">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 h-5 w-5 shrink-0 accent-emerald-400"
      />
    </label>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: preferences, error } = await supabase
    .from("user_email_preferences")
    .select(
      "predictions_open_enabled, prediction_reminders_enabled, picker_notifications_enabled, weekly_summary_enabled",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const preferenceRow = preferences as PreferenceRow | null;
  const tableMissing =
    error?.message?.includes("user_email_preferences") ||
    error?.code === "42P01";

  return (
    <>
      <header className="brand-card mb-8 p-5 sm:p-6">
        <p className="brand-eyebrow">Account</p>
        <h1 className="brand-title mt-2">Settings</h1>
        <p className="brand-subtitle mt-2">
          Choose which league emails land in your inbox. In-app updates still
          appear on the dashboard.
        </p>
      </header>

      {params.saved ? (
        <ToastTrigger title="Settings saved" triggerKey="settings:saved" />
      ) : null}

      {params.reported === "sent" ? (
        <ToastTrigger
          title="Bug report sent — thanks!"
          triggerKey="bug-report:sent"
        />
      ) : null}

      {params.reported === "email_failed" ? (
        <ToastTrigger
          title="Bug report saved"
          description="Email notification failed, but the report is in the database."
          tone="info"
          triggerKey="bug-report:email-failed"
        />
      ) : null}

      {params.error ? (
        <p className="brand-alert-danger mb-4">{params.error}</p>
      ) : null}

      {tableMissing ? (
        <p className="brand-alert-warning mb-4">
          Email preferences are not ready yet. Run the email preferences SQL
          migration first.
        </p>
      ) : null}

      <section className="brand-card p-4 sm:p-5">
        <div className="brand-section-header">
          <p className="brand-eyebrow">Email preferences</p>
          <h2 className="text-2xl font-black tracking-tight">
            Matchday emails
          </h2>
          <p className="brand-subtitle">
            Turn off the emails you do not need. You can still use the app
            normally either way.
          </p>
        </div>

        <form action={saveEmailPreferences} className="mt-5 space-y-3">
          <PreferenceToggle
            name="predictions_open_enabled"
            title="Fixtures picked / predictions open"
            description="Email me when the fixtures are picked and predictions are ready."
            defaultChecked={preferenceRow?.predictions_open_enabled ?? true}
          />
          <PreferenceToggle
            name="prediction_reminders_enabled"
            title="24h prediction reminders"
            description="Email me if I still need to make predictions before kickoff."
            defaultChecked={preferenceRow?.prediction_reminders_enabled ?? true}
          />
          <PreferenceToggle
            name="picker_notifications_enabled"
            title="Picker notifications"
            description="Email me when it is my turn to pick fixtures."
            defaultChecked={preferenceRow?.picker_notifications_enabled ?? true}
          />
          <PreferenceToggle
            name="weekly_summary_enabled"
            title="Weekly summary"
            description="Reserved for future recap emails."
            defaultChecked={preferenceRow?.weekly_summary_enabled ?? true}
          />

          <SubmitButton
            idleLabel="Save preferences"
            pendingLabel="Saving preferences..."
            className="brand-button-primary w-full"
          />
        </form>
      </section>

      <section className="brand-card mt-6 p-4 sm:p-5">
        <div className="brand-section-header">
          <p className="brand-eyebrow">Help</p>
          <h2 className="text-2xl font-black tracking-tight">Report a bug</h2>
          <p className="brand-subtitle">
            Spotted something weird? Send a quick note with the page and browser
            details attached automatically.
          </p>
        </div>

        <BugReportForm action={submitBugReport} />
      </section>
    </>
  );
}
