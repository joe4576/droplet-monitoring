import { z } from "zod";

export const timeRangeSchema = z.enum(["1h", "6h", "1d", "7d", "14d"]);

export const TIME_RANGES = {
  "14d": { label: "Last 14 days", seconds: 1209600 },
  "1d": { label: "Last 1 day", seconds: 86400 },
  "1h": { label: "Last 1 hour", seconds: 3600 },
  "6h": { label: "Last 6 hours", seconds: 21600 },
  "7d": { label: "Last 7 days", seconds: 604800 },
} as const satisfies Record<
  z.infer<typeof timeRangeSchema>,
  {
    label: string;
    seconds: number;
  }
>;

export const metricsQuerySchema = z.object({
  range: timeRangeSchema.default("1h"),
});

export const loginSchema = z.object({
  apiKey: z.string().min(1).max(1024),
});

export const sessionResponseSchema = z.object({
  authenticated: z.literal(true),
  expiresAt: z.number(),
});

export const metricNameSchema = z.enum(["cpu", "memory", "disk"]);

export const metricPointSchema = z.object({
  timestamp: z.number(),
  value: z.number().nullable(),
});

export const metricSchema = z.object({
  average: z.number().nullable(),
  current: z.number().nullable(),
  error: z.string().nullable(),
  peak: z.number().nullable(),
  points: z.array(metricPointSchema),
  sampledAt: z.number().nullable(),
});

export const dropletMetricsSchema = z.object({
  diskGb: z.number().nullable(),
  issue: z.string().nullable(),
  // An opaque slot, never the secret Droplet ID.
  key: z.string(),
  memoryMb: z.number().nullable(),
  metrics: z.record(metricNameSchema, metricSchema),
  name: z.string(),
  region: z.string().nullable(),
  status: z.string().nullable(),
  vcpus: z.number().nullable(),
});

export const dashboardResponseSchema = z.object({
  droplets: z.array(dropletMetricsSchema),
  end: z.number(),
  fetchedAt: z.number(),
  range: timeRangeSchema,
  start: z.number(),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
