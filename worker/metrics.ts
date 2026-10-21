import type { Metric, MetricPoint } from '../shared/types'

export interface Series {
  metric: Record<string, string>
  values: [number, string | number][]
}

export function parseSeries(body: unknown): Series[] {
  if (
    !body ||
    typeof body !== 'object' ||
    !('status' in body) ||
    body.status !== 'success' ||
    !('data' in body) ||
    !body.data ||
    typeof body.data !== 'object' ||
    !('result' in body.data) ||
    !Array.isArray(body.data.result)
  )
    throw new Error('DigitalOcean returned an invalid metrics response.')

  return body.data.result.map((series: unknown) => {
    if (
      !series ||
      typeof series !== 'object' ||
      !('metric' in series) ||
      !series.metric ||
      typeof series.metric !== 'object' ||
      !('values' in series) ||
      !Array.isArray(series.values)
    )
      throw new Error('DigitalOcean returned an invalid metric series.')
    const metric: Record<string, string> = {}
    for (const [key, value] of Object.entries(series.metric)) {
      if (typeof value === 'string') metric[key] = value
    }
    const values: Series['values'] = series.values.map((sample: unknown) => {
      if (
        !Array.isArray(sample) ||
        sample.length !== 2 ||
        typeof sample[0] !== 'number' ||
        !Number.isFinite(sample[0]) ||
        (typeof sample[1] !== 'string' && typeof sample[1] !== 'number')
      )
        throw new Error('DigitalOcean returned an invalid metric sample.')
      return [sample[0], sample[1]]
    })
    return { metric, values }
  })
}

function samples(series: Series): Map<number, number> {
  return new Map(
    series.values.map(([timestamp, raw]) => [timestamp, Number(raw)]),
  )
}

function percent(value: number): number | null {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
}

// CPU counters include all cores. Their relative deltas normalize the result to 100%.
// guest/guest_nice are already included in user/nice, so they must not be counted twice.
export function cpuUsage(series: Series[]): MetricPoint[] {
  const modes = new Set([
    'idle',
    'user',
    'nice',
    'system',
    'iowait',
    'irq',
    'softirq',
    'steal',
  ])
  const counters = series.filter((item) => modes.has(item.metric.mode))
  if (!counters.some((item) => item.metric.mode === 'idle')) return []

  const intervals = new Map<
    string,
    {
      timestamp: number
      total: number
      idle: number
      count: number
      valid: boolean
    }
  >()
  for (const counter of counters) {
    const values = [...samples(counter)].sort(([a], [b]) => a - b)
    for (let i = 1; i < values.length; i++) {
      const [timestamp, value] = values[i]
      const [previousTime, previous] = values[i - 1]
      const key = `${previousTime}:${timestamp}`
      const interval = intervals.get(key) ?? {
        timestamp,
        total: 0,
        idle: 0,
        count: 0,
        valid: true,
      }
      const delta = value - previous
      interval.count++
      if (!Number.isFinite(delta) || delta < 0 || timestamp <= previousTime) {
        interval.valid = false
      } else {
        interval.total += delta
        if (counter.metric.mode === 'idle') interval.idle += delta
      }
      intervals.set(key, interval)
    }
  }
  // If a mode has a missing sample or a counter resets, leave a gap.
  const byTime = new Map<number, MetricPoint>()
  for (const interval of intervals.values()) {
    const value =
      interval.valid && interval.count === counters.length && interval.total > 0
        ? percent((1 - interval.idle / interval.total) * 100)
        : null
    const existing = byTime.get(interval.timestamp)
    if (!existing || value !== null)
      byTime.set(interval.timestamp, { timestamp: interval.timestamp, value })
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
}

export function memoryUsage(
  total: Series[],
  free: Series[],
  cached: Series[],
): MetricPoint[] {
  if (total.length !== 1 || free.length !== 1 || cached.length !== 1) return []
  const freeValues = samples(free[0])
  const cachedValues = samples(cached[0])
  return [...samples(total[0])]
    .map(([timestamp, size]) => {
      const unused = freeValues.get(timestamp)
      const cache = cachedValues.get(timestamp)
      return {
        timestamp,
        value:
          size > 0 &&
          unused !== undefined &&
          cache !== undefined &&
          unused >= 0 &&
          cache >= 0
            ? percent(((size - unused - cache) / size) * 100)
            : null,
      }
    })
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function diskUsage(size: Series[], free: Series[]): MetricPoint[] {
  const root = size.filter((item) => item.metric.mountpoint === '/')
  if (root.length !== 1) return []
  const matching = free.find(
    (item) =>
      item.metric.mountpoint === '/' &&
      item.metric.device === root[0].metric.device,
  )
  if (!matching) return []
  const freeValues = samples(matching)
  return [...samples(root[0])]
    .map(([timestamp, total]) => {
      const unused = freeValues.get(timestamp)
      return {
        timestamp,
        value:
          total > 0 && unused !== undefined && unused >= 0
            ? percent(((total - unused) / total) * 100)
            : null,
      }
    })
    .sort((a, b) => a.timestamp - b.timestamp)
}

// Bound the API payload and chart work. Empty buckets stay null, preserving gaps.
export function summarize(
  points: MetricPoint[],
  start: number,
  end: number,
  error: string | null = null,
): Metric {
  const ordered = points
    .filter((point) => point.timestamp >= start && point.timestamp <= end)
    .sort((a, b) => a.timestamp - b.timestamp)
  const valid = ordered.filter(
    (point): point is MetricPoint & { value: number } =>
      point.value !== null && Number.isFinite(point.value),
  )
  if (valid.length === 0)
    return {
      points: [],
      current: null,
      average: null,
      peak: null,
      sampledAt: null,
      error:
        error ??
        'No samples in this period. Check that the metrics agent is running.',
    }
  const count = 360
  const width = (end - start) / count
  const buckets = Array.from({ length: count }, () => ({
    sum: 0,
    count: 0,
    gap: false,
  }))
  for (const point of ordered) {
    const bucket =
      buckets[
        Math.min(count - 1, Math.floor((point.timestamp - start) / width))
      ]
    if (point.value === null || !Number.isFinite(point.value)) bucket.gap = true
    else {
      bucket.sum += point.value
      bucket.count++
    }
  }
  // Native samples are usually sparse in short ranges; keep their exact timestamps.
  // Insert a break for long reporting gaps so charts never bridge missing telemetry.
  const deltas = ordered
    .slice(1)
    .map((point, i) => point.timestamp - ordered[i].timestamp)
    .filter((delta) => delta > 0)
    .sort((a, b) => a - b)
  const cadence = deltas[Math.floor(deltas.length / 2)] ?? 60
  const sparse: MetricPoint[] = []
  for (const point of ordered) {
    const previous = sparse.at(-1)
    if (previous && point.timestamp - previous.timestamp > cadence * 3)
      sparse.push({ timestamp: previous.timestamp + cadence, value: null })
    sparse.push(point)
  }
  const latest = valid.at(-1)!
  return {
    points:
      sparse.length <= count
        ? sparse
        : buckets.map((bucket, i) => ({
            timestamp: Math.round(start + (i + 0.5) * width),
            value:
              bucket.count && !bucket.gap ? bucket.sum / bucket.count : null,
          })),
    current: latest.value,
    average: valid.reduce((sum, point) => sum + point.value, 0) / valid.length,
    peak: valid.reduce((peak, point) => Math.max(peak, point.value), 0),
    sampledAt: latest.timestamp,
    error,
  }
}
