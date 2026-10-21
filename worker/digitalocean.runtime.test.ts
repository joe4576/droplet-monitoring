import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import {
  Miniflare,
  Response as RuntimeResponse,
  convertV4MiniflareOptions,
  type V4FetchHandler,
  type V4ModuleDefinition,
} from 'miniflare'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { DropletMetrics } from '../shared/types'

async function runtime(outboundService: V4FetchHandler) {
  const path = (name: string) =>
    fileURLToPath(new NodeURL(name, import.meta.url))
  const modules: V4ModuleDefinition[] = [
    {
      type: 'ESModule',
      path: path('./runtime-entry.js'),
      contents: `import { loadDroplet } from './digitalocean.js';
        export default { async fetch() {
          return Response.json(await loadDroplet('123456789', 0, 'fixture-token', 0, 60));
        } };`,
    },
  ]
  for (const name of ['digitalocean', 'metrics']) {
    const source = await readFile(path(`./${name}.ts`), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
      },
    })
    modules.push({
      type: 'ESModule',
      path: path(`./${name}.js`),
      contents: outputText.replace(/(['"])\.\/metrics\1/g, "'./metrics.js'"),
    })
  }
  // Run the production integration in workerd, rather than a Node fetch mock.
  // A Node mock previously missed an unsupported redirect option in this runtime.
  return new Miniflare(
    convertV4MiniflareOptions({
      name: 'digitalocean-runtime-test',
      compatibilityDate: '2026-10-19',
      modules,
      outboundService,
    }),
  )
}

describe('DigitalOcean integration in the Worker runtime', () => {
  it('fetches and parses authenticated metadata and all three metrics', async () => {
    let requests = 0
    const mf = await runtime((request) => {
      requests++
      const url = new URL(request.url)
      expect(url.origin).toBe('https://api.digitalocean.com')
      expect(request.headers.get('Authorization')).toBe('Bearer fixture-token')
      if (url.pathname.includes('/droplets/'))
        return RuntimeResponse.json({
          droplet: {
            name: 'production',
            status: 'active',
            region: { slug: 'lon1' },
            vcpus: 2,
            memory: 4096,
            disk: 80,
          },
        })
      const kind = url.pathname.split('/').at(-1)
      const series = (value: number, labels = {}) => ({
        metric: labels,
        values: [
          [0, String(value)],
          [60, String(value)],
        ],
      })
      const result =
        kind === 'cpu'
          ? [
              {
                metric: { mode: 'idle' },
                values: [
                  [0, '800'],
                  [60, '890'],
                ],
              },
              {
                metric: { mode: 'user' },
                values: [
                  [0, '200'],
                  [60, '230'],
                ],
              },
            ]
          : [
              series(
                kind?.endsWith('total') || kind?.endsWith('size') ? 1000 : 100,
                { mountpoint: '/', device: '/dev/vda1' },
              ),
            ]
      return RuntimeResponse.json({ status: 'success', data: { result } })
    })
    try {
      const response = await mf.dispatchFetch('https://runtime.test/')
      const data = (await response.json()) as DropletMetrics
      expect(requests).toBe(7)
      expect(data.issue).toBeNull()
      expect(data.metrics.cpu.current).toBeCloseTo(25)
      expect(data.metrics.memory.current).toBe(80)
      expect(data.metrics.disk.current).toBe(90)
    } finally {
      await mf.dispose()
    }
  })

  it('rejects redirects without forwarding credentials to another origin', async () => {
    const hosts: string[] = []
    const mf = await runtime((request) => {
      hosts.push(new URL(request.url).hostname)
      return new RuntimeResponse(null, {
        status: 307,
        headers: { Location: 'https://untrusted.test/' },
      })
    })
    try {
      const response = await mf.dispatchFetch('https://runtime.test/')
      const data = (await response.json()) as DropletMetrics
      expect(hosts).toHaveLength(7)
      expect(new Set(hosts)).toEqual(new Set(['api.digitalocean.com']))
      expect(data.metrics.cpu.current).toBeNull()
      expect(data.metrics.cpu.error).toContain('unexpected redirect')
    } finally {
      await mf.dispose()
    }
  })
})
