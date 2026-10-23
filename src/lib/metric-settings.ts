import type { MetricName } from "../../shared/types";

export const METRIC_NAMES: MetricName[] = ["cpu", "memory", "disk"];

export const METRICS = {
  cpu: {
    color: "var(--chart-1)",
    description: "Total CPU utilization across all cores, normalized to 100%.",
    label: "CPU usage",
  },
  disk: {
    color: "var(--chart-3)",
    description:
      "Used space on the root filesystem. Attached volumes and other mounts are excluded.",
    label: "Disk usage",
  },
  memory: {
    color: "var(--chart-2)",
    description:
      "Used memory as a percentage of total memory. Free and cached memory are excluded.",
    label: "Memory usage",
  },
} as const;

export const formatPercent = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
