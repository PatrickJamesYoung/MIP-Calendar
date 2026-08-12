# MIP Admin Portal

The Movement Infrastructure Project's central operations tool. Runs the public
movement calendar, the gear-lending storefront, an internal wiki, and the
admin console that ties them together.

- **Public calendar** — [app.movementinfrastructureproject.org/calendar](https://app.movementinfrastructureproject.org/calendar)
- **Public gear storefront** — [app.movementinfrastructureproject.org/gear](https://app.movementinfrastructureproject.org/gear)
- **Admin console** — `/admin` (Supabase auth-gated)
- **Iframe embed** — `/embed` (loaded by the Squarespace marketing site)

Built with **Next.js 16 (App Router) + React 19 + Supabase + Tailwind CSS**,
deployed on Vercel with Node 24.x.

## Product surface

| Area | Path | What it does |
|---|---|---|
| Calendar (public) | `/calendar` | Feed + agenda view of published events across overlays |
| Event detail | `/e/[slug]` | Public page + ICS download at `/e/[slug]/ics` |
| Feed | `/calendar.ics` | Full published-events iCal feed with `?overlay=` filter |
| Submissions | `/submit` | Turnstile-guarded public event submission form |
| Subscribe | `/subscribe` | Buttondown signup for the DC Daybook / Weekly Planner |
| Gear (public) | `/gear` | Browse + reserve MIP equipment |
| Admin | `/admin` | Event triage, gear reservations, wiki editor |
| Ingest API | `/api/ingest/*` | Bearer-token endpoints called by the GHA daily ingest |

## Local development

```bash
# 1. Install dependencies (Node 24.x required)
npm install

# 2. Copy env template and fill in secrets
cp .env.example .env.local
# → open .env.local and set at minimum:
#     NEXT_PUBLIC_SUPABASE_URL
#     NEXT_PUBLIC_SUPABASE_ANON_KEY
#     SUPABASE_SERVICE_ROLE_KEY
#     NEXT_PUBLIC_SITE_URL (e.g. http://localhost:3000 for dev)

# 3. Run the dev server
npm run dev
# → http://localhost:3000
```

See [`.env.example`](./.env.example) for the full list of environment
variables (email, Turnstile, ingest bearer token, etc.).

## Supabase

Single unified project: `oqnratorzgejmjqzyubi` (production).

Migrations live in [`supabase/migrations/`](./supabase/migrations) and are
applied by hand via the Supabase SQL editor:

- `0001_initial_schema.sql` — calendar core (events, overlays, submissions)
- `0002_ingestion.sql` — ingest sources + submissions pipeline
- `0100_gear_schema.sql` — gear items, bundles, reservations, email log
- `0101_gear_activity.sql` — reservation activity ledger
- `0102_gear_followup_and_electricity.sql` — follow-up emails + electricity flag
- `0200_wiki_schema.sql` — internal wiki pages + revisions
- `0201_wiki_seed_mip_operations.sql` — seed content
- `0202_wiki_search_rpc.sql` / `0203_wiki_search_rpc_html_safe.sql` — FTS

## Deployment

Single Vercel project (`mip-calendar`) tied to `main`. Canonical host:

- `app.movementinfrastructureproject.org` (production)
- `calendar.movementinfrastructureproject.org` → 308 redirect to `app.*`

Preview deployments run on every branch. Environment variables are set in the
Vercel dashboard under Project → Settings → Environment Variables.

## Daily ingest (GitHub Actions)

`.github/workflows/ingest.yml` runs every day at 16:00 UTC (noon EDT / 11am
EST). Fetches DC-area movement events, runs the LLM classifier, dedupes, and
posts to `/api/ingest/submissions`. Runner is idempotent so a 1-hour DST
drift is fine — see the workflow comment.

See [`ingest/README.md`](./ingest/README.md) for the Python source layout.

## Project structure

```
src/
├── app/
│   ├── admin/         # Auth-gated console (events, gear, wiki, submissions)
│   ├── api/           # Route handlers — ingest, event views, gear actions
│   ├── auth/          # Supabase auth callback routes
│   ├── calendar/      # Public calendar page
│   ├── calendar.ics/  # iCal feed
│   ├── e/[slug]/      # Public event detail + per-event ICS
│   ├── embed/         # Iframe-safe calendar (no header/footer)
│   ├── gear/          # Public gear storefront
│   ├── submit/        # Public event submission form
│   └── subscribe/     # Buttondown signup
├── components/        # Shared React components
├── lib/
│   ├── supabase/      # Browser, server, and admin clients
│   ├── email.ts       # Resend transactional email
│   ├── rate-limit.ts  # Shared in-process rate limiter
│   ├── turnstile.ts   # Cloudflare Turnstile verification
│   └── types.ts       # Shared types
└── proxy.ts           # Next 16 middleware: host redirect + auth refresh

supabase/migrations/   # Versioned SQL migrations (see above)
ingest/                # Python ingest bot (run from GHA)
scripts/               # One-off maintenance scripts
```

## Design tokens

| Token | Value | Use |
|---|---|---|
| `--color-mip-purple` | `#39375b` | Primary brand color, buttons, headlines |
| `--color-mip-yellow` | `#c2e812` | Signature acid green — featured bar bg |
| `--color-mip-cyan`   | `#2de0fb` | Accent — accessibility tags |
| Font | Work Sans (public), Inter (admin) | |
| Button radius | `6.8px` | Matches Squarespace-computed radius |

## Architecture audit

Ongoing cleanup and hardening is tracked in the shared project docs. The
2026-08-12 audit lives in the MIP Tools project files under
`docs/mip-admin-portal-audit-2026-08-12.md`.

## License

MIP-owned code. All rights reserved until MIP chooses otherwise.
