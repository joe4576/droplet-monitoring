import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { configuredIds } from './index'
import { TIME_RANGES, type DashboardResponse } from '../shared/types'

const ids = ['123456789', '987654321']
const env = {
  DIGITALOCEAN_API_TOKEN: 'test-secret-token',
  DROPLET_IDS: ids.join(','),
  ASSETS: {
    fetch: vi.fn(() => Promise.resolve(new Response('app'))),
    connect: vi.fn(),
  },
} satisfies Env
let pending: Promise<unknown>[]
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    pending.push(promise)
  },
  passThroughOnException() {},
  props: {},
} as ExecutionContext
let cached: Map<string, Response>

function upstream(input: string | URL | Request): Promise<Response> {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  )
  if (/\/droplets\/\d+$/.test(url.pathname))
    return Promise.resolve(
      Response.json({
        droplet: {
          id: Number(url.pathname.split('/').at(-1)),
          name: 'production',
          region: { slug: 'lon1' },
          memory: 4096,
          vcpus: 2,
          disk: 80,
          status: 'active',
          networks: { private: 'sensitive' },
        },
      }),
    )
  const end = Number(url.searchParams.get('end'))
  const metric = url.pathname.split('/').at(-1)
  const make = (
    values: [number, number][],
    labels: Record<string, string> = {},
  ) => ({
    metric: { host_id: url.searchParams.get('host_id'), ...labels },
    values,
  })
  const values =
    metric === 'cpu'
      ? [
          make(
            [
              [end - 60, 100],
              [end, 190],
            ],
            { mode: 'idle' },
          ),
          make(
            [
              [end - 60, 0],
              [end, 30],
            ],
            { mode: 'user' },
          ),
        ]
      : [
          make(
            [
              [
                end - 60,
                metric?.endsWith('total') || metric?.endsWith('size')
                  ? 1000
                  : 100,
              ],
              [
                end,
                metric?.endsWith('total') || metric?.endsWith('size')
                  ? 1000
                  : 100,
              ],
            ],
            { mountpoint: '/', device: '/dev/vda1' },
          ),
        ]
  return Promise.resolve(
    Response.json({ status: 'success', data: { result: values } }),
  )
}

beforeEach(() => {
  pending = []
  cached = new Map()
  vi.stubGlobal('fetch', vi.fn(upstream))
  vi.stubGlobal('caches', {
    open: vi.fn(async () => ({
      match: async (request: Request) => cached.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        cached.set(request.url, response.clone())
      },
    })),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Worker API', () => {
  it.each(Object.keys(TIME_RANGES))(
    'fetches both configured droplets for %s and hides credentials and IDs',
    async (range) => {
      const response = await worker.fetch(
        new Request(`https://monitor.test/api/metrics?range=${range}`),
        env,
        ctx,
      )
      const body = await response.text()
      const data = JSON.parse(body) as DashboardResponse
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(data.droplets).toHaveLength(2)
      expect(data.end - data.start).toBe(TIME_RANGES[data.range].seconds)
      expect(data.droplets[0].metrics.cpu.current).toBeCloseTo(25)
      expect(data.droplets[0].metrics.memory.current).toBe(80)
      expect(data.droplets[0].metrics.disk.current).toBe(90)
      for (const secret of [
        ...ids,
        env.DIGITALOCEAN_API_TOKEN,
        'sensitive',
        'host_id',
      ])
        expect(body).not.toContain(secret)
      expect(fetch).toHaveBeenCalledTimes(14)
      await Promise.all(pending)
    },
  )
  it('returns a setup error with no upstream traffic when secrets are missing', async () => {
    const response = await worker.fetch(
      new Request('https://monitor.test/api/metrics'),
      { ...env, DIGITALOCEAN_API_TOKEN: '' },
      ctx,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'not_configured' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects unsupported ranges and unknown API routes instead of serving SPA HTML', async () => {
    expect(
      (
        await worker.fetch(
          new Request('https://monitor.test/api/metrics?range=30d'),
          env,
          ctx,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await worker.fetch(
          new Request('https://monitor.test/api/unknown'),
          env,
          ctx,
        )
      ).status,
    ).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects writes', async () => {
    expect(
      (
        await worker.fetch(
          new Request('https://monitor.test/api/metrics', { method: 'POST' }),
          env,
          ctx,
        )
      ).status,
    ).toBe(405)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps other charts available when a metric is rate limited and hides upstream bodies', async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes('/cpu?')
        ? Promise.resolve(
            new Response('secret upstream detail', { status: 429 }),
          )
        : upstream(input),
    )
    const response = await worker.fetch(
      new Request('https://monitor.test/api/metrics'),
      env,
      ctx,
    )
    const body = await response.text()
    const data = JSON.parse(body) as DashboardResponse
    expect(data.droplets[0].metrics.cpu.current).toBeNull()
    expect(data.droplets[0].metrics.cpu.error).toContain('rate limit')
    expect(data.droplets[0].metrics.memory.current).toBe(80)
    expect(body).not.toContain('secret upstream detail')
    expect(cached.size).toBe(0)
  })
  it('reuses successful cached results and isolates cache entries after a token change', async () => {
    const request = new Request('https://monitor.test/api/metrics')
    await worker.fetch(request, env, ctx)
    await Promise.all(pending)
    vi.mocked(fetch).mockClear()
    expect((await worker.fetch(request, env, ctx)).status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    await worker.fetch(
      request,
      { ...env, DIGITALOCEAN_API_TOKEN: 'rotated-token' },
      ctx,
    )
    expect(fetch).toHaveBeenCalledTimes(14)
    await Promise.all(pending)
  })
})

describe('secret ID validation', () => {
  it.each([
    undefined,
    '',
    '123',
    '123,123',
    '1,2,3',
    '-1,2',
    '1,https://evil.test',
    '0,1',
  ])('rejects %s', (value) => expect(configuredIds(value)).toBeNull())
  it('accepts two comma-separated IDs with whitespace', () =>
    expect(configuredIds(' 123, 456 ')).toEqual(['123', '456']))
})
