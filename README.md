# AJET Flights Dashboard

Static dashboard that shows a snapshot of currently-airborne **AJET** flights (Turkish low-cost carrier, IATA `VF`, formerly AnadoluJet). The data is fetched twice daily by a GitHub Action that calls the AviationStack real-time API and committed back to this repo. GitHub Pages serves the dashboard from the repo root.

> **Important constraint:** AviationStack's free plan is **real-time only** — no historical `flight_date` queries. The dashboard shows *snapshot counts* (active/scheduled/landed flights at the moment of fetch), not a true "daily total." The headline number reads as "snapshot flights" rather than "today's total."
>
> **API budget:** 3 requests/day on the free plan. The workflow uses 2 cron slots (10:00 UTC + 22:00 UTC) and reserves the 3rd as a manual buffer.

## Project structure

| File / Folder | Purpose |
| --- | --- |
| `index.html` | Static dashboard (Chart.js v4 via CDN). |
| `scripts/fetch-flights.js` | Node 20 fetch script. No external deps. |
| `data/data.json` | Generated snapshot store. Committed each run. |
| `.github/workflows/fetch-flights.yml` | Scheduled + manual-trigger GitHub Action. |
| `.nojekyll` | Disables GitHub Pages Jekyll processing. |
| `.gitignore` | Standard Node ignores plus `data.json.tmp`. |
| `package.json` | `npm run fetch` → runs the Node script. |
| `PLAN.md` | Full architecture spec (for future LLMs / handoff). |
| `TASKS.md` | Ordered checklist for the implementation LLM. |

## Manual setup (one-time)

1. **Create a public GitHub repo** named `ajet-flights-dashboard`.
2. **Add the API key as a repository secret**:
   Settings → Secrets and variables → Actions → New repository secret.
   - Name: `AVIATIONSTACK_KEY`
   - Value: your AviationStack access key from <https://aviationstack.com/dashboard>.
3. **Enable GitHub Pages**:
   Settings → Pages → Build and deployment →
   - Source: *Deploy from a branch*
   - Branch: `main`, Folder: `/ (root)`.
4. **Approve the first workflow run** when GitHub prompts (one-time security confirmation the first time `.github/workflows/` is added).
5. (Optional) Trigger a first run manually:
   Actions → "Fetch AJET flights" → Run workflow → Run workflow.

## How to run manually

The cron jobs use 2 of your 3 daily API calls. To use the 3rd call as a buffer (e.g., when you want fresher data):

1. Go to the **Actions** tab.
2. Select **"Fetch AJET flights"** on the left.
3. Click **"Run workflow"** → **"Run workflow"** (green button).

The workflow will:
- Run `scripts/fetch-flights.js` with the secret as `AVIATIONSTACK_KEY`.
- Commit the updated `data/data.json` (commit message contains `[skip ci]` to prevent loops).
- Within ~1 minute, GitHub Pages will deploy the new dashboard.

## Local development

Requires Node ≥ 20 (no npm packages to install).

```bash
export AVIATIONSTACK_KEY=<your_key>
export DATA_PATH=data/data.json
npm run fetch
# or: node scripts/fetch-flights.js
```

Open `index.html` in a browser to view the dashboard locally. The frontend fetches `./data/data.json` relative to the page.

## Cron schedule (UTC)

| Time | Cron | Notes |
| --- | --- | --- |
| 10:00 | `0 10 * * *` | Captures AJET mid-morning European operations. |
| 22:00 | `0 22 * * *` | Captures end-of-day and early next-day rotations. |

GitHub-hosted cron may fire 5–15 minutes late; this is normal.

## Failure handling

If a fetch fails, the workflow still commits a stub `data/data.json` with `meta.last_run_status = "error"` and the error message in `meta.last_run_error`. The dashboard detects this and displays a yellow warning banner so the previous snapshot remains visible.

## Out of scope (v1)

- Historical `flight_date` queries (AviationStack free plan does not support them).
- Per-flight detail pages or drill-down.
- Multi-airline support.
- Local-time conversion (everything shown is UTC).
- Aircraft/registration information.
- Status filter UI.
- Client-side polling.

## License

MIT.
