# MIP Movement Calendar

Replacement for the Trumba-based calendar currently embedded at [movementinfrastructureproject.org/calendar](https://www.movementinfrastructureproject.org/calendar).

Built with **Next.js 15 + Supabase + Tailwind CSS**. Designed to be iframed into the existing Squarespace site.

## Milestone status

- ✅ **M1 — Foundation & public read-only calendar** (in progress)
  - Repo scaffold, brand tokens, Supabase schema
  - Feed view with sample data
  - Featured bar
  - Event cards with priority badges, accessibility tags, overlay color coding
- ⏳ M2 — Admin backend + submissions + CSV
- ⏳ M3 — Trumba migration + Squarespace cutover

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in Supabase secrets
cp .env.example .env.local
# → open .env.local and paste your Supabase anon key + service role key

# 3. Run the dev server
npm run dev

# → http://localhost:3000
```

## Supabase setup

1. Sign in at [supabase.com](https://supabase.com) → your MIP project
2. Go to **SQL Editor** → **New Query**
3. Paste the contents of `supabase/migrations/0001_initial_schema.sql`
4. Click **Run** — this creates all tables, indexes, RLS policies, and seed data
5. Go to **Settings → Data API** and copy the `anon` and `service_role` keys into `.env.local`

## Deployment (Vercel)

1. Push this repo to GitHub (it's already at `PatrickJamesYoung/MIP-Calendar`)
2. Go to [vercel.com/new](https://vercel.com/new) → import the repo
3. Add environment variables (Vercel dashboard → Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy

## Project structure

```
mip-calendar/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout (loads Work Sans, sets metadata)
│   │   ├── page.tsx            # Home = Feed view of upcoming events
│   │   └── globals.css         # Tailwind + MIP design tokens
│   ├── components/             # React components
│   │   ├── site-header.tsx     # Sticky top nav (matches MIP branding)
│   │   ├── site-footer.tsx     # Black footer with org name + email
│   │   ├── featured-bar.tsx    # Yellow priority-events strip
│   │   ├── event-card.tsx      # Feed event tile
│   │   └── feed-view.tsx       # Scrolling feed with day dividers
│   └── lib/
│       ├── supabase/           # Client + server Supabase helpers
│       ├── types.ts            # Shared TypeScript types
│       ├── utils.ts            # Date/time formatting, groupBy helpers
│       └── sample-data.ts      # Dev-only sample events (delete post-migration)
├── supabase/
│   ├── migrations/             # Versioned SQL migrations
│   └── seed/                   # Reference seed data (already inlined in 0001)
├── .env.example                # Env template — copy to .env.local
└── README.md
```

## Design tokens

Pulled directly from the MIP Squarespace site:

| Token | Value | Use |
|---|---|---|
| `--color-mip-purple` | `#39375b` | Primary brand color, buttons, headlines |
| `--color-mip-yellow` | `#c2e812` | Signature acid green — featured bar bg |
| `--color-mip-cyan`   | `#2de0fb` | Accent — accessibility tags |
| Font | Work Sans | Everything |
| Button radius | `6.8px` | Matches Squarespace-computed radius |

## License

TBD — this is MIP-owned code. All rights reserved until MIP chooses otherwise.
