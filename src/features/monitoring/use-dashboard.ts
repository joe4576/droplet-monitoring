import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardError, fetchMetrics } from "@/lib/api";
import { demoMetrics } from "@/lib/demo";
import { type TimeRange } from "../../../shared/types";

export const useDashboard = () => {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [demo, setDemo] = useState(
    () => new URLSearchParams(window.location.search).get("demo") === "1",
  );

  const [range, setRange] = useState<TimeRange>("1h");

  const query = useQuery({
    queryFn: ({ signal }) =>
      demo
        ? Promise.resolve(demoMetrics(range))
        : fetchMetrics({ range, signal }),
    queryKey: ["metrics", range, demo],
    refetchInterval: autoRefresh ? 60000 : false,
    retry: false,
    staleTime: 30000,
  });

  const notConfigured =
    query.error instanceof DashboardError &&
    query.error.code === "not_configured";

  const changeDemo = (enabled: boolean) => {
    const url = new URL(window.location.href);

    if (enabled) {
      url.searchParams.set("demo", "1");
    } else {
      url.searchParams.delete("demo");
    }

    window.history.replaceState(null, "", url);
    setDemo(enabled);
  };

  const refresh = () => {
    void query.refetch();
  };

  return {
    autoRefresh,
    changeDemo,
    demo,
    notConfigured,
    query,
    range,
    refresh,
    setAutoRefresh,
    setRange,
  };
};
