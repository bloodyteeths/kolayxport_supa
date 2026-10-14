import React, { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Radio, RefreshCw, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Admin cockpit card for the Etsy event backbone (webhook queue, worker,
 * rate budget, scheduler jobs). Mobile-first: stacked rows and expandable
 * lists, no tables. Strings live in the `etsyOps` i18n namespace.
 */

type Health = {
  depthByStatus: Record<string, number>;
  failed24h: number;
  oldestDueAgeMs: number | null;
  lastReceivedAt: string | null;
  backlogByShop: Array<{ shopId: string; count: number }>;
  recentFailed: Array<{ id: string; eventType: string | null; shopId: string | null; errorMessage: string | null; attempts: number; createdAt: string }>;
  budget: null | {
    day: string;
    remoteLimit: number | null;
    remoteRemaining: number | null;
    localCalls: number;
    usedFraction?: number;
    perShopCap?: number;
    throttled?: number;
    remoteFresh?: boolean;
  };
  worker: null | { loopRunning: boolean; lastPassAt: string | null; inFlight: number; totals: Record<string, number> };
  jobs: Array<{ name: string; schedule: string; lastSuccessAt: string | null; runningSince: string | null; lastFailureAt: string | null; lastError: string | null }>;
};

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

const STATUS_ORDER = ['received', 'processing', 'blocked_reauth', 'failed', 'coalesced', 'done', 'ignored'];

function ago(iso: string | null | undefined, t: ReturnType<typeof useTranslations>): string {
  if (!iso) return t('common.never');
  const ms = Date.now() - new Date(iso).getTime();
  return minutesLabel(ms, t);
}

function minutesLabel(ms: number | null, t: ReturnType<typeof useTranslations>): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return t('common.none');
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t('common.hoursAgo', { count: hours });
  return t('common.daysAgo', { count: Math.floor(hours / 24) });
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'red' | 'yellow' | 'green' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'yellow' ? 'text-yellow-700' : tone === 'green' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium text-right ${color}`}>{value}</span>
    </div>
  );
}

function Expandable({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 py-1"
        aria-expanded={open}
      >
        <span>{title} ({count})</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="mt-1 space-y-2">{children}</div>}
    </div>
  );
}

export default function EtsyBackboneCard() {
  const t = useTranslations('etsyOps');
  const { data, error, isLoading, mutate } = useSWR<Health>('/api/admin/monitoring/etsy-webhooks', fetcher, { refreshInterval: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const replay = async (payload: { ids?: string[]; shopId?: string }, key: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const r = await fetch('/api/admin/monitoring/etsy-webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'replay', ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || String(r.status));
      setMessage(t('backbone.replayed', { count: Number(j.replayed || 0) }));
      await mutate();
    } catch {
      setMessage(t('backbone.replayFailed'));
    } finally {
      setBusy(null);
    }
  };

  const depth = data?.depthByStatus || {};
  const oldestDueStale = (data?.oldestDueAgeMs ?? 0) > 10 * 60_000;
  const tone: 'red' | 'yellow' | 'green' | 'gray' = !data
    ? 'gray'
    : data.failed24h > 0 || oldestDueStale
      ? 'red'
      : (depth.blocked_reauth || 0) > 0 || !data.worker?.loopRunning
        ? 'yellow'
        : 'green';
  const dot = { red: 'bg-red-500', yellow: 'bg-yellow-500', green: 'bg-green-500', gray: 'bg-gray-400' }[tone];
  const used = data?.budget?.usedFraction;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-5 h-5 text-gray-700 shrink-0" />
          <h3 className="text-sm font-semibold text-gray-900 truncate">{t('backbone.title')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => mutate()}
            className="p-1.5 rounded-lg hover:bg-gray-100"
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        </div>
      </div>

      {isLoading && !data && <p className="text-xs text-gray-400">{t('common.loading')}</p>}
      {error && !data && <p className="text-xs text-red-600">{t('common.loadFailed')}</p>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-1">{t('backbone.worker')}</h4>
            <Row
              label={t('backbone.loop')}
              value={data.worker?.loopRunning ? t('backbone.running') : t('backbone.stopped')}
              tone={data.worker?.loopRunning ? 'green' : 'yellow'}
            />
            <Row label={t('backbone.lastPass')} value={ago(data.worker?.lastPassAt, t)} />
            <Row label={t('backbone.inFlight')} value={data.worker?.inFlight ?? 0} />
            <Row label={t('backbone.lastReceived')} value={ago(data.lastReceivedAt, t)} />
            <Row label={t('backbone.oldestDue')} value={minutesLabel(data.oldestDueAgeMs, t)} tone={oldestDueStale ? 'red' : undefined} />
            <Row label={t('backbone.failed24h')} value={data.failed24h} tone={data.failed24h > 0 ? 'red' : undefined} />
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-1">{t('backbone.queue')}</h4>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <span
                  key={s}
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    s === 'failed' && (depth[s] || 0) > 0
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : s === 'blocked_reauth' && (depth[s] || 0) > 0
                        ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                        : 'border-gray-200 bg-gray-50 text-gray-700'
                  }`}
                >
                  {t(`status.${s}`)}: {depth[s] || 0}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-1">{t('backbone.budget')}</h4>
            <Row
              label={t('backbone.usedToday')}
              value={typeof used === 'number' ? `${Math.round(used * 100)}%` : t('common.none')}
              tone={typeof used === 'number' && used >= 0.85 ? 'red' : typeof used === 'number' && used >= 0.7 ? 'yellow' : undefined}
            />
            <Row
              label={t('backbone.remote')}
              value={data.budget?.remoteLimit
                ? t('backbone.remoteValue', { remaining: data.budget.remoteRemaining ?? 0, limit: data.budget.remoteLimit })
                : t('common.none')}
            />
            <Row label={t('backbone.localCalls')} value={data.budget?.localCalls ?? 0} />
            <Row label={t('backbone.perShopCap')} value={data.budget?.perShopCap ?? '-'} />
            <Row label={t('backbone.throttled')} value={data.budget?.throttled ?? 0} />
          </div>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-2">
          <Expandable title={t('backbone.jobs')} count={data.jobs.length}>
            {data.jobs.map((j) => (
              <div key={j.name} className="rounded-lg border border-gray-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-900 break-all">{j.name}</span>
                  <span className="text-[11px] text-gray-500 shrink-0">{j.schedule}</span>
                </div>
                <Row label={t('backbone.lastSuccess')} value={ago(j.lastSuccessAt, t)} />
                {j.runningSince && <Row label={t('backbone.runningSince')} value={ago(j.runningSince, t)} tone="yellow" />}
                {j.lastFailureAt && (
                  <Row label={t('backbone.lastFailure')} value={ago(j.lastFailureAt, t)} tone="red" />
                )}
                {j.lastError && <p className="text-[11px] text-red-600 break-words">{j.lastError}</p>}
              </div>
            ))}
          </Expandable>

          <Expandable title={t('backbone.backlogByShop')} count={data.backlogByShop.length}>
            {data.backlogByShop.map((b) => (
              <div key={b.shopId} className="flex items-center justify-between text-xs">
                <span className="text-gray-700 break-all">{b.shopId}</span>
                <span className="font-medium">{b.count}</span>
              </div>
            ))}
          </Expandable>

          <Expandable title={t('backbone.recentFailed')} count={data.recentFailed.length}>
            {data.recentFailed.length > 0 && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => replay({ ids: data.recentFailed.map((f) => f.id) }, 'all')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('backbone.replayShown')}
              </button>
            )}
            {data.recentFailed.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-900">{f.eventType || '?'}</span>
                  <span className="text-[11px] text-gray-500">{ago(f.createdAt, t)}</span>
                </div>
                <Row label={t('backbone.shop')} value={f.shopId || '-'} />
                <Row label={t('backbone.attempts')} value={f.attempts} />
                {f.errorMessage && <p className="text-[11px] text-red-600 break-words">{f.errorMessage}</p>}
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => replay({ ids: [f.id] }, f.id)}
                    className="px-2.5 py-1.5 text-[11px] rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('backbone.replay')}
                  </button>
                  {f.shopId && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => replay({ shopId: f.shopId as string }, `shop:${f.shopId}`)}
                      className="px-2.5 py-1.5 text-[11px] rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {t('backbone.replayShop')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </Expandable>
          {message && <p className="text-xs text-gray-600">{message}</p>}
        </div>
      )}
    </section>
  );
}
