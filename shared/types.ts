export const TIME_RANGES = {
  '1h': { label: 'Last 1 hour', seconds: 3_600 },
  '6h': { label: 'Last 6 hours', seconds: 21_600 },
  '1d': { label: 'Last 1 day', seconds: 86_400 },
  '7d': { label: 'Last 7 days', seconds: 604_800 },
  '14d': { label: 'Last 14 days', seconds: 1_209_600 },
} as const

export type TimeRange = keyof typeof TIME_RANGES
export type MetricName = 'cpu' | 'memory' | 'disk'

export interface MetricPoint {
  timestamp: number
  value: number | null
}

export interface Metric {
  points: MetricPoint[]
  current: number | null
  average: number | null
  peak: number | null
  sampledAt: number | null
  error: string | null
}

export interface DropletMetrics {
  // An opaque slot, never the secret Droplet ID.
  key: string
  name: string
  region: string | null
  vcpus: number | null
  memoryMb: number | null
  diskGb: number | null
  status: string | null
  issue: string | null
  metrics: Record<MetricName, Metric>
}

export interface DashboardResponse {
  droplets: DropletMetrics[]
  range: TimeRange
  start: number
  end: number
  fetchedAt: number
}

export interface ApiError {
  code: string
  message: string
}

export function isTimeRange(value: string): value is TimeRange {
  return Object.hasOwn(TIME_RANGES, value)
}
