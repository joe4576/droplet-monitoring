import { URL as NodeURL } from "node:url";
import {
  Miniflare,
  Response as RuntimeResponse,
  convertV4MiniflareOptions,
  type V4FetchHandler,
} from "miniflare";
import { getRuntimeModule } from "./testing/runtime";
import { describe, expect, it } from "vitest";
import type { DropletMetrics } from "../shared/types";

const runtime = async (outboundService: V4FetchHandler) => {
  const modules = [
    await getRuntimeModule({
      contents: `import { DropletService } from './services/droplet-service';
      export default { fetch: async () => {
        const service = new DropletService('fixture-token');
        return Response.json(await service.getMetricsByDropletId({ dropletId: '123456789', end: 60, slot: 0, start: 0 }));
      } };`,
      entry: new NodeURL("./runtime-entry.ts", import.meta.url),
    }),
  ];

  // Run the production integration in workerd, rather than a Node fetch mock.
  // A Node mock previously missed an unsupported redirect option in this runtime.
  return new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: "2026-10-19",
      modules,
      name: "digitalocean-runtime-test",
      outboundService,
    }),
  );
};

describe("DigitalOcean integration in the Worker runtime", () => {
  it("fetches and parses authenticated metadata and all three metrics", async () => {
    let requests = 0;

    const mf = await runtime((request) => {
      requests++;

      const url = new URL(request.url);

      expect(url.origin).toBe("https://api.digitalocean.com");

      expect(request.headers.get("Authorization")).toBe("Bearer fixture-token");

      if (url.pathname.includes("/droplets/")) {
        return RuntimeResponse.json({
          droplet: {
            disk: 80,
            memory: 4096,
            name: "production",
            region: { slug: "lon1" },
            status: "active",
            vcpus: 2,
          },
        });
      }

      const kind = url.pathname.split("/").at(-1);

      const series = ({
        labels = {},
        value,
      }: {
        labels?: Record<string, string>;
        value: number;
      }) => ({
        metric: labels,
        values: [
          [0, String(value)],
          [60, String(value)],
        ],
      });

      const result =
        kind === "cpu"
          ? [
              {
                metric: { mode: "idle" },
                values: [
                  [0, "800"],
                  [60, "890"],
                ],
              },
              {
                metric: { mode: "user" },
                values: [
                  [0, "200"],
                  [60, "230"],
                ],
              },
            ]
          : [
              series({
                labels: { device: "/dev/vda1", mountpoint: "/" },
                value:
                  kind?.endsWith("total") || kind?.endsWith("size")
                    ? 1000
                    : 100,
              }),
            ];

      return RuntimeResponse.json({ data: { result }, status: "success" });
    });

    try {
      const response = await mf.dispatchFetch("https://runtime.test/");

      const data = (await response.json()) as DropletMetrics;

      expect(requests).toBe(7);

      expect(data.issue).toBeNull();

      expect(data.metrics.cpu.current).toBeCloseTo(25);

      expect(data.metrics.memory.current).toBe(80);

      expect(data.metrics.disk.current).toBe(90);
    } finally {
      await mf.dispose();
    }
  });

  it("rejects redirects without forwarding credentials to another origin", async () => {
    const hosts: string[] = [];

    const mf = await runtime((request) => {
      hosts.push(new URL(request.url).hostname);

      return new RuntimeResponse(null, {
        headers: { Location: "https://untrusted.test/" },
        status: 307,
      });
    });

    try {
      const response = await mf.dispatchFetch("https://runtime.test/");

      const data = (await response.json()) as DropletMetrics;

      expect(hosts).toHaveLength(7);

      expect(new Set(hosts)).toEqual(new Set(["api.digitalocean.com"]));

      expect(data.metrics.cpu.current).toBeNull();

      expect(data.metrics.cpu.error).toContain("unexpected redirect");
    } finally {
      await mf.dispose();
    }
  });
});
