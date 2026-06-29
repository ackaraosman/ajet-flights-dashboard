# Tasks — AJET Flights Dashboard

Work through these in order. Each task has acceptance criteria; do not move on until the criteria pass.

## Task 1 — Repo scaffolding ✅
Files: `.gitignore`, `package.json`, `.nojekyll`
Acceptance:
- `node -v` ≥ 20
- `package.json` declares `"engines": {"node": ">=20"}` and a single `"fetch": "node scripts/fetch-flights.js"` script. No dependencies.
- `.gitignore` ignores `node_modules/`, `.DS_Store`, `*.log`, `data.json.tmp`.
- `.nojekyll` exists and is empty.

## Task 2 — Seed data.json ✅
Files: `data/data.json`
Acceptance:
- Valid v2 schema (see PLAN.md "data.json schema").
- meta.schema_version = 2, meta.last_run_status = "ok".
- Empty `daily` array.
- JSON is pretty-printed (2-space indent).

## Task 3 — Fetch script ✅
Files: `scripts/fetch-flights.js`
Acceptance:
- No `require()` of external packages; only `node:fs/promises`, `node:path`, `node:url`, built-in `fetch`.
- Reads DATA_PATH (env), falls back to `data/data.json`. Validates AVIATIONSTACK_KEY present.
- Uses `limit=1` — only needs `pagination.total`, not flight records.
- Upserts daily row by date_utc (update if exists, append if new).
- Atomic write: writes to `data.json.tmp` then renames.
- Console logs the date and flight count.
- On unrecoverable error: still writes data.json with meta.last_run_status="error" so the site renders; exit 1.

## Task 4 — Workflow file ✅
Files: `.github/workflows/fetch-flights.yml`
Acceptance:
- Single cron trigger at 22:00 UTC. Also workflow_dispatch.
- concurrency group set with cancel-in-progress: true.
- permissions: contents: write at workflow level.
- env: AVIATIONSTACK_KEY from secrets, DATA_PATH=data/data.json.
- Steps: checkout@v4, setup-node@v4 with node 20, run fetch script, git-auto-commit-action@v5 with commit_message ending in [skip ci] and file_pattern: data/data.json.

## Task 5 — Frontend dashboard ✅
Files: `index.html`
Acceptance:
- Single self-contained file (CSS + JS inline; CDN scripts allowed).
- Chart.js v4 loaded via jsDelivr CDN.
- Fetches `./data/data.json?_=${Date.now()}`.
- Renders: header, meta line (last run + days recorded), headline number (latest daily count), line chart (daily flight counts over time, hidden if <2 entries).
- Chart wrapper has explicit height.
- Chart options include responsive:true, maintainAspectRatio:false.
- Try/catch around fetch: on 404, parse error, network error → friendly message.
- If data.meta.last_run_status !== "ok" → visible warning banner with the error message.
- Includes <meta http-equiv="Cache-Control" content="no-cache"> in <head>.

## Task 6 — README ✅
Files: `README.md`
Acceptance:
- One-paragraph summary.
- Mentions: real-time only, 1 request/day at 22:00 UTC.
- Manual setup section: create repo, add secret, enable Pages, approve first workflow run.
- "How to run manually" section.
- "Project structure" section.

## Task 7 — End-to-end verification
Steps:
1. Local: `AVIATIONSTACK_KEY=<real_key> node scripts/fetch-flights.js` writes a non-empty data.json with a non-zero flight_count. ✅
2. Commit everything to a new GitHub repo.
3. Add `AVIATIONSTACK_KEY` secret; enable Pages on main/root.
4. Trigger workflow_dispatch. Confirm green run + new commit on main.
5. Visit `https://<user>.github.io/ajet-flights-dashboard/`. Confirm dashboard renders.
6. Wait for or trigger second run. Confirm line chart appears.

## Notes / deviations

- **v2 simplification (2026-06-29):** Stripped to bare essentials per user request. One API call/day at 22:00 UTC using `limit=1`. Only `pagination.total` is stored — no per-flight data, no origins, no status breakdowns, no unique tracking. The daily array is a simple time series of `{date_utc, flight_count}`.
