type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export function getReminderEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;

  return {
    apiKey,
    from,
    isConfigured: Boolean(apiKey && from),
    missing: [
      apiKey ? null : "RESEND_API_KEY",
      from ? null : "REMINDER_EMAIL_FROM",
    ].filter(Boolean) as string[],
  };
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailInput): Promise<SendEmailResult> {
  const { apiKey, from, missing } = getReminderEmailConfig();

  if (!apiKey || !from) {
    return {
      ok: false,
      error: `Missing email environment variable(s): ${missing.join(", ")}`,
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
    error?: string;
  } | null;

  if (!response.ok) {
    return {
      ok: false,
      error:
        payload?.message ??
        payload?.error ??
        `Resend returned ${response.status}`,
    };
  }

  return {
    ok: true,
    id: payload?.id ?? null,
  };
}
