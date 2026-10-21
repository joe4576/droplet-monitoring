# Droplet monitoring

A React SPA and Cloudflare Worker that display DigitalOcean performance metrics for two Droplets. Built with TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, and TanStack Query. Wrangler manages the Worker and static assets as one deployment.

## Run locally

Use Node.js 24 or newer. A `.nvmrc` is included.

```sh
cd /Users/joe/Workspace/droplet-monitoring
nvm use
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your own values:

```dotenv
DIGITALOCEAN_API_TOKEN="your-personal-access-token"
DROPLET_IDS="first-droplet-id,second-droplet-id"
```

`DROPLET_IDS` must contain exactly two distinct positive numeric IDs, separated by a comma. Both values are Worker secrets. They never become `VITE_*` variables or appear in API responses. Local secret files are ignored by Git.

Start the SPA and Worker together:

```sh
npm run dev
```

Open <http://localhost:5173>. Without secrets, the page explains how to connect. Click **Preview demo**, or visit <http://localhost:5173/?demo=1>, to explore clearly labelled sample data. Demo mode runs in the browser and never replaces a failing live request automatically.

## DigitalOcean setup

Create a [Personal Access Token](https://cloud.digitalocean.com/account/api/tokens) with custom scopes:

- `monitoring:read`, for metric data.
- `droplet:read`, for names, regions, sizes, and power status.
- The dependencies required by those scopes: `regions:read`, `sizes:read`, `actions:read`, `image:read`, and `snapshot:read`.

See DigitalOcean's [token guide](https://docs.digitalocean.com/reference/api/create-personal-access-token/) and [monitoring scope reference](https://docs.digitalocean.com/reference/api/scopes/monitoring/read/).

Install and run [DigitalOcean's metrics agent](https://docs.digitalocean.com/products/monitoring/how-to/install-metrics-agent/) on both Droplets. The dashboard can only show historical data that DigitalOcean has collected. Installing the agent now does not backfill previous days.

## Dashboard

- CPU, memory, and root-disk charts for each Droplet, with latest, average, and peak usage.
- Shared date-range selector: 1 hour, 6 hours, 1 day, 7 days, or 14 days.
- Auto-refresh every 60 seconds, with a pause switch and manual refresh.
- Fleet overview showing the unweighted average of the two Droplets' latest percentages.
- Local timezone labels, hover tooltips, reporting-gap indicators, and responsive mobile layouts.
- Independent chart failures: a missing memory metric does not hide CPU or disk data.

## How metrics are calculated

The browser requests `GET /api/metrics?range=1h`. Only the five documented ranges are accepted. The Worker always queries the two configured IDs; clients cannot select arbitrary IDs or upstream URLs.

The Worker uses DigitalOcean's [Monitoring API](https://docs.digitalocean.com/products/monitoring/reference/api/) and performs these calculations:

- **CPU:** calculates deltas of cumulative counters and uses `100 × (total delta − idle delta) / total delta`, normalized across all vCPUs. Guest counters are excluded because they are already included in user/nice counters. A counter reset or mismatched sample interval leaves a gap.
- **Memory:** `100 × (total − free − cached) / total`, matching DigitalOcean's documented usage calculation.
- **Disk:** `100 × (filesystem size − filesystem free) / filesystem size` for the `/` mount and matching device. Attached volumes and other mounts are excluded.

See [DigitalOcean's metric definitions](https://docs.digitalocean.com/products/monitoring/concepts/metrics/). Missing samples remain gaps, never artificial zeros. Samples more than five minutes behind the query end show a delayed-telemetry note. Long series are reduced to at most 360 chart points with bucket averages; headline latest, average, and peak values use the original samples. Average usage is the arithmetic mean of reported samples.

A complete refresh makes 14 upstream requests: six metric endpoints and one metadata endpoint for each Droplet. Successful results are cached inside the Worker for up to 55 seconds per region, range, minute, and secret configuration. Browser responses use `Cache-Control: no-store`. Upstream calls time out after 20 seconds and have bounded response bodies. The app requires no database or scheduled collector.

## Deploy to Cloudflare

The Worker is named `droplet-monitoring`. To configure the target account and its encrypted secrets:

```sh
npx wrangler login
npx wrangler secret put DIGITALOCEAN_API_TOKEN
npx wrangler secret put DROPLET_IDS
npm run deploy
```

Enter secret values at Wrangler's interactive prompts. Local `.dev.vars` values are not uploaded automatically. Wrangler validates that both required secrets exist before deployment. If Wrangler offers to create the Worker when adding the first secret, use the `droplet-monitoring` Worker name. The application has been created locally; no remote Worker has been deployed.

Wrangler serves the React build as Worker static assets, with SPA fallback for client routes and Worker-first handling of `/api/*`. Unknown API routes return JSON 404 responses. Worker logs and sampled traces are enabled. The compatibility date is `2026-10-19`, the newest supported by the workerd binary bundled with the installed Wrangler release when this project was created.

The project does not implement application login. For a private deployment, protect the hostname with Cloudflare Access.

## Development commands

```sh
npm run dev           # React HMR and local Worker runtime
npm run check         # TypeScript, ESLint, Prettier, and unit/API tests
npm run build         # Type-check and build client + Worker
npm run preview       # Build and serve the production output locally
npm run cf-typegen    # Regenerate Worker environment/runtime types
npm run format        # Format source files
npm run deploy        # Build and deploy using Wrangler
```

`npm ci` generates Worker types through the postinstall script. Rerun `cf-typegen` after changing bindings or required secret names. The test suite covers CPU counter resets, memory and filesystem calculations, missing data, long-range downsampling, all five date ranges, credential redaction, partial upstream failures, input validation, and cache isolation. Tests use API fixtures; live DigitalOcean calls require your secrets.

## Project layout

```text
src/                     React dashboard
  components/ui/         shadcn/ui source components
  components/            Metric charts
  lib/                   API client, formatters, and opt-in demo data
worker/                  API handler and DigitalOcean integration
shared/                  Client/server types and supported ranges
wrangler.jsonc           Worker, static assets, required secrets, observability
.dev.vars.example        Local secret template
```
