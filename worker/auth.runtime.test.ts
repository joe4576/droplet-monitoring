import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import {
  Miniflare,
  Response as RuntimeResponse,
  convertV4MiniflareOptions,
  type V4ModuleDefinition,
} from 'miniflare'
import ts from 'typescript'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const key = 'a-long-random-fixture-dashboard-key'
const origin = 'https://monitor.test'
let mf: Miniflare
let db: Awaited<ReturnType<Miniflare['getD1Database']>>
let assetRequests = 0
let upstreamRequests = 0

const request = (
  path: string,
  init: Parameters<Miniflare['dispatchFetch']>[1] = {},
) => mf.dispatchFetch(`${origin}${path}`, { ...init, redirect: 'manual' })
async function signIn(apiKey = key, extraHeaders: Record<string, string> = {}) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ apiKey }),
  })
}
const cookieOf = (response: {
  headers: { get(name: string): string | null }
}) => response.headers.get('Set-Cookie')?.split(';')[0] ?? ''

beforeAll(async () => {
  const modules: V4ModuleDefinition[] = []
  for (const relative of [
    './index',
    './auth',
    './login',
    './http',
    './digitalocean',
    './metrics',
    '../shared/types',
  ]) {
    const source = await readFile(
      new NodeURL(`${relative}.ts`, import.meta.url),
      'utf8',
    )
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
      },
    })
    modules.push({
      type: 'ESModule',
      path: fileURLToPath(new NodeURL(`${relative}.js`, import.meta.url)),
      contents: outputText.replace(
        /(['"])(\.\.?\/[^'"]+)\1/g,
        (_match, quote: string, specifier: string) =>
          `${quote}${specifier}.js${quote}`,
      ),
    })
  }
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'auth-runtime-test',
      modules,
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      bindings: {
        AUTH_API_KEY: key,
        DIGITALOCEAN_API_TOKEN: 'fixture-digitalocean-token',
        DROPLET_IDS: '123456789,987654321',
      },
      d1Databases: ['SESSIONS_DB'],
      serviceBindings: {
        ASSETS: () => {
          assetRequests++
          return new RuntimeResponse('<h1>Protected dashboard</h1>', {
            headers: {
              'Content-Type': 'text/html',
              'Cache-Control': 'public, max-age=31536000',
            },
          })
        },
      },
      outboundService: (req) => {
        upstreamRequests++
        const url = new URL(req.url)
        if (url.pathname.includes('/droplets/'))
          return RuntimeResponse.json({
            droplet: {
              name: 'production',
              region: { slug: 'lon1' },
              vcpus: 2,
              memory: 4096,
              disk: 80,
              status: 'active',
            },
          })
        const name = url.pathname.split('/').at(-1)
        const end = Number(url.searchParams.get('end'))
        const series = (value: number, labels = {}) => ({
          metric: labels,
          values: [
            [end - 60, value],
            [end, value],
          ],
        })
        const result =
          name === 'cpu'
            ? [
                {
                  metric: { mode: 'idle' },
                  values: [
                    [end - 60, 800],
                    [end, 890],
                  ],
                },
                {
                  metric: { mode: 'user' },
                  values: [
                    [end - 60, 200],
                    [end, 230],
                  ],
                },
              ]
            : [
                series(
                  name?.endsWith('total') || name?.endsWith('size')
                    ? 1000
                    : 100,
                  { mountpoint: '/', device: '/dev/vda1' },
                ),
              ]
        return RuntimeResponse.json({ status: 'success', data: { result } })
      },
    }),
  )
  db = await mf.getD1Database('SESSIONS_DB')
  const schema = await readFile(
    new NodeURL('../migrations/0001_auth.sql', import.meta.url),
    'utf8',
  )
  for (const statement of schema
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean))
    await db.prepare(statement).run()
}, 15_000)

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM sessions'),
    db.prepare('DELETE FROM login_attempts'),
  ])
  assetRequests = 0
  upstreamRequests = 0
})
afterAll(async () => {
  await mf?.dispose()
})

