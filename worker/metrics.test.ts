import { describe, expect, it } from "vitest";
import { MetricService } from "./services/metric-service";
import { metricsResponseSchema, type Series } from "./schemas";

const metricService = new MetricService();

const series = ({
  metric = {},
  values,
}: {
  metric?: Record<string, string>;
  values: Series["values"];
}): Series => ({ metric, values });

describe("CPU utilization", () => {
  it("orders counters by timestamp and uses the last duplicate sample", () => {
    const points = metricService.getCpuUsagePoints([
      series({
        metric: { mode: "idle" },
        values: [
          [60, 190],
          [0, 999],
          [0, 100],
        ],
      }),
      series({
        metric: { mode: "user" },
        values: [
          [60, 30],
          [0, 0],
        ],
      }),
    ]);

    expect(points).toHaveLength(1);
    expect(points[0].timestamp).toBe(60);
    expect(points[0].value).toBeCloseTo(25);
  });

  it("uses counter deltas, normalizes cores, and excludes double-counted guest time", () => {
    const points = metricService.getCpuUsagePoints([
      series({
        metric: { mode: "idle" },
        values: [
          [0, "1000"],
          [60, "1090"],
          [120, "1150"],
        ],
      }),
      series({
        metric: { mode: "user" },
        values: [
          [0, "100"],
          [60, "130"],
          [120, "190"],
        ],
      }),
      series({
        metric: { mode: "guest" },
        values: [
          [0, "5"],
          [60, "30"],
          [120, "50"],
        ],
      }),
    ]);

    expect(points[0].value).toBeCloseTo(25);

    expect(points[1].value).toBeCloseTo(50);
  });

  it("leaves a gap on reset and recovers after reboot", () => {
    const points = metricService.getCpuUsagePoints([
      series({
        metric: { mode: "idle" },
        values: [
          [0, 1000],
          [60, 10],
          [120, 100],
        ],
      }),
      series({
        metric: { mode: "user" },
        values: [
          [0, 100],
          [60, 5],
          [120, 35],
        ],
      }),
    ]);

    expect(points[0].value).toBeNull();

    expect(points[1].value).toBeCloseTo(25);
  });

  it("does not match counters across different time intervals", () => {
    expect(
      metricService
        .getCpuUsagePoints([
          series({
            metric: { mode: "idle" },
            values: [
              [0, 1000],
              [60, 1090],
              [120, 1180],
            ],
          }),
          series({
            metric: { mode: "user" },
            values: [
              [0, 100],
              [120, 160],
            ],
          }),
        ])
        .every((point) => point.value === null),
    ).toBe(true);
  });

  it("does not invent utilization if idle counters are absent", () => {
    expect(
      metricService.getCpuUsagePoints([
        series({
          metric: { mode: "user" },
          values: [
            [0, 10],
            [60, 20],
          ],
        }),
      ]),
    ).toEqual([]);
  });
});

describe("memory and disk", () => {
  it("excludes free and cached memory and matches timestamps exactly", () => {
    expect(
      metricService.getMemoryUsagePoints({
        cached: [series({ values: [[0, 200]] })],
        free: [
          series({
            values: [
              [0, 100],
              [60, 100],
            ],
          }),
        ],
        total: [
          series({
            values: [
              [0, 1000],
              [60, 1000],
            ],
          }),
        ],
      }),
    ).toEqual([
      { timestamp: 0, value: 70 },
      { timestamp: 60, value: null },
    ]);
  });

  it("handles zero total memory without division by zero", () => {
    expect(
      metricService.getMemoryUsagePoints({
        cached: [series({ values: [[0, 0]] })],
        free: [series({ values: [[0, 0]] })],
        total: [series({ values: [[0, 0]] })],
      })[0].value,
    ).toBeNull();
  });

  it("uses only the root filesystem and the matching device", () => {
    expect(
      metricService.getDiskUsagePoints({
        free: [
          series({
            metric: { device: "/dev/vda1", mountpoint: "/" },
            values: [[0, 200]],
          }),
          series({
            metric: { device: "/dev/sda", mountpoint: "/mnt/data" },
            values: [[0, 9999]],
          }),
        ],
        size: [
          series({
            metric: { device: "/dev/vda1", mountpoint: "/" },
            values: [[0, 1000]],
          }),
          series({
            metric: { device: "/dev/sda", mountpoint: "/mnt/data" },
            values: [[0, 10000]],
          }),
        ],
      }),
    ).toEqual([{ timestamp: 0, value: 80 }]);
  });

  it("never silently substitutes another mount for the root filesystem", () => {
    expect(
      metricService.getDiskUsagePoints({
        free: [series({ metric: { mountpoint: "/mnt" }, values: [[0, 1]] })],
        size: [series({ metric: { mountpoint: "/mnt" }, values: [[0, 10]] })],
      }),
    ).toEqual([]);
  });
});

