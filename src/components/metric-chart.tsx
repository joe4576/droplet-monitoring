import { useId } from "react";
import { METRICS, formatPercent } from "@/lib/metric-settings";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleHelp, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Metric, MetricName, TimeRange } from "../../shared/types";

const timeLabel = ({
  range,
  timestamp,
}: {
  range: TimeRange;
  timestamp: number;
}): string => {
  return new Date(timestamp * 1000).toLocaleString(
    undefined,
    range === "7d" || range === "14d"
      ? { day: "numeric", month: "short" }
      : { hour: "2-digit", hour12: false, minute: "2-digit" },
  );
};

interface Props {
  connected: boolean;
  dropletName: string;
  end: number;
  loading: boolean;
  metric?: Metric;
  name: MetricName;
  range: TimeRange;
  start: number;
}

export const MetricChart = ({
  connected,
  dropletName,
  end,
  loading,
  metric,
  name,
  range,
  start,
}: Props) => {
  const gradientId = `gradient-${useId().replaceAll(":", "")}`;

  const { Icon, color, description, label } = METRICS[name];

  const hasData = !!metric?.points.some((point) => point.value !== null);

  const stale = !!metric?.sampledAt && end - metric.sampledAt > 300;

  const ticks = Array.from(
    { length: 5 },
    (_, i) => start + ((end - start) * i) / 4,
  );

  return (
    <Card className="metric-card" aria-label={`${dropletName} ${label}`}>
      <div className="metric-card-header">
        <div className="metric-title">
          <Icon size={15} style={{ color }} />
          <h3>{label}</h3>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="help-button"
              aria-label={`About ${label.toLowerCase()}`}
            >
              <CircleHelp size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{description}</TooltipContent>
        </Tooltip>
      </div>
      <div className="metric-reading">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <strong>{formatPercent(metric?.current)}</strong>
        )}
        <span>{stale ? "Last reported" : "Latest sample"}</span>
      </div>
      {loading ? (
        <Skeleton className="chart-skeleton" />
      ) : hasData ? (
        <div
          className="chart-container"
          role="img"
          aria-label={`${label} over the selected period. Latest ${formatPercent(metric?.current)}, average ${formatPercent(metric?.average)}, peak ${formatPercent(metric?.peak)}.`}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart
              data={metric?.points}
              margin={{ bottom: 0, left: -10, right: 9, top: 8 }}
              accessibilityLayer
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.015} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="#e9edf4"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={[start, end]}
                ticks={ticks}
                tickFormatter={(value: number) =>
                  timeLabel({ range, timestamp: value })
                }
                tick={{ fill: "#8a96a8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickMargin={10}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value: number) => `${value}%`}
                tick={{ fill: "#8a96a8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <ChartTooltip
                cursor={{
                  stroke: color,
                  strokeDasharray: "3 3",
                  strokeWidth: 1,
                }}
                content={({ active, label: timestamp, payload }) =>
                  active && payload?.length ? (
                    <div className="chart-tooltip">
                      <span>
                        {new Date(Number(timestamp) * 1000).toLocaleString(
                          undefined,
                          {
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            month: "short",
                          },
                        )}
                      </span>
                      <strong>
                        <i style={{ background: color }} />
                        {label}
                        <b>
                          {formatPercent(
                            typeof payload[0]?.value === "number"
                              ? payload[0].value
                              : null,
                          )}
                        </b>
                      </strong>
                    </div>
                  ) : null
                }
              />
              <Area
                type="linear"
                dataKey="value"
                name={label}
                stroke={color}
                strokeWidth={1.8}
                fill={`url(#${gradientId})`}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4, stroke: "white", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-empty">
          <Radio size={21} />
          <p>{connected ? "No metric data" : "Awaiting connection"}</p>
          <span>
            {metric?.error ?? "Connect DigitalOcean to see usage over time."}
          </span>
        </div>
      )}
      <div className="metric-card-footer">
        <span>
          <i style={{ background: color }} />
          {name === "disk"
            ? "Root filesystem"
            : name === "cpu"
              ? "All vCPUs"
              : "Excludes cache"}
        </span>
        <span>
          Avg <b>{formatPercent(metric?.average)}</b>
          <span className="footer-divider">/</span>Peak{" "}
          <b>{formatPercent(metric?.peak)}</b>
        </span>
      </div>
      {stale && (
        <p className="stale-note">
          Last sample {new Date(metric!.sampledAt! * 1000).toLocaleString()}.
          Telemetry may be delayed.
        </p>
      )}
    </Card>
  );
};
