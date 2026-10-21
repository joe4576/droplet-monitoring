import { Hono } from "hono";
import { validator } from "hono/validator";
import { metricsQuerySchema } from "../../shared/schemas";
import type { AppEnv } from "../context";
import { json, methodNotAllowed } from "../http";

export const metricsRoutes = new Hono<AppEnv>()
  .use("/api/metrics", async (c, next) => {
    if (c.req.method !== "GET") {
      return methodNotAllowed("GET");
    }

    await next();
  })
  .get(
    "/api/metrics",
    validator("query", (query) => {
      const parsed = metricsQuerySchema.safeParse(query);

      if (!parsed.success) {
        return json({
          body: {
            code: "invalid_range",
            message: "Choose a supported date range: 1h, 6h, 1d, 7d, or 14d.",
          },
          status: 400,
        });
      }

      return parsed.data;
    }),
    async (c) => {
      const { range } = c.req.valid("query");

      const dashboard = await c
        .get("dashboardService")
        .getDashboardByTimeRange(range);

      return json({ body: dashboard });
    },
  );
