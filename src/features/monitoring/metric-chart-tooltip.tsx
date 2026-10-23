import type { TooltipContentProps } from "recharts";
import { formatPercent } from "@/lib/metric-settings";

export const MetricChartTooltip = ({
  active,
  label,
  payload,
}: Pick<
  TooltipContentProps<number, string>,
  "active" | "label" | "payload"
>) => {
  const point = payload?.[0];

  if (!active || !point) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-2 text-muted-foreground">
        {new Date(Number(label) * 1000).toLocaleString(undefined, {
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
        })}
      </p>
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{ background: point.color }}
        />
        <span>{point.name}</span>
        <span className="ml-3 font-medium tabular-nums">
          {formatPercent(typeof point.value === "number" ? point.value : null)}
        </span>
      </div>
    </div>
  );
};
