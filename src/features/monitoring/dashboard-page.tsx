import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/feedback";
import { PageHeader } from "@/components/page-header";
import { DashboardControls } from "./dashboard-controls";
import { DropletSection, DropletSkeleton } from "./droplet-section";
import { useDashboard } from "./use-dashboard";

export const DashboardPage = () => {
  const {
    autoRefresh,
    changeDemo,
    demo,
    notConfigured,
    query,
    range,
    refresh,
    setAutoRefresh,
    setRange,
  } = useDashboard();

  const data = query.data;

  return (
    <div className="space-y-8">
      <PageHeader
        action={
          <DashboardControls
            autoRefresh={autoRefresh}
            fetching={query.isFetching}
            onAutoRefreshChange={setAutoRefresh}
            onRangeChange={setRange}
            onRefresh={refresh}
            range={range}
          />
        }
        title="Droplets"
      >
        <p className="text-sm text-muted-foreground">
          {data
            ? `Updated ${new Date(data.fetchedAt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
            : "CPU, memory, and disk usage."}
        </p>
      </PageHeader>
      {demo && (
        <Feedback
          action={
            <Button
              onClick={() => changeDemo(false)}
              size="sm"
              variant="outline"
            >
              Exit demo
            </Button>
          }
        >
          Demo data. Showing two example droplets.
        </Feedback>
      )}
      {notConfigured && (
        <Feedback
          action={
            <Button
              onClick={() => changeDemo(true)}
              size="sm"
              variant="outline"
            >
              View demo
            </Button>
          }
          title="Monitoring isn't configured"
        >
          Add your DigitalOcean token and Droplet IDs using the setup
          instructions in the README.
        </Feedback>
      )}
      {query.isError && !notConfigured && (
        <Feedback
          action={
            <Button
              disabled={query.isFetching}
              onClick={refresh}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          }
          error
          title="Couldn't refresh metrics"
        >
          {query.error.message}
          {data && " Showing the last successful results."}
        </Feedback>
      )}
      {query.isPending ? (
        <div aria-label="Loading metrics" role="status" className="space-y-8">
          <DropletSkeleton />
          <DropletSkeleton />
        </div>
      ) : (
        data?.droplets.map((droplet) => (
          <DropletSection
            droplet={droplet}
            end={data.end}
            key={droplet.key}
            range={data.range}
            start={data.start}
          />
        ))
      )}
      {data?.droplets.length === 0 && (
        <Feedback title="No droplets found">
          Check your configured Droplet IDs, then refresh.
        </Feedback>
      )}
    </div>
  );
};
