import { Cpu, HardDrive, MemoryStick } from "lucide-react";

export const METRICS = {
  cpu: {
    Icon: Cpu,
    color: "#2374ef",
    description: "Total CPU utilization across all cores, normalized to 100%.",
    label: "CPU usage",
  },
  disk: {
    Icon: HardDrive,
    color: "#8b5cdb",
    description:
      "Used space on the root filesystem. Attached volumes and other mounts are excluded.",
    label: "Disk usage",
  },
  memory: {
    Icon: MemoryStick,
    color: "#0b9e91",
    description:
      "Used memory as a percentage of total memory. Free and cached memory are excluded.",
    label: "Memory usage",
  },
} as const;

export const formatPercent = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
