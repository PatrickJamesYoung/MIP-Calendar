# Cron support scripts

Data-source fetchers that the Perplexity Computer cron tasks call as a
preflight step before their agent LLM work.

Extracting these into version-controlled scripts serves three goals:

1. **Prompt-size reduction.** The Daybook and Weekly Planner cron tasks
   used to embed ~10,000 chars of Python inline. That prompt gets billed
   on every fire.
2. **Testability.** Each script has a smoke-test target that hits real
   sources. Broken parsers get caught before they hit production.
3. **Diffability.** Parser tweaks show up in `git log` instead of
   living inside a cron task's opaque `task` field.

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
