---
paths:
  - "proxy.ts"
  - "app/login/**"
  - "app/signup/**"
  - "app/auth/**"
  - "app/forgot-password/**"
  - "app/reset-password/**"
  - "app/(app)/layout.tsx"
  - "utils/app-context.ts"
  - "utils/supabase/**"
---
# Authentication, sessions and access

- `proxy.ts` → `utils/supabase/middleware.ts` protects only the prefixes in
  `PROTECTED_PREFIXES` (`middleware-auth.ts`). **A new authenticated page must be added there**
  and must also check the user in its own layout/page (defence in depth). `/api/*` is *not*
  covered by the proxy: every route handler must authorise itself.
- Auth is fail-closed but not fail-logged-out: a Supabase timeout/5xx is "unavailable" (503 page),
  never "unauthenticated" (redirect to login). Keep that distinction (`resilience.ts`,
  `middleware-auth.ts`, tests `pick8-middleware-auth`, `pick8-supabase-resilience`). Don't clear
  cookies or sign users out on ambiguous errors.
- Access model: `profiles.is_active` = may use the app; `is_admin` = admin; `pick8_participation_active`
  = may enter picks. Admin checks happen server-side in every admin action; never trust a client flag.
- Signup requires the server-only `PICK8_SIGNUP_CODE`. Never put it, passwords, or emails in URLs,
  logs, redirects or client bundles.
- Service-role clients bypass RLS. Use them only in server code after an explicit authorisation
  check, select the minimum columns, and never return rows belonging to other players that the
  viewer isn't entitled to see (unrevealed selections, drafts).
- Never log tokens, cookies, `Authorization` headers or user emails.
