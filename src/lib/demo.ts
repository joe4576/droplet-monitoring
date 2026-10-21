import {
  TIME_RANGES,
  type DashboardResponse,
  type Metric,
  type MetricName,
  type TimeRange,
} from "../../shared/types";

// Deliberately local and opt-in. Demo data never substitutes for a live API failure.
export const demoMetrics = (range: TimeRange): DashboardResponse => {
  const end = Math.floor(Date.now() / 60000) * 60;

  const start = end - TIME_RANGES[range].seconds;

  const makeMetric = ({
    name,
    slot,
  }: {
    name: MetricName;
    slot: number;
  }): Metric => {
    const points = Array.from({ length: 180 }, (_, i) => {
      const phase = i / 179;

      let value: number;

      if (name === "cpu") {
        const spike =
          Math.exp(-Math.pow((phase - (slot === 0 ? 0.57 : 0.3)) / 0.035, 2)) *
          (slot === 0 ? 48 : 27);

        value =
          (slot === 0 ? 13 : 7) +
          Math.sin(i * 1.8) * 2.5 +
          Math.sin(i * 0.25) * 3 +
          spike;
      } else if (name === "memory") {
        value =
          (slot === 0 ? 38 : 52) +
          phase * 5 +
          Math.sin(i * 0.09) * 1.6 +
          Math.sin(i * 0.9) * 0.45;
      } else {
        value = (slot === 0 ? 27 : 43) + phase * 1.4 + Math.sin(i * 0.2) * 0.08;
      }

      return { timestamp: Math.round(start + phase * (end - start)), value };
    });

    return {
      average:
        points.reduce((sum, point) => sum + point.value, 0) / points.length,
      current: points.at(-1)!.value,
      error: null,
      peak: Math.max(...points.map((point) => point.value)),
      points,
      sampledAt: end,
    };
  };

  return {
    droplets: [0, 1].map((slot) => ({
      diskGb: 80,
      issue: null,
      key: `droplet-${slot + 1}`,
      memoryMb: 4096,
      metrics: {
        cpu: makeMetric({ name: "cpu", slot }),
        disk: makeMetric({ name: "disk", slot }),
        memory: makeMetric({ name: "memory", slot }),
      },
      name: slot === 0 ? "web-production-01" : "worker-production-02",
      region: "lon1",
      status: "active",
      vcpus: 2,
    })),
    end,
    fetchedAt: end,
    range,
    start,
  };
};
