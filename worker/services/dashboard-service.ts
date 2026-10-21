import { dashboardResponseSchema } from "../../shared/schemas";
import {
  TIME_RANGES,
  type DashboardResponse,
  type DropletMetrics,
  type TimeRange,
} from "../../shared/types";
import { digitalOceanConfigSchema } from "../schemas";
import { CryptoService } from "./crypto";
import { DropletService } from "./droplet-service";
import { ServiceError } from "./errors";

interface DashboardOptions {
  ids: string;
  origin: string;
  token: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

export class DashboardService {
  public constructor(private readonly options: DashboardOptions) {}

  public async getDashboardByTimeRange(
    range: TimeRange,
  ): Promise<DashboardResponse> {
    const config = digitalOceanConfigSchema.safeParse(this.options);

    if (!config.success) {
      throw new ServiceError({
        code: "not_configured",
        message:
          "Add your DigitalOcean API token and two Droplet IDs to the Worker secrets to connect live metrics.",
        status: 503,
      });
    }

    const { ids, token } = config.data;
    // Round to the minute to share requests and avoid repeated upstream calls.
    const end = Math.floor(Date.now() / 60_000) * 60;
    const start = end - TIME_RANGES[range].seconds;

    const [cache, fingerprint] = await Promise.all([
      caches.open("droplet-metrics-v1"),
      CryptoService.getHashString(`${token}:${ids.join(",")}`),
    ]);

    const key = new Request(
      `${this.options.origin}/__metrics-cache/${fingerprint}/${range}/${end}`,
    );

    const cached = await cache.match(key);

    if (cached) {
      return dashboardResponseSchema.parse(await cached.json());
    }

    const service = new DropletService(token);
    const requests: Promise<DropletMetrics>[] = [];

    for (const [slot, dropletId] of ids.entries()) {
      requests.push(
        service.getMetricsByDropletId({ dropletId, end, slot, start }),
      );
    }

    const droplets = await Promise.all(requests);

    const body: DashboardResponse = {
      droplets,
      end,
      fetchedAt: Math.floor(Date.now() / 1000),
      range,
      start,
    };

    // Retain successful results so failed requests can recover immediately.
    if (this.isDashboardCacheable(droplets)) {
      this.options.waitUntil(
        cache.put(
          key,
          Response.json(body, {
            headers: { "Cache-Control": "public, max-age=55" },
          }),
        ),
      );
    }

    return body;
  }

  private isDashboardCacheable(droplets: DropletMetrics[]): boolean {
    for (const droplet of droplets) {
      if (droplet.issue) {
        return false;
      }

      for (const metric of Object.values(droplet.metrics)) {
        if (metric.error) {
          return false;
        }
      }
    }

    return true;
  }
}
