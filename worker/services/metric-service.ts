import type { Metric, MetricPoint } from "../../shared/types";
import type { Series } from "../schemas";

interface MetricWindow {
  end: number;
  points: MetricPoint[];
  start: number;
}

export class MetricService {
  // CPU counters include all cores. Guest time is already included in user/nice.
  public getCpuUsagePoints(series: Series[]): MetricPoint[] {
    const modes = new Set([
      "idle",
      "user",
      "nice",
      "system",
      "iowait",
      "irq",
      "softirq",
      "steal",
    ]);

    const counters: Series[] = [];
    let hasIdle = false;

    for (const item of series) {
      if (modes.has(item.metric.mode)) {
        counters.push(item);
        hasIdle ||= item.metric.mode === "idle";
      }
    }

    if (!hasIdle) {
      return [];
    }

    const intervals = new Map<
      string,
      {
        count: number;
        idle: number;
        timestamp: number;
        total: number;
        valid: boolean;
      }
    >();

    for (const counter of counters) {
      const values = [...this.getSamplesByTimestamp(counter)];

      for (let i = 1; i < values.length; i++) {
        const [timestamp, value] = values[i];
        const [previousTime, previous] = values[i - 1];
        const key = `${previousTime}:${timestamp}`;

        const interval = intervals.get(key) ?? {
          count: 0,
          idle: 0,
          timestamp,
          total: 0,
          valid: true,
        };

        const delta = value - previous;
        interval.count++;

        if (!Number.isFinite(delta) || delta < 0 || timestamp <= previousTime) {
          interval.valid = false;
        } else {
          interval.total += delta;

          if (counter.metric.mode === "idle") {
            interval.idle += delta;
          }
        }

        intervals.set(key, interval);
      }
    }

    // Missing samples and counter resets leave a gap.
    const byTime = new Map<number, MetricPoint>();

    for (const interval of intervals.values()) {
      const value =
        interval.valid &&
        interval.count === counters.length &&
        interval.total > 0
          ? (1 - interval.idle / interval.total) * 100
          : null;

      const point = this.getClampedPercentagePoint({
        timestamp: interval.timestamp,
        value,
      });

      const existing = byTime.get(point.timestamp);

      if (!existing || point.value !== null) {
        byTime.set(point.timestamp, point);
      }
    }

    return this.getPointsInTimestampOrder([...byTime.values()]);
  }

  public getMemoryUsagePoints({
    cached,
    free,
    total,
  }: {
    cached: Series[];
    free: Series[];
    total: Series[];
  }): MetricPoint[] {
    if (total.length !== 1 || free.length !== 1 || cached.length !== 1) {
      return [];
    }

    const cachedValues = this.getSamplesByTimestamp(cached[0]);
    const freeValues = this.getSamplesByTimestamp(free[0]);
    const totalValues = this.getSamplesByTimestamp(total[0]);
    const points: MetricPoint[] = [];

    for (const [timestamp, size] of totalValues) {
      const unused = freeValues.get(timestamp);
      const cache = cachedValues.get(timestamp);

      const value =
        size > 0 &&
        unused !== undefined &&
        cache !== undefined &&
        unused >= 0 &&
        cache >= 0
          ? ((size - unused - cache) / size) * 100
          : null;

      points.push(this.getClampedPercentagePoint({ timestamp, value }));
    }

    return points;
  }

  public getDiskUsagePoints({
    free,
    size,
  }: {
    free: Series[];
    size: Series[];
  }): MetricPoint[] {
    const root: Series[] = [];

    for (const item of size) {
      if (item.metric.mountpoint === "/") {
        root.push(item);
      }
    }

    if (root.length !== 1) {
      return [];
    }

    let matching: Series | undefined;

    for (const item of free) {
      if (
        item.metric.mountpoint === "/" &&
        item.metric.device === root[0].metric.device
      ) {
        matching = item;
        break;
      }
    }

    if (!matching) {
      return [];
    }

    const freeValues = this.getSamplesByTimestamp(matching);
    const sizeValues = this.getSamplesByTimestamp(root[0]);
    const points: MetricPoint[] = [];

    for (const [timestamp, total] of sizeValues) {
      const unused = freeValues.get(timestamp);

      const value =
        total > 0 && unused !== undefined && unused >= 0
          ? ((total - unused) / total) * 100
          : null;

      points.push(this.getClampedPercentagePoint({ timestamp, value }));
    }

    return points;
  }

