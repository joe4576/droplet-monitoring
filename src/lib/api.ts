import type { ApiError, DashboardResponse, TimeRange } from '../../shared/types'

export class DashboardError extends Error {
  readonly code: string
  constructor(error: ApiError) {
    super(error.message)
    this.code = error.code
  }
}

export async function fetchMetrics(
  range: TimeRange,
  signal: AbortSignal,
): Promise<DashboardResponse> {
  const response = await fetch(`/api/metrics?range=${range}`, { signal })
  if (!response.ok) {
    const body: unknown = await response.json()
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      'message' in body &&
      typeof body.code === 'string' &&
      typeof body.message === 'string'
    ) {
      throw new DashboardError({ code: body.code, message: body.message })
    }
    throw new Error('Metrics could not be loaded. Try again shortly.')
  }
  return response.json() as Promise<DashboardResponse>
}
