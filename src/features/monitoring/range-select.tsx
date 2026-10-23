import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isTimeRange,
  TIME_RANGES,
  type TimeRange,
} from "../../../shared/types";

const ranges = Object.entries(TIME_RANGES).sort(
  ([, a], [, b]) => a.seconds - b.seconds,
);

export const RangeSelect = ({
  onChange,
  value,
}: {
  onChange: (range: TimeRange) => void;
  value: TimeRange;
}) => (
  <Select
    onValueChange={(range) => {
      if (isTimeRange(range)) {
        onChange(range);
      }
    }}
    value={value}
  >
    <SelectTrigger aria-label="Time range" className="w-40">
      <SelectValue />
    </SelectTrigger>
    <SelectContent align="end" position="popper">
      {ranges.map(([range, { label }]) => (
        <SelectItem key={range} value={range}>
          {label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
