# AJET Flights Dashboard — Build Plan

> Self-contained build spec. An LLM that only reads this file should be able to build the project. Read end-to-end before writing any code.

## Goal

Static dashboard showing AJET airline (IATA `VF`) flight activity, refreshed twice daily by a GitHub Action that calls the AviationStack real-time API. Deployed via GitHub Pages.

## Hard constraints

- **AviationStack free plan = REAL-TIME ONLY.** No `flight_date` historical queries. The dashboard shows *snapshot counts* (currently-airborne flights) at each run, NOT a daily total.
- **3 requests/day budget.** Workflow uses 2 cron slots; 3rd call is reserved as a manual buffer.
- **No external npm dependencies** in `scripts/fetch-flights.js` (Node 20 built-ins only).
- **No secrets in code or commits.** API key via `secrets.AVIATIONSTACK_KEY` only.
- **AJET IATA = `VF`** (confirmed; formerly AnadoluJet).

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
Query params: `access_key`, `airline_iata=VF`, `limit=100`
Response shape (one record):
  flight_date       string YYYY-MM-DD (server's "today"; not used for date logic)
  flight_status     enum: scheduled | active | landed | cancelled | incident | diverted
  departure.iata    string|null
  arrival.iata      string|null
  airline.iata      string
  flight.iata       string (e.g. "VF1")
  flight.number     string (e.g. "1")
  pagination        { limit, offset, count, total }
Errors: 200 OK with `body.error = {code, info}` OR HTTP 429 on rate-limit.

## data.json schema (v1)

{
  "meta": {
    "schema_version": 1,
    "airline_iata": "VF",
    "last_run_utc": "<ISO8601>",
    "last_run_status": "ok" | "error",
    "last_run_flight_count": <int>,
    "last_run_error": null | "<msg>",
    "api_calls_today_utc": <int>
  },
  "latest": {
    "captured_at_utc": "<ISO8601>",
    "flight_count": <int>,
    "by_status": { "<status>": <count> },
    "by_origin": [ { "iata": "<IATA>", "count": <count> }, ... ],
    "flights": [ { "flight": "<VF..>", "origin": "<IATA>", "destination": "<IATA>", "status": "<status>" }, ... ]
  },
  "snapshots": [ { "ts": "<ISO8601>", "count": <int> } ],
  "daily": [
    {
      "date_utc": "YYYY-MM-DD",
      "snapshot_count": <int>,
      "first_count": <int>,
      "last_count": <int>,
      "max_count": <int>,
      "min_count": <int>,
      "by_origin_latest": { "<IATA>": <count> }
    }
  ]
}

Mutation rules:
- latest → overwritten each run
- snapshots → append-only; trim to last 60 entries
- daily → keyed by date_utc; upsert today's row
- meta.api_calls_today_utc → reset to 1 when previous run's UTC date != today

## scripts/fetch-flights.js — behavior

Read existing data.json or initialise empty. GET the API with `limit=100` (one retry on 429 with 7s sleep). Validate `body.error === undefined` and status 200. Normalise each flight; fall back to "UNKNOWN" for missing departure.iata or flight.iata. Build latest block, append to snapshots (cap 60), upsert daily row by date_utc, update meta, atomically write to data.json (tmp + rename). console.log URL path (NOT key) and final flight count. exit 0; on unrecoverable error, still commit a stub data.json with meta.last_run_status="error" so the site keeps rendering.

## .github/workflows/fetch-flights.yml

name: Fetch AJET flights
on:
  schedule:
    - cron: '0 10 * * *'   # 10:00 UTC
    - cron: '0 22 * * *'   # 22:00 UTC
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
2. Meta line: "Last update: <UTC> · <N> snapshot flights · API calls today: X/3"
3. Large headline number = data.latest.flight_count
4. Bar chart "Flights by origin (latest snapshot)" — top 10 from data.latest.by_origin
5. Line chart "Snapshot flight count over time" — last 60 entries from data.snapshots (category axis)
6. Small table: last 7 entries from data.daily

JS: fetch('./data/data.json?_=' + Date.now()) for cache busting. Try/catch around fetch. Validate meta+latest exist. If last_run_status!=="ok", show warning banner. Wrap each <canvas> in <div style="position:relative;height:320px">. Charts: { responsive:true, maintainAspectRatio:false }. Hide Chart B if snapshots.length < 2.

CDN: <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
Head: <meta http-equiv="Cache-Control" content="no-cache">

## Pitfalls to defend against

1. HTTP 429 → one retry, 7s sleep, second 429 = exit 1.
2. body.error on 200 → fail validation.
3. Empty data: [] → valid, flight_count=0.
4. Missing departure.iata → bucket "UNKNOWN".
5. Commit-loop → [skip ci] tag, never trigger on push.
6. Workflow permissions → contents: write mandatory.
7. Concurrency → cancel-in-progress: true.
8. First-run → data.json doesn't exist yet; frontend must handle 404.
9. Chart.js 0×0 canvas → parent div needs explicit height.
10. GitHub Pages caching → ?ts= cache-bust on fetch.

## Out of scope (do NOT implement)

Historical flights, per-flight drill-down, multi-airline, local-time conversion, aircraft info, status filter UI, client-side polling.

## Manual setup steps for the user (not the LLM)

1. Create GitHub repo `ajet-flights-dashboard` (public).
2. Add secret `AVIATIONSTACK_KEY` = the API key.
3. Settings → Pages → Source: main, /root.
4. Approve first workflow run when prompted.
