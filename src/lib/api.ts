import type {
  ApiError,
  DashboardResponse,
  TimeRange,
} from "../../shared/types";
import { apiErrorSchema, dashboardResponseSchema } from "../../shared/schemas";

export class DashboardError extends Error {
  readonly code: string;

  constructor(error: ApiError) {
    super(error.message);

    this.code = error.code;
  }
}

export const fetchMetrics = async ({
  range,
  signal,
}: {
  range: TimeRange;
  signal: AbortSignal;
}): Promise<DashboardResponse> => {
  const response = await fetch(`/api/metrics?range=${range}`, { signal });

  if (response.status === 401) {
    window.location.replace("/login");

    throw new DashboardError({
      code: "unauthorized",
      message: "Your session has expired. Sign in again.",
    });
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json());

    if (parsed.success) {
      throw new DashboardError(parsed.data);
    }

    throw new Error("Metrics could not be loaded. Try again shortly.");
  }

  return dashboardResponseSchema.parse(await response.json());
};