  public getMetricSummary({
    end,
    error = null,
    points,
    start,
  }: MetricWindow & {
    error?: string | null;
  }): Metric {
    const inRange: MetricPoint[] = [];

    for (const point of points) {
      if (point.timestamp >= start && point.timestamp <= end) {
        inRange.push(point);
      }
    }

    const ordered = this.getPointsInTimestampOrder(inRange);
    let count = 0;
    let latest: (MetricPoint & { value: number }) | null = null;
    let peak = 0;
    let sum = 0;

    for (const point of ordered) {
      if (point.value !== null && Number.isFinite(point.value)) {
        count++;
        latest = { timestamp: point.timestamp, value: point.value };
        peak = Math.max(peak, point.value);
        sum += point.value;
      }
    }

    if (!latest) {
      return {
        average: null,
        current: null,
        error:
          error ??
          "No samples in this period. Check that the metrics agent is running.",
        peak: null,
        points: [],
        sampledAt: null,
      };
    }

    return {
      average: sum / count,
      current: latest.value,
      error,
      peak,
      points: this.getChartPoints({ end, points: ordered, start }),
      sampledAt: latest.timestamp,
    };
  }

  private getSamplesByTimestamp(series: Series): Map<number, number> {
    const samples = new Map<number, number>();

    for (const [timestamp, raw] of series.values) {
      samples.set(timestamp, Number(raw));
    }

    const ordered = new Map<number, number>();

    for (const timestamp of Float64Array.from(samples.keys()).sort()) {
      ordered.set(timestamp, samples.get(timestamp)!);
    }

    return ordered;
  }

  private getClampedPercentagePoint({
    timestamp,
    value,
  }: {
    timestamp: number;
    value: number | null;
  }): MetricPoint {
    return {
      timestamp,
      value:
        value !== null && Number.isFinite(value)
          ? Math.min(100, Math.max(0, value))
          : null,
    };
  }

  private getPointsInTimestampOrder(points: MetricPoint[]): MetricPoint[] {
    const byTime = new Map<number, MetricPoint[]>();

    for (const point of points) {
      const group = byTime.get(point.timestamp) ?? [];
      group.push(point);
      byTime.set(point.timestamp, group);
    }

    const ordered: MetricPoint[] = [];

    for (const timestamp of Float64Array.from(byTime.keys()).sort()) {
      for (const point of byTime.get(timestamp)!) {
        ordered.push(point);
      }
    }

    return ordered;
  }

  private getSampleCadence(points: MetricPoint[]): number {
    const deltas: number[] = [];

    for (let i = 1; i < points.length; i++) {
      const delta = points[i].timestamp - points[i - 1].timestamp;

      if (delta > 0) {
        deltas.push(delta);
      }
    }

    const ordered = Float64Array.from(deltas).sort();
    return ordered[Math.floor(ordered.length / 2)] ?? 60;
  }

  // Bound chart payloads while preserving missing samples and reporting gaps.
  private getChartPoints({ end, points, start }: MetricWindow): MetricPoint[] {
    const cadence = this.getSampleCadence(points);
    const sparse: MetricPoint[] = [];

    for (const point of points) {
      const previous = sparse.at(-1);

      if (previous && point.timestamp - previous.timestamp > cadence * 3) {
        sparse.push({ timestamp: previous.timestamp + cadence, value: null });
      }

      sparse.push(point);
    }

    const count = 360;

    if (sparse.length <= count) {
      return sparse;
    }

    const width = (end - start) / count;
    const buckets: { count: number; gap: boolean; sum: number }[] = [];

    for (let i = 0; i < count; i++) {
      buckets.push({ count: 0, gap: false, sum: 0 });
    }

    for (const point of points) {
      const bucket =
        buckets[
          Math.min(count - 1, Math.floor((point.timestamp - start) / width))
        ];

      if (point.value === null || !Number.isFinite(point.value)) {
        bucket.gap = true;
      } else {
        bucket.sum += point.value;
        bucket.count++;
      }
    }

    const result: MetricPoint[] = [];

    for (const [i, bucket] of buckets.entries()) {
      result.push({
        timestamp: Math.round(start + (i + 0.5) * width),
        value: bucket.count && !bucket.gap ? bucket.sum / bucket.count : null,
      });
    }

    return result;
  }
}
