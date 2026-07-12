# Deployment Guide — MIP Movement Calendar

Step-by-step for taking this from a fresh clone to a live app.

## Prerequisites

- Node.js 20+ installed locally
- Supabase project at `https://oqnratorzgejmjqzyubi.supabase.co` (already created)
- Vercel account (free tier works)
- GitHub repo access to `PatrickJamesYoung/MIP-Calendar`

## Step 1 — Apply the database schema

The schema is a single SQL file, safe to run once.

**Option A: Supabase Dashboard (easiest)**

1. Open [supabase.com](https://supabase.com/dashboard) → your project
2. Left sidebar → **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `supabase/migrations/0001_initial_schema.sql`
5. Paste and click **Run** (green button, top right)
6. You should see "Success. No rows returned." — schema is now live.

**Option B: Supabase CLI**

```bash
npm install -g supabase
supabase login
supabase link --project-ref oqnratorzgejmjqzyubi
supabase db push
```

## Step 2 — Set up authentication (Google OAuth)

1. Supabase Dashboard → **Authentication** → **Providers**
2. Enable **Email** (default) and **Google**
3. For Google:
   - Follow Supabase's Google OAuth setup guide
   - Add authorized redirect URLs (Vercel URL + `localhost:3000/auth/callback`)

## Step 3 — Grab your API keys

1. Supabase Dashboard → **Settings → Data API**
2. Copy:
   - **Project URL** — `https://oqnratorzgejmjqzyubi.supabase.co`
   - **anon / public key** — safe for client
   - **service_role / secret key** — server only, treat like a password

## Step 4 — Local development

```bash
git clone https://github.com/PatrickJamesYoung/MIP-Calendar.git
cd MIP-Calendar
npm install
cp .env.example .env.local
# → edit .env.local, paste in the two keys from Step 3
npm run dev
```

Open http://localhost:3000. You should see the Feed view with 6 sample events.

## Step 5 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** → find `PatrickJamesYoung/MIP-Calendar`
3. Framework preset: **Next.js** (auto-detected)
4. Environment variables — add all three:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://oqnratorzgejmjqzyubi.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(from Step 3)* |
   | `SUPABASE_SERVICE_ROLE_KEY` | *(from Step 3)* |
5. Click **Deploy**
6. When it finishes, you'll get a URL like `mip-calendar-xyz.vercel.app`

## Step 6 — Bootstrap the first super admin

You are the first super admin — but the RLS policy requires an existing admin record before you can access `/admin`. Bootstrap it via SQL:

```sql
-- Run this in Supabase SQL Editor AFTER you've signed in at least once
-- via Google OAuth (which creates your row in auth.users).

insert into admins (user_id, email, display_name, role)
select id, email, coalesce(raw_user_meta_data->>'full_name', email), 'super'
from auth.users
where email = 'patrick@reaxn.io'
on conflict (email) do update set role = 'super';
```

After this you can log in at `/admin` and invite other admins from the UI.

## Step 7 — Embed in Squarespace (comes in Milestone 3)

Once M3 is complete, replace the Trumba embed on the Squarespace `/calendar` page with:

```html
<iframe
  src="https://YOUR-VERCEL-URL.vercel.app/embed?view=feed"
  style="width: 100%; height: 1200px; border: 0;"
  title="MIP Movement Calendar"
></iframe>
```

We'll add a `postMessage` auto-resize script so the iframe grows/shrinks with content.

## Troubleshooting

**"Missing SUPABASE_URL" errors on npm run dev**
→ You didn't copy `.env.example` to `.env.local`. Do that and restart the dev server.

**Blank page after deploy**
→ Environment variables weren't set in Vercel. Add them under Project Settings, then **Redeploy** (not just Push).

**Can't sign in at /admin**
→ You skipped Step 6. Run the SQL to add yourself as super admin.
