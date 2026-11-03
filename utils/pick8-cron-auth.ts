import { createHash, timingSafeEqual } from "node:crypto";

export type Pick8CronAuthReason =
  | "secret_not_configured"
  | "missing_authorization"
  | "malformed_authorization"
  | "invalid_token";

export type Pick8CronAuthRejection = {
  status: 401 | 403 | 500;
  error: string;
  reason: Pick8CronAuthReason;
};

const REJECTIONS: Record<Pick8CronAuthReason, Pick8CronAuthRejection> = {
  secret_not_configured: { status: 500, error: "Cron authentication is not configured.", reason: "secret_not_configured" },
  missing_authorization: { status: 401, error: "Authorization header is required.", reason: "missing_authorization" },
  malformed_authorization: { status: 403, error: "Cron authorization is invalid.", reason: "malformed_authorization" },
  invalid_token: { status: 403, error: "Cron authorization is invalid.", reason: "invalid_token" },
};

/** One log line per route+reason per window per instance; the rest are counted into `suppressed`. */
export const AUTH_REJECTION_LOG_WINDOW_MS = 60_000;
const MAX_THROTTLE_KEYS = 32;
const throttle = new Map<string, { lastLoggedAt: number; suppressed: number }>();

/** Test hook: forget throttle state. */
export function resetPick8CronAuthLogThrottle() {
  throttle.clear();
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time over fixed-length digests, so neither length nor prefix of the secret leaks through timing. */
function headerMatches(provided: string, expected: string) {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** Path only, from the fixed `/api/cron/<job>` shape; never the query string, which could carry a secret. */
function cronRoute(request: Request) {
  try {
    const match = /^\/api\/cron\/([a-z0-9-]{1,40})\/?$/.exec(new URL(request.url).pathname);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

function logRejection(rejection: Pick8CronAuthRejection, route: string, now: number) {
  const key = `${route}:${rejection.reason}`;
  const state = throttle.get(key);
  if (state && now - state.lastLoggedAt < AUTH_REJECTION_LOG_WINDOW_MS) {
    state.suppressed++;
    return;
  }
  if (!state && throttle.size >= MAX_THROTTLE_KEYS) throttle.clear();
  const suppressed = state?.suppressed ?? 0;
  throttle.set(key, { lastLoggedAt: now, suppressed: 0 });
  const line = JSON.stringify({
    service: "pick8-cron",
    event: "auth_rejected",
    route,
    success: false,
    status: rejection.status,
    reason: rejection.reason,
    ...(suppressed ? { suppressed } : {}),
  });
  if (rejection.status === 500) console.error(line);
  else console.warn(line);
}

/**
 * Strict `Authorization: Bearer $CRON_SECRET` check. Returns null when authorized, otherwise the
 * rejection to send (401 missing, 403 wrong, 500 secret unset: fail closed) after logging it.
 */
export function checkPick8CronAuthorization(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
  now: number = Date.now(),
): Pick8CronAuthRejection | null {
  let rejection: Pick8CronAuthRejection | null = null;
  if (!secret) {
    rejection = REJECTIONS.secret_not_configured;
  } else {
    const authorization = request.headers.get("authorization");
    if (!authorization) rejection = REJECTIONS.missing_authorization;
    else if (!headerMatches(authorization, `Bearer ${secret}`)) {
      rejection = authorization.startsWith("Bearer ") ? REJECTIONS.invalid_token : REJECTIONS.malformed_authorization;
    }
  }
  if (rejection) logRejection(rejection, cronRoute(request), now);
  return rejection;
}
