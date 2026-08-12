# Cron support scripts

Reference implementations of the data-source fetches used by the
Perplexity Computer cron tasks.

**Note on runtime status.** Perplexity Computer background crons run in
isolated sandboxes without access to this repo's filesystem, so the
cron tasks currently embed this Python inline. These scripts serve as:

1. **The canonical parser reference** — the cron inline copies must stay
   in sync with these files.
2. **A local test harness** — you can smoke-test parser changes here
   against real sources before propagating them to the cron task text.
3. **A future hosting target** — if we later publish these as static
   assets from `app.movementinfrastructureproject.org/scripts/*` or
   the GitHub raw URL, the cron tasks can `curl | python3 -` instead
   of embedding the code inline.

## Scripts

### `scripts/daybook/fetch_sources.py`

Called by cron `9e5b0744` (DC Daybook, weekdays 6:15am ET).

Fetches, in one process:
- NOAA weather (points + forecast + active alerts for DC)
- MIP Calendar iCal feed, filtered to today's movement events
- AlertDC (HSEMA) RSS/HTML feed, filtered to today's non-crime alerts

Prints one JSON object to stdout. Errors per source go into `errors`
but never crash the run — the cron falls back to placeholder text.

### `scripts/weekly_planner/fetch_sources.py`

Called by cron `968b19d4` (DC Weekly Planner, Sun 6pm ET).

Fetches the MIP iCal for the coming Monday-Sunday and returns
`movement_events` grouped implicitly by the `date` field.

## Sources NOT scripted

These still run as `browser_task` inside the cron because their
sources are Cloudflare-protected or JS-rendered SPAs with no
public JSON:

- **Congressional Committee Schedule** (congress.gov) — blocked by
  Cloudflare bot challenge on all documented iCal/XML endpoints.
  Could migrate to `api.congress.gov/v3/committee-meeting` if we
  get an API key.
- **DC Council LIMS hearings** (lims.dccouncil.gov) — JS SPA; no
  documented public JSON API surface.
- **Everybody's Business Bulletin Board** (dccouncil.gov/ebbs) —
  JS-rendered SPA; the DC Council API doesn't expose it.

The Daybook already skips EBBS and Committee Schedule on Fridays
(Congress and the Council are typically out).

## Running locally

```bash
pip install pytz
python3 scripts/daybook/fetch_sources.py | jq .
python3 scripts/weekly_planner/fetch_sources.py | jq .
```

Both scripts are standard-library-plus-pytz. No env vars.
