# Tasks — AJET Flights Dashboard

Work through these in order. Each task has acceptance criteria; do not move on until the criteria pass.

## Task 1 — Repo scaffolding
Files: `.gitignore`, `package.json`, `.nojekyll`
Acceptance:
- `node -v` ≥ 20
- `package.json` declares `"engines": {"node": ">=20"}` and a single `"fetch": "node scripts/fetch-flights.js"` script. No dependencies.
- `.gitignore` ignores `node_modules/`, `.DS_Store`, `*.log`, `data.json.tmp`.
- `.nojekyll` exists and is empty.

## Task 2 — Seed data.json
Files: `data/data.json`
Acceptance:
- Valid v1 schema (see PLAN.md "data.json schema").
- meta.schema_version = 1, meta.last_run_status = "ok", meta.last_run_flight_count = 0.
- Empty `snapshots` and `daily` arrays.
- JSON is pretty-printed (2-space indent).

## Task 3 — Fetch script
Files: `scripts/fetch-flights.js`
Acceptance:
- No `require()` of external packages; only `node:fs/promises`, `node:path`, `node:url`, built-in `fetch`.
- Reads DATA_PATH (env), falls back to `data/data.json`. Validates AVIATIONSTACK_KEY present.
- One retry on HTTP 429 with 7s sleep.
- Validates `body.error === undefined`.
- Handles null/missing `departure.iata` and `flight.iata` → "UNKNOWN".
- Builds latest, appends to snapshots (cap 60), upserts daily row by date_utc, updates meta.
- Atomic write: writes to `data.json.tmp` then renames.
- Console logs the URL path (no key) and final flight count.
- On unrecoverable error: still writes data.json with meta.last_run_status="error" so the site renders; exit 1.
- `AVIATIONSTACK_KEY=test DATA_PATH=data/data.json node scripts/fetch-flights.js` runs without throwing on missing key (exits 1 with clear error).

## Task 4 — Workflow file
Files: `.github/workflows/fetch-flights.yml`
Acceptance:
- YAML parses (`node -e "require('yaml')..."` or visual inspection).
- Triggers: schedule (2 cron entries at 10:00 + 22:00 UTC), workflow_dispatch. NOT push.
- concurrency group set with cancel-in-progress: true.
- permissions: contents: write at workflow level.
- env: AVIATIONSTACK_KEY from secrets, DATA_PATH=data/data.json.
- Steps: checkout@v4, setup-node@v4 with node 20, run fetch script, git-auto-commit-action@v5 with commit_message ending in [skip ci] and file_pattern: data/data.json.

## Task 5 — Frontend dashboard
Files: `index.html`
Acceptance:
- Single self-contained file (CSS + JS inline OK; CDN scripts allowed).
- Chart.js v4 loaded via jsDelivr CDN.
- Fetches `./data/data.json?_=${Date.now()}`.
- Renders: header, meta line, headline number, Chart A (bar, top 10 by origin), Chart B (line, snapshots over time, hidden if <2 entries), optional daily table (last 7).
- Wraps each <canvas> in <div style="position:relative;height:320px">.
- All Chart() options include responsive:true, maintainAspectRatio:false.
- Try/catch around fetch: on 404, parse error, network error → friendly placeholder shown, not blank page or console error.
- If data.meta.last_run_status !== "ok" → visible warning banner with the error message.
- Includes <meta http-equiv="Cache-Control" content="no-cache"> in <head>.

## Task 6 — README
Files: `README.md`
Acceptance:
- One-paragraph summary of what the project does.
- Mentions: real-time only (no historical), 3 req/day budget (2 cron + 1 manual).
- Manual setup section: create repo, add secret, enable Pages, approve first workflow run.
- "How to run manually" section: Actions → Fetch AJET flights → Run workflow.
- "Project structure" section listing each top-level file/folder.

## Task 7 — End-to-end verification
Steps:
1. Local: `AVIATIONSTACK_KEY=<real_key> node scripts/fetch-flights.js` writes a non-empty data.json with a non-zero flight_count.
2. Commit everything to a new GitHub repo.
3. Add `AVIATIONSTACK_KEY` secret; enable Pages on main/root.
4. Trigger workflow_dispatch. Confirm green run + new commit on main.
5. Visit `https://<user>.github.io/ajet-flights-dashboard/`. Confirm dashboard renders.
6. Wait for or trigger second run. Confirm Chart B appears.

## Notes / deviations

- **Unique flight tracking added to daily rows** (2026-06-29): The original PLAN.md daily schema only tracked aggregate snapshot counts (first/last/max/min). Added `unique_flight_numbers` (sorted array of deduplicated flight IATA codes across all snapshots for that day) and `unique_flights` (count of that array). The `upsertDaily()` function now merges flight numbers from each snapshot into the daily row's set. The frontend headline shows unique flights today rather than the raw snapshot count. Reason: the user wants total unique flights per day, not just per-snapshot counts.
