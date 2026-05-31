import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Shield,
  Activity,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Server,
  CreditCard,
  Plug,
  Truck,
  FileText,
  Bug,
  Lock,
  Chrome,
  Users,
  Mail,
} from 'lucide-react';

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (r.status === 403) throw new Error('forbidden');
    if (!r.ok) throw new Error('error');
    return r.json();
  });

function StatusDot({ tone }: { tone: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colors = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    gray: 'bg-gray-400',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[tone]}`} />;
}

function Card({
  icon: Icon,
  title,
  tone = 'gray',
  loading,
  error,
  children,
}: {
  icon: any;
  title: string;
  tone?: 'green' | 'yellow' | 'red' | 'gray';
  loading?: boolean;
  error?: any;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-gray-700" />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <StatusDot tone={tone} />
      </div>
      {loading && (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <RefreshCw className="w-3 h-3 animate-spin" /> loading…
        </div>
      )}
      {error && !loading && <p className="text-xs text-red-600">failed to load</p>}
      {!loading && !error && children}
    </section>
  );
}

function fmtAge(ms: number | null) {
  if (ms == null) return 'n/a';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function fmtTime(d: string | Date | null | undefined) {
  if (!d) return '-';
  const date = new Date(d);
  return date.toLocaleString('tr-TR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------- Section components ----------------

function SystemSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/overview', fetcher, {
    refreshInterval: 60000,
  });
  const sys = data?.system;
  const tone = !sys ? 'gray' : sys.db === 'ok' ? 'green' : 'red';
  return (
    <Card icon={Server} title="System" tone={tone} loading={isLoading} error={error}>
      {sys && (
        <dl className="text-xs space-y-1 text-gray-700">
          <div className="flex justify-between"><dt>app</dt><dd>{sys.app}</dd></div>
          <div className="flex justify-between"><dt>db</dt><dd>{sys.db}</dd></div>
          <div className="flex justify-between"><dt>node</dt><dd>{sys.nodeVersion}</dd></div>
          <div className="flex justify-between"><dt>uptime</dt><dd>{fmtAge(sys.uptimeSeconds * 1000)}</dd></div>
          <div className="flex justify-between"><dt>env</dt><dd>{sys.env}</dd></div>
          <div className="flex justify-between"><dt>sha</dt><dd className="truncate max-w-[12rem]">{sys.commitSha || '-'}</dd></div>
        </dl>
      )}
      {data && (
        <div className="mt-3 pt-3 border-t text-xs grid grid-cols-3 gap-2 text-gray-700">
          <div><div className="text-gray-400">users</div><div className="font-semibold">{data.totals.users}</div></div>
          <div><div className="text-gray-400">orders</div><div className="font-semibold">{data.totals.orders}</div></div>
          <div><div className="text-gray-400">shipments</div><div className="font-semibold">{data.totals.shipments}</div></div>
        </div>
      )}
    </Card>
  );
}

function NeedsAttention() {
  const { data, error, isLoading, mutate } = useSWR('/api/admin/monitoring/needs-attention', fetcher, {
    refreshInterval: 30000,
  });
  const items: any[] = data?.items || [];
  const tone = items.length === 0 ? 'green' : items.some((i: any) => i.severity === 'error') ? 'red' : 'yellow';
  return (
    <Card icon={AlertCircle} title={`Needs attention (${items.length})`} tone={tone} loading={isLoading} error={error}>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">All clear.</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {items.slice(0, 12).map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              {it.severity === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-gray-900">{it.message}</p>
                <p className="text-gray-400">{it.kind}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => mutate()} className="mt-3 text-xs text-blue-600 hover:underline">
        Refresh
      </button>
    </Card>
  );
}

function CronSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/cron', fetcher, { refreshInterval: 30000 });
  const jobs: any[] = data?.jobs || [];
  const tone = jobs.length === 0 ? 'gray' : jobs.some(j => j.stale) ? 'red' : 'green';
  return (
    <Card icon={Clock} title="Cron" tone={tone} loading={isLoading} error={error}>
      {jobs.length === 0 ? (
        <p className="text-xs text-gray-500">No cron rows yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-gray-400">
            <tr>
              <th className="text-left font-normal pb-1">job</th>
              <th className="text-left font-normal pb-1">last</th>
              <th className="text-right font-normal pb-1">age</th>
              <th className="text-right font-normal pb-1">status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j: any) => (
              <tr key={j.jobName} className="border-t">
                <td className="py-1.5 text-gray-700">{j.jobName}</td>
                <td className="py-1.5 text-gray-700">{fmtTime(j.lastRunAt)}</td>
                <td className="py-1.5 text-right text-gray-700">{fmtAge(j.ageMs)}</td>
                <td className="py-1.5 text-right">
                  <StatusDot tone={j.stale ? 'red' : 'green'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function IntegrationsSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/integrations', fetcher, {
    refreshInterval: 60000,
  });
  const mps: any[] = data?.marketplaces || [];
  const tone = !data
    ? 'gray'
    : data.failuresLast24h > 10 || mps.some(m => m.expired > 0)
      ? 'red'
      : data.failuresLast24h > 0 || mps.some(m => m.expiringSoon > 0)
        ? 'yellow'
        : 'green';
  return (
    <Card icon={Plug} title="Marketplace integrations" tone={tone} loading={isLoading} error={error}>
      <table className="w-full text-xs">
        <thead className="text-gray-400">
          <tr>
            <th className="text-left font-normal pb-1">marketplace</th>
            <th className="text-right font-normal pb-1">active</th>
            <th className="text-right font-normal pb-1">expired</th>
            <th className="text-right font-normal pb-1">expiring 7d</th>
          </tr>
        </thead>
        <tbody>
          {mps.map(m => (
            <tr key={m.name} className="border-t">
              <td className="py-1.5 text-gray-700 capitalize">{m.name}</td>
              <td className="py-1.5 text-right text-gray-700">{m.total}</td>
              <td className="py-1.5 text-right text-red-600">{m.expired}</td>
              <td className="py-1.5 text-right text-yellow-600">{m.expiringSoon}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500">failures last 24h: {data?.failuresLast24h ?? '-'}</p>
    </Card>
  );
}

function ShippingSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/shipping', fetcher, { refreshInterval: 60000 });
  const tone = !data ? 'gray' : data.failedLabels > 0 ? 'yellow' : 'green';
  return (
    <Card icon={Truck} title="Shipping" tone={tone} loading={isLoading} error={error}>
      {data && (
        <div className="text-xs space-y-1 text-gray-700">
          <div className="flex justify-between"><span>labels 24h</span><span>{data.labels24h}</span></div>
          <div className="flex justify-between"><span>labels 7d</span><span>{data.labels7d}</span></div>
          <div className="flex justify-between"><span>failed labels</span><span className="text-red-600">{data.failedLabels}</span></div>
          <div className="flex justify-between"><span>tracking failed</span><span className="text-red-600">{data.trackingFailed}</span></div>
        </div>
      )}
    </Card>
  );
}

function EtgbSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/etgb', fetcher, { refreshInterval: 60000 });
  const tone = !data ? 'gray' : data.failures24h > 0 ? 'yellow' : 'green';
  return (
    <Card icon={FileText} title="ETGB / Invoice" tone={tone} loading={isLoading} error={error}>
      {data && (
        <div className="text-xs space-y-1 text-gray-700">
          <div className="flex justify-between"><span>runs 24h</span><span>{data.runs24h}</span></div>
          <div className="flex justify-between"><span>runs 7d</span><span>{data.runs7d}</span></div>
          <div className="flex justify-between"><span>failures 24h</span><span className="text-red-600">{data.failures24h}</span></div>
        </div>
      )}
    </Card>
  );
}

function BillingSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/billing', fetcher, { refreshInterval: 60000 });
  const failedWebhooks =
    (data?.recentWebhookEvents || []).filter((w: any) => w.status === 'failed').length || 0;
  const tone = !data ? 'gray' : failedWebhooks > 0 ? 'red' : 'green';
  return (
    <Card icon={CreditCard} title="Billing" tone={tone} loading={isLoading} error={error}>
      {data && (
        <>
          <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-1 text-gray-700">
            {data.byStatus.map((s: any) => (
              <div key={s.status} className="flex justify-between">
                <span>{s.status}</span>
                <span>{s.count}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">webhook events stored: {data.recentWebhookEvents.length}</p>
          {failedWebhooks > 0 && (
            <p className="text-xs text-red-600">failed webhooks: {failedWebhooks}</p>
          )}
        </>
      )}
    </Card>
  );
}

function SecuritySection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/security', fetcher, {
    refreshInterval: 30000,
  });
  const last24h = data?.last24h?.total ?? 0;
  const tone = !data ? 'gray' : last24h > 50 ? 'red' : last24h > 0 ? 'yellow' : 'green';
  return (
    <Card icon={Lock} title="Security events (24h)" tone={tone} loading={isLoading} error={error}>
      {data && (
        <>
          <p className="text-2xl font-semibold text-gray-900">{last24h}</p>
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {(data.last24h?.byOperation || []).slice(0, 6).map((g: any) => (
              <li key={g.operation || 'unknown'} className="flex justify-between">
                <span>{g.operation || '-'}</span>
                <span>{g.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ExtensionSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/extension', fetcher, {
    refreshInterval: 30000,
  });
  const tone = !data
    ? 'gray'
    : data.rejectedTelemetry24h > 0 || data.trackingFailures24h > 0
      ? 'yellow'
      : 'green';
  return (
    <Card icon={Chrome} title="Chrome extension" tone={tone} loading={isLoading} error={error}>
      {data && (
        <div className="text-xs space-y-1 text-gray-700">
          <div className="flex justify-between"><span>telemetry 24h</span><span>{data.acceptedTelemetry24h}</span></div>
          <div className="flex justify-between"><span>rejected 24h</span><span className="text-red-600">{data.rejectedTelemetry24h}</span></div>
          <div className="flex justify-between"><span>tracking push 24h</span><span>{data.trackingPush24h}</span></div>
          <div className="flex justify-between"><span>tracking failed 24h</span><span className="text-red-600">{data.trackingFailures24h}</span></div>
        </div>
      )}
    </Card>
  );
}

function ErrorsFeed() {
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useSWR(
    `/api/admin/monitoring/errors?limit=${limit}&offset=${offset}`,
    fetcher,
    { refreshInterval: 60000 },
  );
  const rows: any[] = data?.rows || [];
  const total = data?.pagination?.total ?? 0;
  return (
    <Card icon={Bug} title={`Recent errors (${total})`} tone={rows.length === 0 ? 'green' : 'yellow'} loading={isLoading} error={error}>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">No recent warnings/errors.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left font-normal pb-1">when</th>
                <th className="text-left font-normal pb-1">level</th>
                <th className="text-left font-normal pb-1">op</th>
                <th className="text-left font-normal pb-1">message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 text-gray-500 whitespace-nowrap pr-2">{fmtTime(r.timestamp)}</td>
                  <td className="py-1.5">
                    <span
                      className={`px-1.5 rounded text-[10px] ${
                        r.level === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {r.level}
                    </span>
                  </td>
                  <td className="py-1.5 text-gray-700 pr-2">{r.operation || '-'}</td>
                  <td className="py-1.5 text-gray-700">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex gap-2 text-xs">
        <button
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="px-2 py-1 border rounded disabled:opacity-40"
        >
          Prev
        </button>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={offset + limit >= total}
          className="px-2 py-1 border rounded disabled:opacity-40"
        >
          Next
        </button>
        <span className="ml-auto text-gray-400">{offset + 1}–{Math.min(offset + limit, total)} / {total}</span>
      </div>
    </Card>
  );
}

