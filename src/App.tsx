import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  Droplet,
  ExternalLink,
  FlaskConical,
  Info,
  LayoutDashboard,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { METRICS, formatPercent } from '@/lib/metric-settings'
import { DashboardError, fetchMetrics } from '@/lib/api'
import { demoMetrics } from '@/lib/demo'
import {
  isTimeRange,
  TIME_RANGES,
  type DropletMetrics,
  type MetricName,
  type Metric,
  type TimeRange,
} from '../shared/types'
import { cn } from '@/lib/utils'

const MetricChart = lazy(() =>
  import('@/components/metric-chart').then((module) => ({
    default: module.MetricChart,
  })),
)

const metricNames: MetricName[] = ['cpu', 'memory', 'disk']
const docsUrl = 'https://docs.digitalocean.com/products/monitoring/'
const emptyMetric: Metric = {
  points: [],
  current: null,
  average: null,
  peak: null,
  sampledAt: null,
  error: null,
}

function App() {
  const [initialEnd] = useState(() => Math.floor(Date.now() / 1000))
  const [range, setRange] = useState<TimeRange>('1h')
  const [demo, setDemo] = useState(
    () => new URLSearchParams(window.location.search).get('demo') === '1',
  )
  const [autoRefresh, setAutoRefresh] = useState(true)
  const query = useQuery({
    queryKey: ['metrics', range, demo],
    queryFn: ({ signal }) =>
      demo ? Promise.resolve(demoMetrics(range)) : fetchMetrics(range, signal),
    refetchInterval: autoRefresh ? 60_000 : false,
    staleTime: 30_000,
    retry: false,
  })
  const data = query.data
  const notConfigured =
    query.error instanceof DashboardError &&
    query.error.code === 'not_configured'
  const connected = !!data
  const droplets = data?.droplets
  const end = data?.end ?? initialEnd
  const start = data?.start ?? end - TIME_RANGES[range].seconds
  const placeholders: DropletMetrics[] = [0, 1].map((i) => ({
    key: `droplet-${i + 1}`,
    name: `Droplet ${i + 1}`,
    region: null,
    vcpus: null,
    memoryMb: null,
    diskGb: null,
    status: null,
    issue: null,
    metrics: { cpu: emptyMetric, memory: emptyMetric, disk: emptyMetric },
  }))
  const shown = droplets ?? placeholders
  const changeDemo = (enabled: boolean) => {
    setDemo(enabled)
    const url = new URL(window.location.href)
    if (enabled) url.searchParams.set('demo', '1')
    else url.searchParams.delete('demo')
    window.history.replaceState(null, '', url)
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to insights
      </a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <a className="brand" href="#main" aria-label="Droplet monitoring home">
          <span className="brand-mark">
            <Droplet fill="currentColor" size={23} />
          </span>
          <span>
            droplet<span className="brand-subtitle">MONITORING</span>
          </span>
        </a>
        <div className="workspace-select">
          <span className="workspace-avatar">W</span>
          <div>
            My workspace<small>Infrastructure overview</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <p className="nav-label">OBSERVABILITY</p>
        <a className="nav-item active" href="#main" aria-current="page">
          <LayoutDashboard size={17} />
          Insights<span className="nav-pill">2</span>
        </a>
        <div className="sidebar-droplets">
          <p className="nav-label">YOUR DROPLETS</p>
          {shown.map((droplet, i) => (
            <a
              key={droplet.key}
              className="sidebar-droplet"
              href={`#${droplet.key}`}
            >
              <span
                className={cn('droplet-indicator', i === 1 && 'secondary')}
              />
              <span>
                {droplet.name}
                <small>
                  {droplet.region?.toUpperCase() ?? 'Not connected'}
                </small>
              </span>
            </a>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="connection-note">
            <ShieldCheck size={18} />
            <div>
              Read-only monitoring<small>Credentials stay on the server</small>
            </div>
          </div>
          <a href={docsUrl} target="_blank" rel="noreferrer">
            DigitalOcean documentation
            <ExternalLink size={13} />
          </a>
          <div className="sidebar-foot">
            <Cloud size={15} />
            <span>Powered by Cloudflare Workers</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span>Infrastructure</span>
            <ChevronRight size={13} />
            <strong>Insights</strong>
          </div>
          <div className="topbar-right">
            <span
              className={cn(
                'status-dot',
                !connected && 'disconnected',
                demo && 'demo-dot',
              )}
            />
            <span>
              {demo
                ? 'Demo environment'
                : connected
                  ? 'DigitalOcean connected'
                  : 'DigitalOcean monitoring'}
            </span>
            <span className="account-avatar">W</span>
          </div>
        </header>
        <main id="main" className="dashboard">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <Activity size={14} /> INFRASTRUCTURE MONITORING
              </div>
              <h1>
                Droplet insights<span className="count-badge">2 droplets</span>
              </h1>
              <p>A closer look at how your infrastructure is performing.</p>
            </div>
            <a
              className="documentation-link"
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
            >
              View documentation
              <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="toolbar">
            <div className="toolbar-label">
              <span
                className={cn(
                  'status-dot',
                  demo && 'demo-dot',
                  !connected && 'disconnected',
                )}
              />
              <span>
                {demo
                  ? 'Demo data'
                  : connected
                    ? 'Live metrics'
                    : 'Waiting for metrics'}
              </span>
              <span className="toolbar-divider" />
              <span className="toolbar-muted">
                {data
                  ? `Updated ${new Date(data.fetchedAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                  : 'Not connected'}
              </span>
            </div>
            <div className="toolbar-actions">
              <div className="refresh-toggle">
                <Switch
                  id="auto-refresh"
                  size="sm"
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                />
                <label htmlFor="auto-refresh">Auto-refresh</label>
              </div>
              <Select
                value={range}
                onValueChange={(value) => {
                  if (isTimeRange(value)) setRange(value)
                }}
              >
                <SelectTrigger className="range-select" aria-label="Date range">
                  <Clock3 size={15} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  {Object.entries(TIME_RANGES).map(([value, item]) => (
                    <SelectItem key={value} value={value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="refresh-button"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => {
                  void query.refetch()
                }}
                aria-label="Refresh metrics"
              >
                <RefreshCw
                  size={15}
                  className={cn(query.isFetching && 'animate-spin')}
                />
                <span>Refresh</span>
              </Button>
            </div>
          </div>
          {demo && (
            <div className="notice demo-notice" role="status">
              <FlaskConical size={18} />
              <div>
                <strong>You're exploring demo data.</strong>
                <span>These are sample metrics for two example droplets.</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeDemo(false)}
              >
                Connect live metrics
                <ArrowUpRight size={14} />
              </Button>
            </div>
          )}
          {!demo && notConfigured && (
            <div className="notice setup-notice" role="status">
              <Info size={19} />
              <div>
                <strong>Your dashboard is ready to connect.</strong>
                <span>
                  Add the DigitalOcean token and two Droplet IDs to your Worker
                  secrets. See the project README for setup.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => changeDemo(true)}
              >
                Preview demo
                <ArrowUpRight size={14} />
              </Button>
            </div>
          )}
          {query.isError && !notConfigured && (
            <div className="notice error-notice" role="alert">
              <TriangleAlert size={19} />
              <div>
                <strong>Couldn't refresh metrics.</strong>
                <span>
                  {query.error.message}
                  {data ? ' Showing the last successful results.' : ''}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void query.refetch()
                }}
              >
                Try again
              </Button>
            </div>
          )}
          <section className="overview" aria-label="Fleet overview">
            {metricNames.map((name) => {
              const { label, Icon, color } = METRICS[name]
              const values =
                droplets
                  ?.map((droplet) => droplet.metrics[name].current)
                  .filter((value): value is number => value !== null) ?? []
              const average = values.length
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : null
              return (
                <Card key={name} className="overview-card">
                  <div className="overview-top">
                    <span>{label}</span>
                    <span className={`metric-icon ${name}`}>
                      <Icon size={17} />
                    </span>
                  </div>
                  <div className="overview-reading">
                    <strong>{formatPercent(average)}</strong>
                    <span>fleet average</span>
                  </div>
                  <div className="usage-track">
                    <span
                      style={{ width: `${average ?? 0}%`, background: color }}
                    />
                  </div>
                  <div className="overview-caption">
                    <span>{values.length} of 2 droplets reporting</span>
                    <span className="muted">Latest samples</span>
                  </div>
                </Card>
              )
            })}
          </section>
          <div className="section-heading">
            <h2>Resource usage</h2>
            <span>
              <Clock3 size={12} />
              Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
          <div className="droplet-sections">
            {shown.map((droplet, i) => (
              <section
                className="droplet-section"
                key={droplet.key}
                id={droplet.key}
                aria-labelledby={`${droplet.key}-title`}
              >
                <div className="droplet-heading">
                  <div className="droplet-name-group">
                    <span className={cn('server-icon', i === 1 && 'secondary')}>
                      <Server size={21} />
                    </span>
                    <div>
                      <div className="droplet-name-line">
                        <h2 id={`${droplet.key}-title`}>{droplet.name}</h2>
                        <Badge
                          variant="outline"
                          className={cn(
                            'droplet-status',
                            droplet.status === 'active' && 'is-active',
                          )}
                        >
                          <span />
                          {droplet.status
                            ? droplet.status.charAt(0).toUpperCase() +
                              droplet.status.slice(1)
                            : 'Not connected'}
                        </Badge>
                      </div>
                      <div className="droplet-specs">
                        {droplet.region ? (
                          <>
                            <span>{droplet.region.toUpperCase()}</span>
                            <i />
                            {droplet.vcpus ?? '—'} vCPUs
                            <i />
                            {droplet.memoryMb === null
                              ? '—'
                              : droplet.memoryMb / 1024}{' '}
                            GB Memory
                            <i />
                            {droplet.diskGb ?? '—'} GB Disk
                          </>
                        ) : (
                          <span>
                            {query.isLoading
                              ? 'Loading Droplet details…'
                              : 'Droplet details will appear after connection'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="droplet-label">
                    <span
                      className={cn(
                        'droplet-indicator',
                        i === 1 && 'secondary',
                      )}
                    />
                    DROPLET {String(i + 1).padStart(2, '0')}
                  </div>
                </div>
                {droplet.issue && (
                  <p className="droplet-issue">
                    <TriangleAlert size={14} />
                    {droplet.issue}
                  </p>
                )}
                <div className="charts-grid">
                  {metricNames.map((name) => (
                    <Suspense
                      key={name}
                      fallback={<Skeleton className="h-72 rounded-lg" />}
                    >
                      <MetricChart
                        name={name}
                        metric={droplet.metrics[name]}
                        range={range}
                        start={start}
                        end={end}
                        loading={query.isLoading}
                        connected={connected}
                        dropletName={droplet.name}
                      />
                    </Suspense>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <footer className="dashboard-footer">
            <span>
              <Check size={13} />
              {demo
                ? 'Sample data for preview purposes'
                : 'Metrics retrieved through the DigitalOcean Monitoring API'}
            </span>
            <div>
              <span>
                <ArrowDownLeft size={13} />
                {autoRefresh
                  ? 'Refreshes every 60 seconds'
                  : 'Auto-refresh paused'}
              </span>
              <button onClick={() => changeDemo(!demo)}>
                {demo ? 'Exit demo' : 'Try demo data'}
                <ArrowUpRight size={12} />
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
