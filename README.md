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
AUTH_API_KEY="a-separate-long-random-dashboard-login-key"
```

`DROPLET_IDS` must contain exactly two distinct positive numeric IDs, separated by a comma. All three values are Worker secrets. They never become `VITE_*` variables or appear in API responses. Local secret files are ignored by Git. If you already have `.dev.vars`, add `AUTH_API_KEY` to it without replacing your DigitalOcean credentials. Generate a login key with `openssl rand -hex 32`.

Initialize the local D1 session database:

```sh
npm run db:migrate
```

Start the SPA and Worker together:

```sh
npm run dev
```

Open <http://localhost:5173>. You are redirected to `/login`; sign in using `AUTH_API_KEY`. If it is missing, sign-in stays disabled and every protected request is refused. After signing in, missing DigitalOcean credentials produce a setup notice. Click **Preview demo**, or visit <http://localhost:5173/?demo=1>, to explore clearly labelled sample data. Demo mode also requires authentication and never replaces a failing live request automatically.

## Authentication

The Worker checks the D1 session before every page, API, or static-asset request. Only `GET /login`, `HEAD /login`, `POST /login`, and `POST /api/auth/login` are public. The login page is self-contained HTML and CSS, so application bundles, styles, fonts, and icons do not need public exceptions. Wrangler uses `assets.run_worker_first: true` to enforce this before asset serving.

After a correct API key is submitted, the Worker generates a fresh random 256-bit session token and returns an HttpOnly, SameSite=Strict cookie. HTTPS uses a Secure `__Host-droplet_session` cookie. Local HTTP development on localhost uses a separate `droplet_session` cookie. Non-local HTTP requests must use HTTPS.

D1 stores only the SHA-256 session-token hash, the login-key hash, and creation/expiry timestamps. Sessions expire after 12 hours. **Sign out** deletes the session before clearing the cookie; replaying its old cookie fails. Changing `AUTH_API_KEY` invalidates all existing sessions. Login/logout POSTs require a matching Origin, and D1 limits sign-in to 10 attempts per client IP per 10-minute window. Client IPs are stored only as salted hashes. Expired sessions and old sign-in attempts are cleaned up during sign-in.

API requests without a valid session return JSON 401 responses. Page navigations redirect to `/login`; an expired session during metric refresh also returns the browser to login. Protected responses use `Cache-Control: no-store` and `Vary: Cookie`. D1 errors fail closed.

Programmatic sign-in uses `POST /api/auth/login` with `Content-Type: application/json`, an `Origin` matching the deployment origin, and a JSON body containing `apiKey`. Save the returned cookie and include it on subsequent requests. `GET /api/auth/session` returns the authenticated session expiry. `POST /api/auth/logout` revokes the session and redirects to login.

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

A complete refresh makes 14 upstream requests: six metric endpoints and one metadata endpoint for each Droplet. Successful results are cached inside the Worker for up to 55 seconds per region, range, minute, and secret configuration. Authentication runs before reading this cache. Browser responses use `Cache-Control: no-store`. Upstream calls time out after 20 seconds and have bounded response bodies. Metrics need no database or scheduled collector; D1 stores authentication sessions only.

## Deploy to Cloudflare

The Worker is named `droplet-monitoring`. To configure the target account and its encrypted secrets:

```sh
npx wrangler login
npx wrangler d1 create droplet-monitoring-sessions --binding SESSIONS_DB --update-config --config wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put DIGITALOCEAN_API_TOKEN
npx wrangler secret put DROPLET_IDS
npx wrangler secret put AUTH_API_KEY
npm run deploy
```

Create the remote D1 database once. Wrangler adds its `database_id` to the `SESSIONS_DB` binding; keep that ID in `wrangler.jsonc`. For an existing database, configure its ID and run only the migration command. Local migrations do not update the remote database. Remote D1 creation, migrations, secret updates, and deployment have not been run as part of local implementation.

Enter secret values at Wrangler's interactive prompts. Local `.dev.vars` values are not uploaded automatically. Wrangler validates that all three required secrets exist before deployment. If Wrangler offers to create the Worker when adding the first secret, use the `droplet-monitoring` Worker name.

Wrangler serves the React build as Worker static assets, with SPA fallback for client routes and Worker-first authentication for every request. Unknown API routes return JSON 404 responses after authentication. Worker logs and sampled traces are enabled. The compatibility date is `2026-10-19`, the newest supported by the workerd binary bundled with the installed Wrangler release when this project was created.

## Development commands

```sh
npm run dev           # React HMR and local Worker runtime
npm run check         # TypeScript, ESLint, Prettier, and unit/API tests
npm run build         # Type-check and build client + Worker
npm run preview       # Build and serve the production output locally
npm run cf-typegen    # Regenerate Worker environment/runtime types
npm run db:migrate    # Apply session migrations to local D1
npm run db:migrate:remote # Apply session migrations to remote D1
npm run format        # Format source files
npm run deploy        # Build and deploy using Wrangler
```

`npm ci` generates Worker types through the postinstall script. Rerun `cf-typegen` after changing bindings or required secret names. The test suite covers metric calculations, missing data, all date ranges, upstream failures, cache isolation, and the authentication boundary. Authentication tests run inside workerd with a real isolated D1 database and cover cookie issuance, expiry, key rotation, logout revocation, forgery, cross-origin submissions, rate limits, and denied access to assets and cached metrics. Tests use fixture credentials and never change your local secrets.

## Project layout

```text
src/                     React dashboard
  components/ui/         shadcn/ui source components
  components/            Metric charts
  lib/                   API client, formatters, and opt-in demo data
worker/                  API handler and DigitalOcean integration
  routes/                Hono routes, request validation, and HTTP responses
  services/              Authentication, metric loading, and calculations
  repositories/          D1 sessions and login-attempt queries
  clients/               DigitalOcean HTTP requests
  testing/               Worker-runtime test bundling
migrations/              D1 session and login-attempt schema
shared/                  Zod schemas, inferred client/server types, and ranges
wrangler.jsonc           Worker, static assets, required secrets, observability
.dev.vars.example        Local secret template
```

Hono middleware creates services for each request. `AuthService` receives the D1 database instance and uses `SessionRepository` for all SQL. Routes handle HTTP input and output; services return typed data. The React API client validates responses with the same Zod schemas that define the shared types.

Use `const` arrow functions for standalone functions. Services are classes with explicit `public` or `private` methods and return types. Use `async` only when asynchronous work requires it; in-memory calculations and validation stay synchronous. `CryptoService` provides static methods. Extract service helpers into private methods rather than defining functions or callbacks inside methods. Name methods after their result, such as `getMetricsByDropletId`, `getSessionByToken`, and `getDashboardByTimeRange`.

Run independent async operations together with `Promise.all`. Await dependent operations in order. Use `Promise.allSettled` when upstream failures must preserve partial results and every request must finish.

Functions that need multiple inputs take one options object, with alphabetically ordered keys. Framework callbacks keep their required signatures. Group short, logically related declarations and assignments. Keep blank lines around multiline statements and between larger class members. ESLint enforces these conventions and braces for control flow.
