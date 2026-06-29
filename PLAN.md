# AJET Flights Dashboard — Build Plan (v2)

> Self-contained build spec. An LLM that only reads this file should be able to build the project.

## Goal

Static dashboard showing AJET airline (IATA `VF`) daily flight count, recorded once per day at 22:00 UTC by a GitHub Action that calls the AviationStack real-time API. Deployed via GitHub Pages.

## Hard constraints

- **AviationStack free plan = real-time only.** No `flight_date` historical queries. The dashboard records the total flight count at each daily snapshot.
- **1 request/day.** Workflow uses a single cron slot at 22:00 UTC.
- **No external npm dependencies** in `scripts/fetch-flights.js` (Node 20 built-ins only).
- **No secrets in code or commits.** API key via `secrets.AVIATIONSTACK_KEY` only.
- **AJET IATA = `VF`** (confirmed; formerly AnadoluJet).

## How it works

The fetch script calls the API with `limit=1` — we only need `pagination.total`, not the individual flight records. This minimises data transfer and stays within the free plan. The total flight count for the day is appended to a time series in `data.json`.

## Repo layout

ajet-flights-dashboard/
├── .github/workflows/fetch-flights.yml
├── data/data.json                  # generated; committed
├── scripts/fetch-flights.js
├── index.html
├── .nojekyll
├── .gitignore
├── package.json
├── README.md
├── PLAN.md                         # this file
└── TASKS.md                        # task checklist

## API spec

Endpoint: `GET https://api.aviationstack.com/v1/flights`
Query params: `access_key`, `airline_iata=VF`, `limit=1`
Key field: `pagination.total` — the total number of flights matching the query.
Errors: 200 OK with `body.error = {code, info}` OR HTTP 429 on rate-limit.

## data.json schema (v2)

{
  "meta": {
    "schema_version": 2,
    "airline_iata": "VF",
    "last_run_utc": "<ISO8601>",
    "last_run_status": "ok" | "error",
    "last_run_error": null | "<msg>"
  },
  "daily": [
    { "date_utc": "YYYY-MM-DD", "flight_count": <int> }
  ]
}

Mutation rules:
- daily → keyed by date_utc; upsert (update if exists, append if new)
- meta → updated each run with status and timestamp

## scripts/fetch-flights.js — behavior

Read existing data.json or initialise empty. GET the API with `limit=1`. Validate `body.error === undefined` and status 200. Extract `pagination.total` as the flight count. Upsert today's row into the daily array. Update meta. Atomically write to data.json (tmp + rename). Console log the date and count. Exit 0; on unrecoverable error, write a stub data.json with meta.last_run_status="error" so the site keeps rendering.

## .github/workflows/fetch-flights.yml

name: Fetch AJET flights
on:
  schedule:
    - cron: '0 22 * * *'   # 22:00 UTC — single daily snapshot
  workflow_dispatch: {}
concurrency:
  group: ajet-flights-fetch
  cancel-in-progress: true
permissions:
  contents: write
jobs:
  fetch:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      AVIATIONSTACK_KEY: ${{ secrets.AVIATIONSTACK_KEY }}
      DATA_PATH: data/data.json
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/fetch-flights.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: refresh AJET flight snapshot [skip ci]'
          file_pattern: 'data/data.json'

## index.html — frontend spec

Single static file. Chart.js v4 via CDN. Sections:
1. Header "AJET Flights Dashboard"
2. Meta line: "Last run: <UTC> · N days recorded"
3. Large headline number = latest daily flight_count
4. Line chart "Daily flight count" — all entries from data.daily (date on X, flight_count on Y)
5. Warning banner if last_run_status !== "ok"

JS: fetch('./data/data.json?_=' + Date.now()) for cache busting. Try/catch around fetch. Validate meta exists. Chart options: responsive:true, maintainAspectRatio:false. Hide chart if daily.length < 2.

CDN: <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
Head: <meta http-equiv="Cache-Control" content="no-cache">

## Pitfalls to defend against

1. body.error on 200 → fail validation.
2. Missing pagination.total → default to 0.
3. Commit-loop → [skip ci] tag, never trigger on push.
4. Workflow permissions → contents: write mandatory.
5. Concurrency → cancel-in-progress: true.
6. First-run → data.json doesn't exist yet; frontend must handle 404.
7. Chart.js 0×0 canvas → parent div needs explicit height.
8. GitHub Pages caching → ?ts= cache-bust on fetch.

## Out of scope (do NOT implement)

Historical flights, per-flight detail, multi-airline, origin/status breakdowns, status filter UI, client-side polling, pagination.
