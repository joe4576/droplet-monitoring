import { describe, expect, it } from 'vitest'
import {
  cpuUsage,
  diskUsage,
  memoryUsage,
  parseSeries,
  summarize,
  type Series,
} from './metrics'

const series = (
  values: Series['values'],
  metric: Record<string, string> = {},
): Series => ({ metric, values })

describe('CPU utilization', () => {
  it('uses counter deltas, normalizes cores, and excludes double-counted guest time', () => {
    const points = cpuUsage([
      series(
        [
          [0, '1000'],
          [60, '1090'],
          [120, '1150'],
        ],
        { mode: 'idle' },
      ),
      series(
        [
          [0, '100'],
          [60, '130'],
          [120, '190'],
        ],
        { mode: 'user' },
      ),
      series(
        [
          [0, '5'],
          [60, '30'],
          [120, '50'],
        ],
        { mode: 'guest' },
      ),
    ])
    expect(points[0].value).toBeCloseTo(25)
    expect(points[1].value).toBeCloseTo(50)
  })
  it('leaves a gap on reset and recovers after reboot', () => {
    const points = cpuUsage([
      series(
        [
          [0, 1000],
          [60, 10],
          [120, 100],
        ],
        { mode: 'idle' },
      ),
      series(
        [
          [0, 100],
          [60, 5],
          [120, 35],
        ],
        { mode: 'user' },
      ),
    ])
    expect(points[0].value).toBeNull()
    expect(points[1].value).toBeCloseTo(25)
  })
  it('does not match counters across different time intervals', () => {
    expect(
      cpuUsage([
        series(
          [
            [0, 1000],
            [60, 1090],
            [120, 1180],
          ],
          { mode: 'idle' },
        ),
        series(
          [
            [0, 100],
            [120, 160],
          ],
          { mode: 'user' },
        ),
      ]).every((point) => point.value === null),
    ).toBe(true)
  })
  it('does not invent utilization if idle counters are absent', () => {
    expect(
      cpuUsage([
        series(
          [
            [0, 10],
            [60, 20],
          ],
          { mode: 'user' },
        ),
      ]),
    ).toEqual([])
  })
})

describe('memory and disk', () => {
  it('excludes free and cached memory and matches timestamps exactly', () => {
    expect(
      memoryUsage(
        [
          series([
            [0, 1000],
            [60, 1000],
          ]),
        ],
        [
          series([
            [0, 100],
            [60, 100],
          ]),
        ],
        [series([[0, 200]])],
      ),
    ).toEqual([
      { timestamp: 0, value: 70 },
      { timestamp: 60, value: null },
    ])
  })
  it('handles zero total memory without division by zero', () => {
    expect(
      memoryUsage([series([[0, 0]])], [series([[0, 0]])], [series([[0, 0]])])[0]
        .value,
    ).toBeNull()
  })
  it('uses only the root filesystem and the matching device', () => {
    expect(
      diskUsage(
        [
          series([[0, 1000]], { mountpoint: '/', device: '/dev/vda1' }),
          series([[0, 10000]], { mountpoint: '/mnt/data', device: '/dev/sda' }),
        ],
        [
          series([[0, 200]], { mountpoint: '/', device: '/dev/vda1' }),
          series([[0, 9999]], { mountpoint: '/mnt/data', device: '/dev/sda' }),
        ],
      ),
    ).toEqual([{ timestamp: 0, value: 80 }])
  })
  it('never silently substitutes another mount for the root filesystem', () => {
    expect(
      diskUsage(
        [series([[0, 10]], { mountpoint: '/mnt' })],
        [series([[0, 1]], { mountpoint: '/mnt' })],
      ),
    ).toEqual([])
  })
})

describe('chart summaries', () => {
  it('preserves counter-reset gaps when downsampling a dense series', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: i,
      value: i === 500 ? null : 10,
    }))
    const result = summarize(points, 0, 999)
    expect(result.points).toHaveLength(360)
    expect(
      result.points.some(
        (point) =>
          point.timestamp > 495 &&
          point.timestamp < 505 &&
          point.value === null,
      ),
    ).toBe(true)
  })
  it('bounds a 14-day payload while retaining the true latest value and peak', () => {
    const points = Array.from({ length: 20_161 }, (_, i) => ({
      timestamp: i * 60,
      value: i === 100 ? 99 : 10,
    }))
    const result = summarize(points, 0, 1_209_600)
    expect(result.points).toHaveLength(360)
    expect(result.current).toBe(10)
    expect(result.peak).toBe(99)
    expect(result.sampledAt).toBe(1_209_600)
  })
  it('inserts gaps between sparse samples and excludes points outside the range', () => {
    const result = summarize(
      [0, 60, 120, 180, 600, 660].map((timestamp) => ({
        timestamp,
        value: 20,
      })),
      60,
      660,
    )
    expect(result.points[0].timestamp).toBe(60)
    expect(result.points).toContainEqual({ timestamp: 240, value: null })
    expect(result.average).toBe(20)
  })
  it('returns null summaries for missing telemetry, preserving real zero usage', () => {
    expect(summarize([], 0, 60).current).toBeNull()
    expect(summarize([{ timestamp: 0, value: 0 }], 0, 60).current).toBe(0)
  })
  it('rejects malformed upstream responses', () => {
    expect(() =>
      parseSeries({ status: 'error', data: { result: [] } }),
    ).toThrow()
    expect(() =>
      parseSeries({
        status: 'success',
        data: { result: [{ metric: {}, values: [['bad', '3']] }] },
      }),
    ).toThrow()
  })
})
