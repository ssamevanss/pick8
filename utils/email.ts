type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type ReminderEmailTemplateInput = {
  eyebrow?: string;
  title: string;
  body: string;
  supportingText?: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
};

type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

const PRODUCTION_SITE_URL = "https://whoyougot.ie";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function getSiteUrl(requestOrigin?: string | null) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    return PRODUCTION_SITE_URL;
  }

  return (requestOrigin || PRODUCTION_SITE_URL).replace(/\/$/, "");
}

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

export function buildReminderEmailTemplate({
  eyebrow = "Matchday reminder",
  title,
  body,
  supportingText,
  buttonLabel,
  buttonUrl,
  footer,
}: ReminderEmailTemplateInput) {
  const safeEyebrow = escapeHtml(eyebrow);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeSupportingText = supportingText ? escapeHtml(supportingText) : null;
  const safeButtonLabel = escapeHtml(buttonLabel);
  const safeButtonUrl = escapeHtml(buttonUrl);
  const safeFooter = escapeHtml(footer);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;color:#17231a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeBody}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f2;margin:0;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;border:1px solid #dfe8dc;box-shadow:0 12px 34px rgba(23,35,26,0.10);overflow:hidden;">
            <tr>
              <td style="background:#102016;padding:22px 24px;text-align:center;">
                <div style="color:#86efac;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Pick8</div>
                <div style="margin-top:8px;color:#f8fafc;font-size:24px;font-weight:800;line-height:1.2;">${safeTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 24px;text-align:center;">
                <div style="display:inline-block;border-radius:999px;background:#ecfdf3;color:#166534;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:7px 11px;">${safeEyebrow}</div>
                <p style="margin:18px 0 0;color:#17231a;font-size:19px;font-weight:700;line-height:1.45;">${safeBody}</p>
                ${
                  safeSupportingText
                    ? `<p style="margin:12px 0 0;color:#52615a;font-size:15px;line-height:1.55;">${safeSupportingText}</p>`
                    : ""
                }
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto 0;">
                  <tr>
                    <td align="center" bgcolor="#22c55e" style="border-radius:12px;">
                      <a href="${safeButtonUrl}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#22c55e;color:#102016;text-decoration:none;font-size:15px;font-weight:800;">${safeButtonLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e5eee2;padding:16px 24px 22px;text-align:center;">
                <p style="margin:0;color:#6b7a72;font-size:12px;line-height:1.5;">${safeFooter}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
