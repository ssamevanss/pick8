"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendEmail } from "@/utils/email";
import { createClient } from "@/utils/supabase/server";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function saveEmailPreferences(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.status !== "approved") {
    redirect("/pending");
  }

  const { error } = await supabase.from("user_email_preferences").upsert(
    {
      user_id: user.id,
      predictions_open_enabled:
        formData.get("predictions_open_enabled") === "on",
      prediction_reminders_enabled:
        formData.get("prediction_reminders_enabled") === "on",
      picker_notifications_enabled:
        formData.get("picker_notifications_enabled") === "on",
      weekly_summary_enabled:
        formData.get("weekly_summary_enabled") === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    redirect(
      `/settings?error=${encodeURIComponent(
        error.message.includes("user_email_preferences")
          ? "Email preferences are not ready yet. Run the email preferences SQL migration first."
          : error.message,
      )}`,
    );
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function submitBugReport(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const message = String(formData.get("message") ?? "").trim();
  const pageUrl = String(formData.get("page_url") ?? "").trim() || null;
  const userAgent = String(formData.get("user_agent") ?? "").trim() || null;

  if (message.length < 5) {
    redirect(
      `/settings?error=${encodeURIComponent(
        "Add a little more detail before sending the bug report.",
      )}`,
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, display_name")
    .eq("id", user.id)
    .maybeSingle();
  const userEmail =
    (profile as { email?: string | null } | null)?.email ?? user.email ?? null;
  const userName =
    (profile as { display_name?: string | null } | null)?.display_name ?? null;
  const createdAt = new Date().toISOString();
  const { error: insertError } = await supabase.from("bug_reports").insert({
    user_id: user.id,
    user_email: userEmail,
    user_name: userName,
    page_url: pageUrl,
    user_agent: userAgent,
    message,
    status: "open",
    created_at: createdAt,
  });

  if (insertError) {
    redirect(
      `/settings?error=${encodeURIComponent(
        insertError.message.includes("bug_reports")
          ? "Bug reports are not ready yet. Run the bug reports SQL migration first."
          : insertError.message,
      )}`,
    );
  }

  const to = process.env.BUG_REPORT_EMAIL_TO?.trim();

  if (!to) {
    console.warn("Bug report saved but BUG_REPORT_EMAIL_TO is not configured.");
    redirect("/settings?reported=email_failed");
  }

  const reporter = userName || userEmail || "Unknown user";
  const subject = `Who You Got? bug report from ${reporter}`;
  const text = `Who You Got? bug report

User: ${userName ?? "Unknown"}
Email: ${userEmail ?? "Unknown"}
Page URL: ${pageUrl ?? "Unknown"}
User agent: ${userAgent ?? "Unknown"}
Created: ${createdAt}

Message:
${message}
`;
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f7f2;color:#17231a;font-family:Arial,Helvetica,sans-serif;padding:24px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dfe8dc;border-radius:16px;padding:24px;">
      <p style="margin:0 0 8px;color:#166534;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Who You Got?</p>
      <h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;">Bug report</h1>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr><td style="padding:6px 0;color:#52615a;font-weight:700;">User</td><td style="padding:6px 0;">${escapeHtml(userName ?? "Unknown")}</td></tr>
        <tr><td style="padding:6px 0;color:#52615a;font-weight:700;">Email</td><td style="padding:6px 0;">${escapeHtml(userEmail ?? "Unknown")}</td></tr>
        <tr><td style="padding:6px 0;color:#52615a;font-weight:700;">Page</td><td style="padding:6px 0;">${escapeHtml(pageUrl ?? "Unknown")}</td></tr>
        <tr><td style="padding:6px 0;color:#52615a;font-weight:700;">Created</td><td style="padding:6px 0;">${escapeHtml(createdAt)}</td></tr>
      </table>
      <h2 style="font-size:16px;margin:0 0 8px;">Message</h2>
      <pre style="white-space:pre-wrap;background:#f4f7f2;border-radius:12px;padding:14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">${escapeHtml(message)}</pre>
      <h2 style="font-size:16px;margin:18px 0 8px;">User agent</h2>
      <pre style="white-space:pre-wrap;background:#f4f7f2;border-radius:12px;padding:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#52615a;">${escapeHtml(userAgent ?? "Unknown")}</pre>
    </div>
  </body>
</html>`;
  const result = await sendEmail({
    to,
    subject,
    text,
    html,
  });

  if (!result.ok) {
    console.warn(`Bug report email failed: ${result.error}`);
    redirect("/settings?reported=email_failed");
  }

  redirect("/settings?reported=sent");
}
