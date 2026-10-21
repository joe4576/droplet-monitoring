import {
  isTimeRange,
  TIME_RANGES,
  type DashboardResponse,
} from '../shared/types'
import { loadDroplet } from './digitalocean'

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers })
}

export function configuredIds(
  value: string | undefined,
): [string, string] | null {
  const ids = value?.split(',').map((id) => id.trim()) ?? []
  return ids.length === 2 &&
    ids.every((id) => /^[1-9]\d*$/.test(id)) &&
    ids[0] !== ids[1]
    ? [ids[0], ids[1]]
    : null
}

async function metrics(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  const range = url.searchParams.get('range') ?? '1h'
  if (!isTimeRange(range))
    return json(
      {
        code: 'invalid_range',
        message: 'Choose a supported date range: 1h, 6h, 1d, 7d, or 14d.',
      },
      400,
    )

  const ids = configuredIds(env.DROPLET_IDS)
  const token = env.DIGITALOCEAN_API_TOKEN?.trim()
  if (!token || token === 'replace-with-your-personal-access-token' || !ids) {
    return json(
      {
        code: 'not_configured',
        message:
          'Add your DigitalOcean API token and two Droplet IDs to the Worker secrets to connect live metrics.',
      },
      503,
    )
  }

  // Round to the minute to share requests and avoid repeated upstream calls.
  const end = Math.floor(Date.now() / 60_000) * 60
  const start = end - TIME_RANGES[range].seconds
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${token}:${ids.join(',')}`),
  )
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const key = new Request(
    `${url.origin}/__metrics-cache/${fingerprint}/${range}/${end}`,
  )
  const cache = await caches.open('droplet-metrics-v1')
  const cached = await cache.match(key)
  if (cached)
    return new Response(cached.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    })

  const droplets = await Promise.all(
    ids.map((id, slot) => loadDroplet(id, slot, token, start, end)),
  )
  const body: DashboardResponse = {
    droplets,
    range,
    start,
    end,
    fetchedAt: Math.floor(Date.now() / 1000),
  }
  const response = json(body)
  // Retain only successful results. Rate limits or failed requests can recover immediately.
  if (
    droplets.every(
      (droplet) =>
        !droplet.issue &&
        Object.values(droplet.metrics).every((metric) => !metric.error),
    )
  ) {
    const stored = response.clone()
    stored.headers.set('Cache-Control', 'public, max-age=55')
    ctx.waitUntil(cache.put(key, stored))
  }
  return response
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET')
        return new Response(null, {
          status: 405,
          headers: { ...headers, Allow: 'GET' },
        })
      if (url.pathname !== '/api/metrics')
        return json({ code: 'not_found', message: 'API route not found.' }, 404)
      try {
        return await metrics(request, env, ctx)
      } catch {
        console.error(JSON.stringify({ event: 'metrics_request_failed' }))
        return json(
          {
            code: 'internal_error',
            message: 'Metrics could not be loaded. Try again shortly.',
          },
          500,
        )
      }
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
