import type { z } from "zod";
import {
  timeRangeSchema,
  type apiErrorSchema,
  type dashboardResponseSchema,
  type dropletMetricsSchema,
  type loginSchema,
  type metricNameSchema,
  type metricPointSchema,
  type metricSchema,
  type metricsQuerySchema,
  type sessionResponseSchema,
} from "./schemas";

export { TIME_RANGES } from "./schemas";

export type TimeRange = z.infer<typeof timeRangeSchema>;

export type MetricName = z.infer<typeof metricNameSchema>;

export type MetricPoint = z.infer<typeof metricPointSchema>;

export type Metric = z.infer<typeof metricSchema>;

export type DropletMetrics = z.infer<typeof dropletMetricsSchema>;

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

export type ApiError = z.infer<typeof apiErrorSchema>;

export type Login = z.infer<typeof loginSchema>;

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const isTimeRange = (value: string): value is TimeRange => {
  return timeRangeSchema.safeParse(value).success;
};
