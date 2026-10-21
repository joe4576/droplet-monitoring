import type { DropletMetrics, Metric } from "../../shared/types";
import { get, UpstreamError } from "../clients/digitalocean";
import {
  dropletResponseSchema,
  metricsResponseSchema,
  type DropletMetadata,
  type Series,
} from "../schemas";
import { MetricService } from "./metric-service";

interface MetricWindow {
  end: number;
  start: number;
}

interface DropletMetricOptions extends MetricWindow {
  dropletId: string;
}

export class DropletService {
  private readonly metricService = new MetricService();

  public constructor(private readonly token: string) {}

  public async getMetricsByDropletId({
    dropletId,
    end,
    slot,
    start,
  }: DropletMetricOptions & { slot: number }): Promise<DropletMetrics> {
    const options: DropletMetricOptions = { dropletId, end, start };

    const [info, cpu, memory, disk] = await Promise.allSettled([
      this.getDropletMetadataByDropletId(dropletId),
      this.getCpuMetric(options),
      this.getMemoryMetric(options),
      this.getDiskMetric(options),
    ] as const);

    return {
      diskGb: info.status === "fulfilled" ? info.value.disk : null,
      issue:
        info.status === "rejected"
          ? info.reason instanceof UpstreamError
            ? info.reason.message
            : "Droplet details are unavailable."
          : null,
      key: `droplet-${slot + 1}`,
      memoryMb: info.status === "fulfilled" ? info.value.memory : null,
      metrics: {
        cpu: this.getMetricFromResult({ end, result: cpu, start }),
        disk: this.getMetricFromResult({ end, result: disk, start }),
        memory: this.getMetricFromResult({ end, result: memory, start }),
      },
      name:
        info.status === "fulfilled"
          ? (info.value.name ?? `Droplet ${slot + 1}`)
          : `Droplet ${slot + 1}`,
      region: info.status === "fulfilled" ? info.value.region.slug : null,
      status: info.status === "fulfilled" ? info.value.status : null,
      vcpus: info.status === "fulfilled" ? info.value.vcpus : null,
    };
  }

  private async getDropletMetadataByDropletId(
    dropletId: string,
  ): Promise<DropletMetadata> {
    const body = await get({
      path: `/droplets/${dropletId}`,
      token: this.token,
    });

    const parsed = dropletResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new UpstreamError(
        "DigitalOcean returned invalid Droplet information.",
      );
    }

    return parsed.data.droplet;
  }

  private async getMetricSeries({
    dropletId,
    end,
    metric,
    start,
  }: DropletMetricOptions & { metric: string }): Promise<Series[]> {
    const parsed = metricsResponseSchema.safeParse(
      await get({
        path: `/monitoring/metrics/droplet/${metric}?${new URLSearchParams({ end: String(end), host_id: dropletId, start: String(start - 120) })}`,
        token: this.token,
      }),
    );

    if (!parsed.success) {
      throw new Error("DigitalOcean returned invalid metric data.");
    }

    return parsed.data.data.result;
  }

  private async getMetricSeriesGroup({
    dropletId,
    end,
    metrics,
    start,
  }: DropletMetricOptions & { metrics: string[] }): Promise<Series[][]> {
    const requests: Promise<Series[]>[] = [];

    for (const metric of metrics) {
      requests.push(this.getMetricSeries({ dropletId, end, metric, start }));
    }

    // Await every upstream call even if one fails, keeping all I/O in this request's lifetime.
    const outcomes = await Promise.allSettled(requests);
    const result: Series[][] = [];

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }

      result.push(outcome.value);
    }

    return result;
  }

  private async getCpuMetric(options: DropletMetricOptions): Promise<Metric> {
    const series = await this.getMetricSeries({ ...options, metric: "cpu" });
    const points = this.metricService.getCpuUsagePoints(series);

    return this.metricService.getMetricSummary({
      end: options.end,
      points,
      start: options.start,
    });
  }

  private async getMemoryMetric(
    options: DropletMetricOptions,
  ): Promise<Metric> {
    const [total, free, cached] = await this.getMetricSeriesGroup({
      ...options,
      metrics: ["memory_total", "memory_free", "memory_cached"],
    });

    const points = this.metricService.getMemoryUsagePoints({
      cached,
      free,
      total,
    });

    return this.metricService.getMetricSummary({
      end: options.end,
      points,
      start: options.start,
    });
  }

  private async getDiskMetric(options: DropletMetricOptions): Promise<Metric> {
    const [size, free] = await this.getMetricSeriesGroup({
      ...options,
      metrics: ["filesystem_size", "filesystem_free"],
    });

    const points = this.metricService.getDiskUsagePoints({ free, size });

    return this.metricService.getMetricSummary({
      end: options.end,
      points,
      start: options.start,
    });
  }

  private getMetricFromResult({
    end,
    result,
    start,
  }: MetricWindow & { result: PromiseSettledResult<Metric> }): Metric {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return this.metricService.getMetricSummary({
      end,
      error:
        result.reason instanceof UpstreamError
          ? result.reason.message
          : "DigitalOcean returned invalid metric data.",
      points: [],
      start,
    });
  }
}
