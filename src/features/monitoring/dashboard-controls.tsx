import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RangeSelect } from "./range-select";
import type { TimeRange } from "../../../shared/types";

export const DashboardControls = ({
  autoRefresh,
  fetching,
  onAutoRefreshChange,
  onRangeChange,
  onRefresh,
  range,
}: {
  autoRefresh: boolean;
  fetching: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onRangeChange: (range: TimeRange) => void;
  onRefresh: () => void;
  range: TimeRange;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <div className="flex items-center gap-2 sm:mr-2">
      <Switch
        aria-label="Auto-refresh"
        checked={autoRefresh}
        id="auto-refresh"
        onCheckedChange={onAutoRefreshChange}
        size="sm"
      />
      <label className="text-sm text-muted-foreground" htmlFor="auto-refresh">
        Auto-refresh
      </label>
    </div>
    <div className="flex items-center gap-2">
      <RangeSelect onChange={onRangeChange} value={range} />
      <Button
        aria-label="Refresh metrics"
        disabled={fetching}
        onClick={onRefresh}
        size="icon"
        variant="outline"
      >
        <RefreshCw
          aria-hidden="true"
          className={cn({ inputs: [fetching && "animate-spin"] })}
        />
      </Button>
    </div>
  </div>
);
