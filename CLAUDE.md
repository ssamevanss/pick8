@AGENTS.md

# Claude Code notes

- `AGENTS.md` is the authoritative guide; area rules live in `.claude/rules/` and load by path.
  Project skills: `/validate`, `/release-readiness`, `/incident-investigation` (`.claude/skills/`).
- Non-negotiable: never read or print `.env*`; no push/merge/PR/deploy, production data change,
  cron trigger against production, email send, or sibling-repo edit without explicit approval.
- Before editing Next.js code, read the matching guide in `node_modules/next/dist/docs/`.
- The working tree may hold the owner's uncommitted work. Check `git status`, stage explicit paths,
  and never `git add -A`, reset, or stash it.
- Report faithfully: say which checks you ran and which failed, and separate pre-existing
  failures (see `docs/DEVELOPMENT.md`) from ones you introduced.
