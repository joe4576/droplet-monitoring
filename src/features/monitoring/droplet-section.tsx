import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { METRIC_NAMES } from "@/lib/metric-settings";
import { cn } from "@/lib/utils";
import { MetricChart } from "./metric-chart";
import type { DropletMetrics, TimeRange } from "../../../shared/types";

const ChartSkeleton = () => <Skeleton className="h-80 rounded-xl" />;

export const DropletSkeleton = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="space-y-2">
      <Skeleton className="h-6 w-52" />
      <Skeleton className="h-4 w-64 max-w-full" />
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {METRIC_NAMES.map((name) => (
        <ChartSkeleton key={name} />
      ))}
    </div>
  </div>
);

export const DropletSection = ({
  droplet,
  end,
  range,
  start,
}: {
  droplet: DropletMetrics;
  end: number;
  range: TimeRange;
  start: number;
}) => {
  const specs = [
    droplet.region?.toUpperCase(),
    droplet.vcpus === null ? null : `${droplet.vcpus} vCPUs`,
    droplet.memoryMb === null ? null : `${droplet.memoryMb / 1024} GB RAM`,
    droplet.diskGb === null ? null : `${droplet.diskGb} GB disk`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby={`${droplet.key}-title`} className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            className="min-w-0 break-all text-lg font-medium"
            id={`${droplet.key}-title`}
          >
            {droplet.name}
          </h2>
          <Badge
            className={cn({
              inputs: [
                "capitalize",
                droplet.status === "active" && "text-emerald-400",
              ],
            })}
            variant="outline"
          >
            {droplet.status ?? "Unknown status"}
          </Badge>
        </div>
        {specs && <p className="text-sm text-muted-foreground">{specs}</p>}
        {droplet.issue && (
          <p className="text-sm text-destructive" role="alert">
            {droplet.issue}
          </p>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {METRIC_NAMES.map((name) => (
          <MetricChart
            dropletName={droplet.name}
            end={end}
            key={name}
            metric={droplet.metrics[name]}
            name={name}
            range={range}
            start={start}
          />
        ))}
      </div>
    </section>
  );
};
