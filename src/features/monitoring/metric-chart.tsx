import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { METRICS, formatPercent } from "@/lib/metric-settings";
import { MetricChartTooltip } from "./metric-chart-tooltip";
import type { Metric, MetricName, TimeRange } from "../../../shared/types";

const timeLabel = ({
  range,
  timestamp,
}: {
  range: TimeRange;
  timestamp: number;
}): string =>
  new Date(timestamp * 1000).toLocaleString(
    undefined,
    range === "7d" || range === "14d"
      ? { day: "numeric", month: "short" }
      : { hour: "2-digit", hour12: false, minute: "2-digit" },
  );

export const MetricChart = ({
  dropletName,
  end,
  metric,
  name,
  range,
  start,
}: {
  dropletName: string;
  end: number;
  metric: Metric;
  name: MetricName;
  range: TimeRange;
  start: number;
}) => {
  const gradientId = `gradient-${useId().replaceAll(":", "")}`;
  const { color, description, label } = METRICS[name];
  const hasData = metric.points.some((point) => point.value !== null);
  const stale = metric.sampledAt !== null && end - metric.sampledAt > 300;

  const ticks = Array.from(
    { length: 3 },
    (_, index) => start + ((end - start) * index) / 2,
  );

  return (
    <Card aria-label={`${dropletName} ${label}`} className="min-w-0 gap-4 pb-0">
      <CardHeader className="gap-3">
        <h3
          className="text-sm font-medium text-muted-foreground"
          title={description}
        >
          {label}
        </h3>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatPercent(metric.current)}
        </p>
      </CardHeader>
      <CardContent className="px-3">
        {hasData ? (
          <div
            aria-label={`${label} over the selected period. Latest ${formatPercent(metric.current)}, average ${formatPercent(metric.average)}, peak ${formatPercent(metric.peak)}.`}
            className="h-40 min-w-0"
            role="img"
          >
            <ResponsiveContainer height="100%" minWidth={0} width="100%">
              <AreaChart
                accessibilityLayer
                data={metric.points}
                margin={{ bottom: 0, left: 0, right: 12, top: 8 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="timestamp"
                  domain={[start, end]}
                  minTickGap={16}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(value: number) =>
                    timeLabel({ range, timestamp: value })
                  }
                  tickLine={false}
                  tickMargin={10}
                  ticks={ticks}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  domain={[0, 100]}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(value: number) => `${value}%`}
                  tickLine={false}
                  ticks={[0, 50, 100]}
                  width={40}
                />
                <Tooltip
                  content={MetricChartTooltip}
                  cursor={{
                    stroke: "var(--muted-foreground)",
                    strokeDasharray: "3 3",
                  }}
                />
                <Area
                  activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls={false}
                  dataKey="value"
                  dot={false}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  name={label}
                  stroke={color}
                  strokeWidth={1.5}
                  type="linear"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center px-3 text-center text-sm text-muted-foreground">
            {metric.error ?? "No samples in this time range."}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2 border-t py-3 text-xs text-muted-foreground [.border-t]:pt-3">
        <span>
          Average{" "}
          <span className="ml-1 text-foreground tabular-nums">
            {formatPercent(metric.average)}
          </span>
        </span>
        <span>
          Peak{" "}
          <span className="ml-1 text-foreground tabular-nums">
            {formatPercent(metric.peak)}
          </span>
        </span>
      </CardFooter>
      {(stale || (hasData && metric.error)) && (
        <p className="px-6 pb-4 text-xs text-destructive" role="status">
          {metric.error ??
            `Last sample ${new Date(metric.sampledAt! * 1000).toLocaleString()}. Telemetry may be delayed.`}
        </p>
      )}
    </Card>
  );
};