describe('authentication boundary', () => {
  it('fails closed when the session database is unavailable', async () => {
    const cookie = cookieOf(await signIn())
    await db
      .prepare('ALTER TABLE sessions RENAME TO sessions_unavailable')
      .run()
    try {
      const response = await request('/assets/index.js', {
        headers: { Cookie: cookie },
      })
      expect(response.status).toBe(503)
      expect(assetRequests).toBe(0)
      expect(upstreamRequests).toBe(0)
    } finally {
      await db
        .prepare('ALTER TABLE sessions_unavailable RENAME TO sessions')
        .run()
    }
  })
  it('uses a localhost cookie for local HTTP development and requires HTTPS elsewhere', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/auth/login', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: key }),
    })
    expect(response.status).toBe(200)
    expect(cookieOf(response)).toMatch(/^droplet_session=[a-f0-9]{64}$/)
    expect(response.headers.get('Set-Cookie')).not.toContain('; Secure')
    expect(
      (await mf.dispatchFetch('http://monitor.test/', { redirect: 'manual' }))
        .status,
    ).toBe(308)
    expect(
      (
        await mf.dispatchFetch('http://monitor.test/login', {
          method: 'POST',
          redirect: 'manual',
        })
      ).status,
    ).toBe(400)
  })
  it('serves a self-contained login page without exposing any dashboard asset', async () => {
    const response = await request('/login')
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('Welcome back')
    expect(html).not.toContain('<script')
    expect(html).not.toContain(key)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(assetRequests).toBe(0)
  })
  it.each(['/', '/insights', '/?demo=1', '/__metrics-cache/fake/1h/123'])(
    'redirects an anonymous page request for %s to login',
    async (path) => {
      const response = await request(path)
      expect(response.status).toBe(303)
      expect(response.headers.get('Location')).toBe('/login')
      expect(assetRequests).toBe(0)
      expect(upstreamRequests).toBe(0)
    },
  )
  it.each([
    '/api/metrics?range=1h',
    '/api/auth/session',
    '/api/unknown',
    '/assets/index.js',
    '/favicon.svg',
  ])('blocks anonymous requests for %s', async (path) => {
    expect((await request(path)).status).toBe(401)
    expect(assetRequests).toBe(0)
    expect(upstreamRequests).toBe(0)
  })
  it('rejects incorrect keys without creating a session', async () => {
    expect((await signIn('wrong')).status).toBe(401)
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM sessions').first('count'),
    ).toBe(0)
  })
  it('issues a random secure cookie, stores only its hash, and protects cached assets', async () => {
    const login = await signIn()
    const cookie = cookieOf(login)
    expect(login.status).toBe(200)
    expect(cookie).toMatch(/^__Host-droplet_session=[a-f0-9]{64}$/)
    for (const flag of [
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=43200',
    ])
      expect(login.headers.get('Set-Cookie')).toContain(flag)
    const body = await login.text()
    expect(body).not.toContain(key)
    expect(body).not.toContain(cookie.split('=')[1])
    const row = await db
      .prepare('SELECT token_hash, key_hash FROM sessions')
      .first<{ token_hash: string; key_hash: string }>()
    expect(row?.token_hash).toHaveLength(64)
    expect(row?.token_hash).not.toBe(cookie.split('=')[1])
    expect(row?.key_hash).not.toBe(key)
    const response = await request('/assets/index.js', {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toContain('Cookie')
    expect(assetRequests).toBe(1)
  })
  it('allows authenticated metrics, then refuses the cached result without a session', async () => {
    const cookie = cookieOf(await signIn())
    const response = await request('/api/metrics', {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"current":25')
    const count = upstreamRequests
    expect(count).toBe(14)
    expect((await request('/api/metrics')).status).toBe(401)
    expect(upstreamRequests).toBe(count)
  })
  it('accepts the login form and redirects without putting credentials in the URL', async () => {
    const response = await request('/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ apiKey: key }).toString(),
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/')
    expect(cookieOf(response)).toContain('__Host-droplet_session=')
  })
  it('revokes the session on logout and rejects replay of its cookie', async () => {
    const cookie = cookieOf(await signIn())
    const response = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      (await request('/api/auth/session', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401)
  })
  it('rejects expired, forged, duplicate, and revoked sessions', async () => {
    const cookie = cookieOf(await signIn())
    expect(
      (
        await request('/api/auth/session', {
          headers: { Cookie: `${cookie}; ${cookie}` },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await request('/api/auth/session', {
          headers: { Cookie: `__Host-droplet_session=${'f'.repeat(64)}` },
        })
      ).status,
    ).toBe(401)
    await db.prepare('UPDATE sessions SET created_at = 0, expires_at = 1').run()
    expect(
      (await request('/api/auth/session', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401)
  })
  it('rejects sessions associated with an old login key', async () => {
    const cookie = cookieOf(await signIn())
    await db.prepare("UPDATE sessions SET key_hash = 'old-key-hash'").run()
    expect(
      (await request('/api/auth/session', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401)
  })
  it('rejects cross-origin login and logout attempts', async () => {
    expect((await signIn(key, { Origin: 'https://other.test' })).status).toBe(
      403,
    )
    const cookie = cookieOf(await signIn())
    expect(
      (
        await request('/api/auth/logout', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://other.test' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await request('/api/auth/session', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(200)
  })
  it('rate limits repeated sign-in attempts in D1', async () => {
    for (let i = 0; i < 10; i++)
      expect((await signIn('wrong')).status).toBe(401)
    const response = await signIn()
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('600')
  })
  it('rejects oversized sign-in bodies', async () => {
    const response = await request('/api/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'x'.repeat(5000) }),
    })
    expect(response.status).toBe(413)
  })
})
