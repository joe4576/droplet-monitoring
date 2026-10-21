import {
  isTimeRange,
  TIME_RANGES,
  type DashboardResponse,
} from '../shared/types'
import { loadDroplet } from './digitalocean'
import {
  authConfigured,
  getSession,
  login,
  logout,
  sessionCookie,
} from './auth'
import { loginPage } from './login'
import { json, privateResponse, redirect } from './http'

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
    return privateResponse(
      new Response(cached.body, {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

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
    if (
      url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return json(
          {
            code: 'https_required',
            message: 'Use HTTPS to sign in and access the dashboard.',
          },
          400,
        )
      url.protocol = 'https:'
      return privateResponse(
        new Response(null, { status: 308, headers: { Location: url.href } }),
      )
    }
    const methodNotAllowed = (allow: string) =>
      json(
        { code: 'method_not_allowed', message: 'Method not allowed.' },
        405,
        { Allow: allow },
      )
    try {
      // Only the self-contained login page and its submission endpoints are public.
      if (url.pathname === '/login') {
        if (request.method === 'POST') return await login(request, env)
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return methodNotAllowed('GET, HEAD, POST')
        if (authConfigured(env) && (await getSession(request, env)))
          return redirect('/')
        const response = authConfigured(env)
          ? loginPage()
          : loginPage(
              'Sign-in is not configured. Add AUTH_API_KEY to the Worker secrets.',
              503,
              true,
            )
        response.headers.set('Set-Cookie', sessionCookie(request))
        return request.method === 'HEAD'
          ? new Response(null, response)
          : response
      }
      if (url.pathname === '/api/auth/login')
        return request.method === 'POST'
          ? await login(request, env)
          : methodNotAllowed('POST')

      if (!authConfigured(env))
        return url.pathname.startsWith('/api/')
          ? json(
              {
                code: 'auth_not_configured',
                message: 'Sign-in is not configured.',
              },
              503,
            )
          : redirect('/login', sessionCookie(request))
      const session = await getSession(request, env)
      if (!session) {
        const page =
          (request.method === 'GET' || request.method === 'HEAD') &&
          !url.pathname.startsWith('/api/') &&
          (request.headers.get('Accept')?.includes('text/html') ||
            !url.pathname.split('/').at(-1)?.includes('.'))
        return page
          ? redirect('/login', sessionCookie(request))
          : json(
              { code: 'unauthorized', message: 'Sign in to continue.' },
              401,
              { 'Set-Cookie': sessionCookie(request) },
            )
      }
      if (url.pathname === '/api/auth/logout')
        return request.method === 'POST'
          ? await logout(request, env, session)
          : methodNotAllowed('POST')
      if (url.pathname === '/api/auth/session')
        return request.method === 'GET'
          ? json({ authenticated: true, expiresAt: session.expiresAt })
          : methodNotAllowed('GET')
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET') return methodNotAllowed('GET')
        if (url.pathname !== '/api/metrics')
          return json(
            { code: 'not_found', message: 'API route not found.' },
            404,
          )
        return await metrics(request, env, ctx)
      }
      // This includes HTML, JavaScript, CSS, fonts, icons, and SPA fallback paths.
      return privateResponse(await env.ASSETS.fetch(request))
    } catch {
      console.error(JSON.stringify({ event: 'request_failed' }))
      return url.pathname === '/login'
        ? loginPage(
            'Sign-in is temporarily unavailable. Check the session database migrations and try again.',
            503,
            true,
          )
        : json(
            {
              code: 'service_unavailable',
              message:
                'The request could not be completed. Check the session database and try again.',
            },
            503,
          )
    }
  },
} satisfies ExportedHandler<Env>
