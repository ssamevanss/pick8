// Validates user-supplied post-login destinations (`?next=`, hidden `next` form fields).
// Only same-origin, path-absolute destinations are allowed. Anything else resolves to the fallback.
// Pure and dependency-free so it is unit-tested directly and shared by the callback, login and proxy code.

export const DEFAULT_AUTH_REDIRECT = "/dashboard";

const MAX_REDIRECT_LENGTH = 2048;
const MAX_DECODE_ROUNDS = 3;
// A parse base that is never a real host; used only to prove the value stays on one origin.
const PARSE_BASE = "https://pick8-redirect-check.invalid";
// Controls, DEL, and whitespace/line separators. WHATWG URL parsing silently strips tab/CR/LF from
// input, so `/<TAB>/evil.com` becomes `//evil.com` in a browser. Checked by code point (not a regex
// literal) so no invisible characters live in this source file.
function isUnsafeCodePoint(code: number) {
  return code <= 0x20 || (code >= 0x7f && code <= 0xa0) || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200f) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function hasUnsafeChars(value: string) {
  for (let i = 0; i < value.length; i += 1) {
    if (isUnsafeCodePoint(value.charCodeAt(i))) return true;
  }
  return false;
}

function hasUnsafeShape(value: string) {
  return (
    hasUnsafeChars(value) ||
    value.includes("\\") ||
    value.startsWith("//") ||
    value.includes("/\\")
  );
}

/**
 * Returns a normalised same-origin path (`/path?query#hash`) or `fallback`.
 * `fallback` must itself be a trusted constant path; pass `""` to mean "no destination".
 */
export function safeRedirectPath(
  value: unknown,
  fallback: string = DEFAULT_AUTH_REDIRECT,
): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return fallback;
  if (!value.startsWith("/") || hasUnsafeShape(value)) return fallback;

  // Reject paths that only become dangerous after the percent-decoding some proxies, frameworks or
  // downstream consumers apply (`/%5Cevil.com`, `/%09/evil.com`, `/%2F%2Fevil.com`, double-encoded forms).
  // Only the path is decoded and checked: an encoded space or slash in the query string is legitimate.
  let decoded = value.split(/[?#]/, 1)[0];
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (next === decoded) break;
    decoded = next;
    if (hasUnsafeShape(decoded)) return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, PARSE_BASE);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PARSE_BASE) return fallback;

  // Dot-segment normalisation can produce a protocol-relative path (`/.//evil.com` -> `//evil.com`).
  const normalised = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!normalised.startsWith("/") || normalised.startsWith("//")) return fallback;

  return normalised;
}

/** Like `safeRedirectPath`, but returns `""` when there is nothing valid (for hidden form fields). */
export function safeOptionalRedirectPath(value: unknown): string {
  return safeRedirectPath(value, "");
}
