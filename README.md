# AJET Flights Dashboard

Static dashboard tracking the daily flight count of **AJET** (Turkish low-cost carrier, IATA `VF`, formerly AnadoluJet). One API call per day at 22:00 UTC records the total flight count, committed to this repo and served via GitHub Pages.

> **Important:** AviationStack's free plan is **real-time only** — no historical queries. The dashboard records the total flight count at each daily snapshot, building a time series over time.
>
> **API budget:** 1 request/day. The workflow uses a single cron slot at 22:00 UTC.

## Project structure

| File / Folder | Purpose |
| --- | --- |
| `index.html` | Static dashboard (Chart.js v4 via CDN). |
| `scripts/fetch-flights.js` | Node 20 fetch script. No external deps. |
| `data/data.json` | Daily time series. Committed each run. |
| `.github/workflows/fetch-flights.yml` | Scheduled + manual-trigger GitHub Action. |
| `.nojekyll` | Disables GitHub Pages Jekyll processing. |
| `.gitignore` | Standard Node ignores plus `data.json.tmp`. |
| `package.json` | `npm run fetch` → runs the Node script. |
| `PLAN.md` | Full architecture spec. |
| `TASKS.md` | Ordered task checklist. |

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
4. **Approve the first workflow run** when GitHub prompts.
5. (Optional) Trigger a first run manually:
   Actions → "Fetch AJET flights" → Run workflow.

## How to run manually

1. Go to the **Actions** tab.
2. Select **"Fetch AJET flights"** on the left.
3. Click **"Run workflow"** → **"Run workflow"**.

The workflow will run `scripts/fetch-flights.js`, commit the updated `data/data.json`, and GitHub Pages will deploy within ~1 minute.

## Local development

Requires Node ≥ 20 (no npm packages to install).

```bash
export AVIATIONSTACK_KEY=<your_key>
export DATA_PATH=data/data.json
npm run fetch
# or: node scripts/fetch-flights.js
```

Open `index.html` in a browser to view the dashboard locally.

## Cron schedule (UTC)

| Time | Cron | Notes |
| --- | --- | --- |
| 22:00 | `0 22 * * *` | Single daily snapshot of total AJET flight count. |

GitHub-hosted cron may fire 5–15 minutes late; this is normal.

## Failure handling

If a fetch fails, the workflow still commits a stub `data/data.json` with `meta.last_run_status = "error"`. The dashboard detects this and displays a warning banner.

## License

MIT.
