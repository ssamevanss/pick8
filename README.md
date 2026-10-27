# Pick8

A private Premier League matchday prediction game: pick fixtures into scoring categories, predict the
matchday's Total Goals, and compete across fixed matchday ranges and the season.

Next.js 16 (App Router) · React 19 · Tailwind 4 · Supabase (Auth + Postgres) · Vercel.
Fixture and result data comes from the sibling app **Who You Got** via a private API.

```bash
cp .env.example .env.local   # fill with NON-production values
npm ci
npm run dev                  # http://localhost:3000
npm run check                # typecheck + lint + tests
npm run build
```

- Start with [AGENTS.md](AGENTS.md) (rules, architecture, validation) and [docs/README.md](docs/README.md) (index).
- Workflow and releases: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Operations: [docs/pick8-operations.md](docs/pick8-operations.md).
- The production-readiness review and hardening roadmap are kept privately by the maintainer, not in this repository.
