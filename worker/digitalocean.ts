import type { DropletMetrics, Metric } from '../shared/types'
import {
  cpuUsage,
  diskUsage,
  memoryUsage,
  parseSeries,
  summarize,
} from './metrics'

const API = 'https://api.digitalocean.com/v2'
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpstreamError'
  }
}

function upstreamMessage(status: number): string {
  if (status === 401)
    return 'DigitalOcean rejected the API token. Check the configured secret.'
  if (status === 403)
    return 'The API token needs monitoring:read and droplet:read permissions.'
  if (status === 404)
    return 'DigitalOcean could not find the configured Droplet.'
  if (status === 429)
    return 'DigitalOcean rate limit reached. Try again in a minute.'
  return 'DigitalOcean is temporarily unavailable. Try again shortly.'
}

async function get(path: string, token: string): Promise<unknown> {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new UpstreamError(
        'DigitalOcean returned an unexpected redirect. The request was not followed.',
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new UpstreamError(upstreamMessage(response.status))
    }
    if (!response.body)
      throw new UpstreamError('DigitalOcean returned an empty response.')
    // Limit response size before JSON parsing to protect the Worker memory budget.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new UpstreamError(
          'This metric response is too large. Select a shorter date range.',
        )
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    // Never pass through request URLs, credentials, or raw upstream error bodies.
    throw new UpstreamError(
      'Could not read DigitalOcean metrics. Try again shortly.',
    )
  }
}

function metadata(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    !('droplet' in body) ||
    !body.droplet ||
    typeof body.droplet !== 'object'
  ) {
    throw new UpstreamError(
      'DigitalOcean returned invalid Droplet information.',
    )
  }
  const droplet = body.droplet
  const region =
    'region' in droplet &&
    droplet.region &&
    typeof droplet.region === 'object' &&
    'slug' in droplet.region &&
    typeof droplet.region.slug === 'string'
      ? droplet.region.slug
      : null
  return {
    name:
      'name' in droplet && typeof droplet.name === 'string'
        ? droplet.name
        : null,
    status:
      'status' in droplet && typeof droplet.status === 'string'
        ? droplet.status
        : null,
    vcpus:
      'vcpus' in droplet && typeof droplet.vcpus === 'number'
        ? droplet.vcpus
        : null,
    memoryMb:
      'memory' in droplet && typeof droplet.memory === 'number'
        ? droplet.memory
        : null,
    diskGb:
      'disk' in droplet && typeof droplet.disk === 'number'
        ? droplet.disk
        : null,
    region,
  }
}

export async function loadDroplet(
  id: string,
  slot: number,
  token: string,
  start: number,
  end: number,
): Promise<DropletMetrics> {
  const read = async (metric: string) =>
    parseSeries(
      await get(
        `/monitoring/metrics/droplet/${metric}?${new URLSearchParams({ host_id: id, start: String(start - 120), end: String(end) })}`,
        token,
      ),
    )
  const readGroup = async (names: string[]) => {
    // Await every upstream call even if one fails, keeping all I/O in this request's lifetime.
    const outcomes = await Promise.allSettled(names.map(read))
    return outcomes.map((outcome) => {
      if (outcome.status === 'rejected') throw outcome.reason
      return outcome.value
    })
  }
  const results = await Promise.allSettled([
    get(`/droplets/${id}`, token).then(metadata),
    read('cpu').then((series) => summarize(cpuUsage(series), start, end)),
    readGroup(['memory_total', 'memory_free', 'memory_cached']).then(
      ([total, free, cached]) =>
        summarize(memoryUsage(total, free, cached), start, end),
    ),
    readGroup(['filesystem_size', 'filesystem_free']).then(([size, free]) =>
      summarize(diskUsage(size, free), start, end),
    ),
  ] as const)
  const [info, cpu, memory, disk] = results
  const resolved = (result: PromiseSettledResult<Metric>): Metric =>
    result.status === 'fulfilled'
      ? result.value
      : summarize(
          [],
          start,
          end,
          result.reason instanceof UpstreamError
            ? result.reason.message
            : 'DigitalOcean returned invalid metric data.',
        )
  return {
    key: `droplet-${slot + 1}`,
    name:
      info.status === 'fulfilled'
        ? (info.value.name ?? `Droplet ${slot + 1}`)
        : `Droplet ${slot + 1}`,
    region: info.status === 'fulfilled' ? info.value.region : null,
    vcpus: info.status === 'fulfilled' ? info.value.vcpus : null,
    memoryMb: info.status === 'fulfilled' ? info.value.memoryMb : null,
    diskGb: info.status === 'fulfilled' ? info.value.diskGb : null,
    status: info.status === 'fulfilled' ? info.value.status : null,
    issue:
      info.status === 'rejected'
        ? info.reason instanceof UpstreamError
          ? info.reason.message
          : 'Droplet details are unavailable.'
        : null,
    metrics: {
      cpu: resolved(cpu),
      memory: resolved(memory),
      disk: resolved(disk),
    },
  }
}