describe("chart summaries", () => {
  it("orders fractional timestamps while preserving duplicate sample order", () => {
    const result = metricService.getMetricSummary({
      end: 2,
      points: [
        { timestamp: 1.5, value: 30 },
        { timestamp: 0.5, value: 10 },
        { timestamp: 1.5, value: 20 },
      ],
      start: 0,
    });

    expect(result.points).toEqual([
      { timestamp: 0.5, value: 10 },
      { timestamp: 1.5, value: 30 },
      { timestamp: 1.5, value: 20 },
    ]);

    expect(result.current).toBe(20);
    expect(result.average).toBe(20);
    expect(result.peak).toBe(30);
    expect(result.sampledAt).toBe(1.5);
  });

  it("preserves counter-reset gaps when downsampling a dense series", () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: i,
      value: i === 500 ? null : 10,
    }));

    const result = metricService.getMetricSummary({
      end: 999,
      points,
      start: 0,
    });

    expect(result.points).toHaveLength(360);

    expect(
      result.points.some(
        (point) =>
          point.timestamp > 495 &&
          point.timestamp < 505 &&
          point.value === null,
      ),
    ).toBe(true);
  });

  it("bounds a 14-day payload while retaining the true latest value and peak", () => {
    const points = Array.from({ length: 20161 }, (_, i) => ({
      timestamp: i * 60,
      value: i === 100 ? 99 : 10,
    }));

    const result = metricService.getMetricSummary({
      end: 1209600,
      points,
      start: 0,
    });

    expect(result.points).toHaveLength(360);

    expect(result.current).toBe(10);

    expect(result.peak).toBe(99);

    expect(result.sampledAt).toBe(1209600);
  });

  it("inserts gaps between sparse samples and excludes points outside the range", () => {
    const result = metricService.getMetricSummary({
      end: 660,
      points: [0, 60, 120, 180, 600, 660].map((timestamp) => ({
        timestamp,
        value: 20,
      })),
      start: 60,
    });

    expect(result.points[0].timestamp).toBe(60);

    expect(result.points).toContainEqual({ timestamp: 240, value: null });

    expect(result.average).toBe(20);
  });

  it("returns null summaries for missing telemetry, preserving real zero usage", () => {
    expect(
      metricService.getMetricSummary({ end: 60, points: [], start: 0 }).current,
    ).toBeNull();

    expect(
      metricService.getMetricSummary({
        end: 60,
        points: [{ timestamp: 0, value: 0 }],
        start: 0,
      }).current,
    ).toBe(0);
  });

  it("rejects malformed upstream responses", () => {
    expect(() =>
      metricsResponseSchema.parse({ data: { result: [] }, status: "error" }),
    ).toThrow();

    expect(() =>
      metricsResponseSchema.parse({
        data: { result: [{ metric: {}, values: [["bad", "3"]] }] },
        status: "success",
      }),
    ).toThrow();
  });
});