function AuditFeed() {
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading } = useSWR(
    `/api/admin/monitoring/audit?limit=${limit}&offset=${offset}`,
    fetcher,
    { refreshInterval: 60000 },
  );
  const rows: any[] = data?.rows || [];
  const total = data?.pagination?.total ?? 0;
  return (
    <Card icon={Shield} title={`Admin audit log (${total})`} tone="gray" loading={isLoading} error={error}>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">No admin actions logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left font-normal pb-1">when</th>
                <th className="text-left font-normal pb-1">admin</th>
                <th className="text-left font-normal pb-1">action</th>
                <th className="text-left font-normal pb-1">target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 text-gray-500 whitespace-nowrap pr-2">{fmtTime(r.createdAt)}</td>
                  <td className="py-1.5 text-gray-700 pr-2 font-mono">{r.adminUserId.slice(0, 8)}</td>
                  <td className="py-1.5 text-gray-700 pr-2">{r.action}</td>
                  <td className="py-1.5 text-gray-700">
                    {r.targetType ? `${r.targetType}/${r.targetId?.slice(0, 8)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex gap-2 text-xs">
        <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="px-2 py-1 border rounded disabled:opacity-40">
          Prev
        </button>
        <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} className="px-2 py-1 border rounded disabled:opacity-40">
          Next
        </button>
        <span className="ml-auto text-gray-400">{offset + 1}–{Math.min(offset + limit, total)} / {total}</span>
      </div>
    </Card>
  );
}

function AuthSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/auth', fetcher, {
    refreshInterval: 60000,
  });
  const tone = !data
    ? 'gray'
    : (data.last24h?.emailDeliveryFailures ?? 0) > 0 || (data.last24h?.smtpNeedsConfig ?? 0) > 0
      ? 'red'
      : (data.last24h?.failedResetTokens ?? 0) > 0
        ? 'yellow'
        : 'green';
  return (
    <Card icon={Mail} title="Auth + email" tone={tone} loading={isLoading} error={error}>
      {data && (
        <div className="text-xs space-y-1 text-gray-700">
          <div className="flex justify-between"><span>unverified credentials users</span><span>{data.unverifiedCredentialsUsers}</span></div>
          <div className="flex justify-between"><span>active verify tokens</span><span>{data.activeTokens?.emailVerify ?? 0}</span></div>
          <div className="flex justify-between"><span>active reset tokens</span><span>{data.activeTokens?.passwordReset ?? 0}</span></div>
          <div className="flex justify-between"><span>reset requests 24h</span><span>{data.last24h?.passwordResetRequests ?? 0}</span></div>
          <div className="flex justify-between"><span>failed reset tokens 24h</span><span className="text-red-600">{data.last24h?.failedResetTokens ?? 0}</span></div>
          <div className="flex justify-between"><span>email delivery failures 24h</span><span className="text-red-600">{data.last24h?.emailDeliveryFailures ?? 0}</span></div>
          {(data.last24h?.smtpNeedsConfig ?? 0) > 0 && (
            <div className="mt-2 px-2 py-1 rounded bg-red-50 text-red-700 text-[10px]">
              NEEDS_SMTP_CONFIG: {data.last24h.smtpNeedsConfig} send(s) skipped — set POSTMARK_SERVER_TOKEN + POSTMARK_FROM_EMAIL
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function UsersAtRiskSection() {
  const { data, error, isLoading } = useSWR('/api/admin/monitoring/users-at-risk', fetcher, {
    refreshInterval: 120000,
  });
  const etsy = data?.tokensExpiring?.etsy || [];
  const wix = data?.tokensExpiring?.wix || [];
  const shopify = data?.tokensExpiring?.shopify || [];
  const errorsByUser = data?.recentSyncErrorsByUser || [];
  const tone = !data
    ? 'gray'
    : etsy.length + wix.length + shopify.length === 0 && errorsByUser.length === 0
      ? 'green'
      : 'yellow';
  return (
    <Card icon={Users} title="Users at risk" tone={tone} loading={isLoading} error={error}>
      <div className="text-xs space-y-1 text-gray-700">
        <div className="flex justify-between"><span>etsy tokens expiring</span><span>{etsy.length}</span></div>
        <div className="flex justify-between"><span>wix tokens expiring</span><span>{wix.length}</span></div>
        <div className="flex justify-between"><span>shopify tokens expiring</span><span>{shopify.length}</span></div>
        <div className="flex justify-between"><span>users w/ sync errors 24h</span><span>{errorsByUser.length}</span></div>
      </div>
    </Card>
  );
}

// ---------------- Page ----------------

export default function AdminMonitoringDashboard() {
  const router = useRouter();
  return (
    <>
      <Head>
        <title>Monitoring | KolayXport admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900">Monitoring cockpit</h1>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              ← Admin
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Row 1: needs attention spans wide */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <NeedsAttention />
            </div>
            <SystemSection />
          </div>

          {/* Row 2: monitoring categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <CronSection />
            <IntegrationsSection />
            <BillingSection />
            <ShippingSection />
            <EtgbSection />
            <SecuritySection />
            <ExtensionSection />
            <AuthSection />
            <UsersAtRiskSection />
          </div>

          {/* Row 3: feeds */}
          <ErrorsFeed />
          <AuditFeed />
        </div>
      </div>
    </>
  );
}
