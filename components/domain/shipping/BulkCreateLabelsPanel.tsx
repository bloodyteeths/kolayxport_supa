/**
 * BulkCreateLabelsPanel (orders §2.6, §7.3): "Create N labels" for the selected labelable orders with one
 * carrier, service and package preset; weight comes from each order. Rows: Ready · Problem (missing fields,
 * [Fix] → the single CreateLabelPanel) · Creating… · Created · Failed (reason, Retry) · "Cancelled on Etsy ·
 * Create anyway" (the 409 label guard, confirmed per row, then sent with `forceCancelled`). The runner is
 * sequential, concurrency 1 (carrier rate limits; the usage limiter counts each), with "Stop after current".
 * DHL eCommerce is enabled only when every order and the sender are in Turkey. A 402 stops the queue and
 * shows the inline limit Banner. Done: "7 labels created · 1 failed" [Retry failed] [Print 7 labels].
 * Each created row carries its tracking-push result (sending / sent / queued / "Couldn't send tracking · Retry");
 * push failures count in the done line. Print opens ≤ 20 labels per click and then the next batch
 * ("Print next 5 labels"). After a run the rows stay a snapshot until the panel closes (the list refresh that
 * drops newly labeled orders must not reset the summary).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { mutate as globalMutate } from 'swr';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { DataTable } from '@/components/ds/data/DataTable';
import type { Column } from '@/components/ds/data/dataTableParts';
import { Banner } from '@/components/ds/feedback/Banner';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { icons } from '@/lib/ds/icons';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { useConnections } from '@/lib/hooks/useConnections';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import type { OrderRow } from '@/lib/orders/types';
import {
  applyPreset, canPushTracking, draftFromOrder, marketplaceSelectKey, withCarrier,
  type CarrierKey, type LabelDraft, type LabelSubmitResult, type PackagePreset,
} from '@/lib/shipping/labelDraft';
import {
  CARRIER_PROVIDER, connectionSnapshot, eligibilityAll, noCarrierConnected, packagingCodes, parseRateId, pickDefaultCarrier,
  rateId, rateRows, readLastCarrier, readSendTracking, rememberCarrier, runLabelQueue, serviceCodes, CARRIER_NAME,
  type ConnectionSnapshot, type JobOutcome,
} from '@/lib/shipping/carriers';
import { missingShipTo } from '@/lib/shipping/validate';
import { openLabelUrl } from '@/lib/shipping/labelLinks';
import { pushTracking, type TrackingPushStatus } from '@/lib/shipping/submit/tracking';
import { useSenderProfile } from '@/lib/shipping/useSenderProfile';
import { usePackagePresets } from '@/lib/shipping/usePackagePresets';
import { senderPhoneE164 } from '@/components/domain/orders/panel/ShipToForm';
import { FromSection } from './FromSection';
import { PackageSection } from './PackageSection';
import { primaryCarriersFor } from './labelUx';
import { CarrierServiceSection } from './CarrierServiceSection';

export interface BulkCreateLabelsPanelProps {
  orders: OrderRow[];
  open: boolean;
  onClose(): void;
  onFixOrder(id: string): void;
  onDone(): void;
}

type RowState =
  | { kind: 'ready' }
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'running' }
  | { kind: 'sent'; trackingNumber: string; labelHref: string | null; push?: RowPush }
  | { kind: 'failed'; message: string }
  | { kind: 'guard'; code: 'ORDER_CANCELLED' | 'ORDER_SHIPPED_EXTERNALLY' }
  | { kind: 'limit' }
  | { kind: 'notStarted' };

/** Tracking push of a created row; absent = not pushed (option off, or the marketplace takes no push). */
export type RowPush = 'sending' | TrackingPushStatus;

interface BulkRow { id: string; order: OrderRow; draft: LabelDraft; state: RowState }

type Phase = 'setup' | 'running' | 'done';

/** Max label tabs opened in one click (popup-safe batch, orders §2.6). */
export const PRINT_BATCH = 20;

/** Pure: next print batch — `[from, to)` of the created labels, wrapping to the start once all were opened. */
export function nextPrintBatch(total: number, printed: number, batch = PRINT_BATCH): { from: number; to: number } {
  const from = printed >= total ? 0 : printed;
  return { from, to: Math.min(total, from + batch) };
}

/** Pure: outcome of one job → row state. */
export function rowStateFromOutcome(o: JobOutcome): RowState {
  if (!o.ok) {
    if (o.kind === 'running') return { kind: 'running' };
    if (o.kind === 'guard') return { kind: 'guard', code: o.code };
    if (o.kind === 'limit') return { kind: 'limit' };
    return { kind: 'failed', message: o.message };
  }
  const ok = o as Extract<LabelSubmitResult, { ok: true }>;
  return { kind: 'sent', trackingNumber: ok.trackingNumber, labelHref: ok.labelHref };
}

/** Pure: initial state of a row for a draft (Ready, or Problem with the missing fields). */
export function initialRowState(d: LabelDraft): RowState {
  const missing = missingShipTo(d);
  return missing.length ? { kind: 'blocked', missing } : { kind: 'ready' };
}

/**
 * Pure: rows that would be blocked only for want of a recipient phone get the seller's phone (explicit
 * "Use my phone" in the DHL fix-up, never automatic — orders §6.1). Rows with a phone are left as they are.
 */
export function withSenderPhone<R extends { draft: LabelDraft }>(rows: R[], phone: string): R[] {
  if (!phone) return rows;
  return rows.map((r) => ((r.draft.shipTo.phone || '').trim()
    ? r
    : { ...r, draft: { ...r.draft, shipTo: { ...r.draft.shipTo, phone } } }));
}

export function BulkCreateLabelsPanel({ orders, open, onClose, onFixOrder, onDone }: BulkCreateLabelsPanelProps) {
  const t = useTranslations('createLabel');
  const tf = useTranslations('createLabel.field');
  const fmt = useFormatters();
  useLimitDialogOptOut(open);

  const settings = useSenderProfile(open);
  const { presets } = usePackagePresets(open);
  const conns = useConnections();
  const snapshots = useMemo<Record<CarrierKey, ConnectionSnapshot>>(() => {
    const opts = { loading: conns.isLoading, error: conns.error };
    return {
      fedex: connectionSnapshot(conns.get(CARRIER_PROVIDER.fedex), opts),
      ups: connectionSnapshot(conns.get(CARRIER_PROVIDER.ups), opts),
      dhl: connectionSnapshot(conns.get(CARRIER_PROVIDER.dhl), opts),
    };
  }, [conns]);

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [rowsKey, setRowsKey] = useState<string>('');
  const [rate, setRate] = useState<string | null>(null);
  const [preset, setPreset] = useState<PackagePreset | null>(null);
  const [sendTracking, setSendTracking] = useState(true);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [limitHit, setLimitHit] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  /** Labels opened by "Print" so far (batches of PRINT_BATCH). */
  const [printed, setPrinted] = useState(0);
  const stopRef = useRef(false);
  /** A run happened since the panel opened: `onDone` fires when the panel is closed, so the summary stays visible. */
  const ranRef = useRef(false);
  const forceRef = useRef<Set<string>>(new Set());

  const senderCountry = settings.senderCountry;
  const ready = open && settings.state !== 'loading' && !conns.isLoading;
  const allTr = senderCountry === 'TR' && orders.length > 0 && orders.every((o) => (o.shipTo?.country || '').toUpperCase() === 'TR');
  const elig = useMemo(
    () => eligibilityAll(snapshots, { senderCountry, recipientCountry: allTr ? 'TR' : '__intl__' }),
    [snapshots, senderCountry, allTr],
  );
  const rateList = useMemo(() => rateRows(elig), [elig]);
  // Memoized: `effectiveDraft` depends on it, and a fresh object per render re-ran the Ready/Problem effect forever.
  const chosen = useMemo(() => (rate ? parseRateId(rate) : null), [rate]);
  const key = orders.map((o) => o.id).join(',');

  // Build drafts when the panel opens (or the order set changes).
  useEffect(() => {
    // Running or done: keep the rows as they are until the panel closes.
    if (!ready || phase !== 'setup' || rowsKey === key) return;
    const carrier = pickDefaultCarrier(elig, { domestic: allTr, lastCarrier: readLastCarrier() });
    const track = readSendTracking();
    const built = orders.map((o) => {
      const d = draftFromOrder(o, { sender: settings.sender, presets, baseCurrency: settings.baseCurrency, carrier, sendTracking: track },
        { validServices: serviceCodes, validPackaging: packagingCodes });
      return { id: o.id, order: o, draft: d, state: initialRowState(d) };
    });
    setRows(built);
    setRowsKey(key);
    setRate(rateId(carrier, built[0]?.draft.service ?? ''));
    setSendTracking(track);
    setLimitHit(false);
    setPrinted(0);
    forceRef.current = new Set();
  }, [ready, phase, rowsKey, key, orders, elig, allTr, settings.sender, settings.baseCurrency, presets]);

  useEffect(() => {
    if (open) return;
    setRowsKey('');
    setPhase('setup');
  }, [open]);

  /** Shared choices applied to one order's draft (weight stays the order's). */
  const effectiveDraft = useCallback((d: LabelDraft): LabelDraft => {
    let next = d;
    if (chosen) next = withCarrier(next, chosen.carrier, chosen.service, { sender: settings.sender, presets, validPackaging: packagingCodes(chosen.carrier) });
    if (preset) {
      const applied = applyPreset(next, preset);
      next = { ...applied, pkg: { ...applied.pkg, weightKg: next.pkg.weightKg } };
    }
    return { ...next, options: { ...next.options, sendTracking: sendTracking && canPushTracking(next.marketplace) } };
  }, [chosen, preset, sendTracking, settings.sender, presets]);

  // Missing fields depend on the carrier (DHL needs phone + district): recompute Ready/Problem on change.
  useEffect(() => {
    if (phase !== 'setup') return;
    setRows((prev) => prev.map((r) => (r.state.kind === 'ready' || r.state.kind === 'blocked'
      ? { ...r, state: initialRowState(effectiveDraft(r.draft)) } : r)));
  }, [effectiveDraft, phase]);

  const setRowState = (id: string, state: RowState) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state } : r)));
  /** Push result onto a row that is still "created" with the same tracking number. */
  const setRowPush = (id: string, trackingNumber: string, push: RowPush) => setRows((prev) => prev.map((r) => (
    r.id === id && r.state.kind === 'sent' && r.state.trackingNumber === trackingNumber ? { ...r, state: { ...r.state, push } } : r)));

  const startPush = (id: string, trackingNumber: string, carrier: CarrierKey) => {
    setRowPush(id, trackingNumber, 'sending');
    void pushTracking(id, trackingNumber, CARRIER_NAME[carrier]).then((res) => setRowPush(id, trackingNumber, res.status));
  };

  const runRows = async (ids: string[]) => {
    const jobs = rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, draft: effectiveDraft(r.draft) }));
    if (jobs.length === 0) return;
    stopRef.current = false;
    setPhase('running');
    setLimitHit(false);
    setProgress({ done: 0, total: jobs.length });
    setPrinted(0);
    let done = 0;
    if (chosen) rememberCarrier(chosen.carrier);
    const summary = await runLabelQueue(jobs, {
      shouldStop: () => stopRef.current,
      forceIds: forceRef.current,
      onUpdate: (id, outcome) => {
        setRowState(id, rowStateFromOutcome(outcome));
        if (!outcome.ok && outcome.kind === 'running') setProgress({ done: done + 1, total: jobs.length });
        else done += 1;
        if (outcome.ok && outcome.trackingNumber) {
          const job = jobs.find((j) => j.id === id);
          if (job?.draft.options.sendTracking) startPush(id, outcome.trackingNumber, job.draft.carrier);
        }
      },
    });
    for (const id of summary.notStarted) setRowState(id, { kind: 'notStarted' });
    setLimitHit(summary.limitReached);
    setPhase('done');
    ranRef.current = true;
    void globalMutate((k) => typeof k === 'string' && k.startsWith('/api/orders'));
  };

  /** Close; after a run, `onDone()` first (the page clears its selection and refreshes). */
  const finish = () => {
    if (ranRef.current) {
      ranRef.current = false;
      onDone();
    }
    onClose();
  };

  const counts = useMemo(() => {
    const c = { ready: 0, blocked: 0, sent: 0, failed: 0, retryable: 0, pushFailed: 0 };
    for (const r of rows) {
      if (r.state.kind === 'sent' && r.state.push === 'failed') c.pushFailed += 1;
      if (r.state.kind === 'ready') c.ready += 1;
      else if (r.state.kind === 'blocked') c.blocked += 1;
      else if (r.state.kind === 'sent') c.sent += 1;
      else if (r.state.kind === 'failed' || r.state.kind === 'limit' || r.state.kind === 'guard') c.failed += 1;
      if (r.state.kind === 'failed' || r.state.kind === 'limit' || r.state.kind === 'notStarted' || (r.state.kind === 'ready' && phase === 'done')) c.retryable += 1;
    }
    return c;
  }, [rows, phase]);

  const sentHrefs = rows.flatMap((r) => (r.state.kind === 'sent' && r.state.labelHref ? [r.state.labelHref] : []));
  const batch = nextPrintBatch(sentHrefs.length, printed);
  const printAll = () => {
    let okAll = true;
    for (const href of sentHrefs.slice(batch.from, batch.to)) okAll = openLabelUrl(href, 'label') && okAll;
    setOpenFailed(!okAll);
    setPrinted(batch.to);
  };

  const createAnyway = (id: string) => {
    forceRef.current.add(id);
    setRowState(id, { kind: 'ready' });
  };

  const requestClose = () => {
    if (phase === 'running') setConfirmStop(true);
    else finish();
  };

  // ─── columns ───
  const columns: Column<BulkRow>[] = [
    {
      key: 'state', header: t('bulk.status'), width: 140, mobile: 'status',
      render: (r) => <RowStatus state={r.state} mp={marketplaceSelectKey(r.draft.marketplace)} fieldLabel={(f) => tf(f)} />,
    },
    {
      key: 'order', header: t('bulk.order'), mobile: 'title',
      render: (r) => {
        const num = `#${r.order.orderNumber}`;
        const who = [r.draft.shipTo.name, r.draft.shipTo.country].filter(Boolean).join(' · ');
        return (
          <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Box component="span" sx={{ fontFamily: 'var(--kx-font-mono, monospace)', fontSize: 13, color: n[800], whiteSpace: 'nowrap' }}>{num}</Box>
            <Box component="span" sx={{ fontSize: 12, color: n[600], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</Box>
          </Box>
        );
      },
    },
    {
      key: 'weight', header: tf('weight'), width: 96, align: 'right', mobile: 'meta',
      render: (r) => `${fmt.num(r.draft.pkg.weightKg)} ${t('unit.kg')}`,
    },
  ];

  const inlineAction = (r: BulkRow) => {
    if (phase === 'running') return null;
    if (r.state.kind === 'blocked') return { id: 'fix', label: t('bulk.fix'), icon: icons.edit, onClick: () => onFixOrder(r.id) };
    if (r.state.kind === 'guard') return { id: 'force', label: t('bulk.createAnyway'), onClick: () => createAnyway(r.id) };
    if (r.state.kind === 'failed') return { id: 'retry', label: t('bulk.retry'), icon: icons.pull, onClick: () => void runRows([r.id]) };
    if (r.state.kind === 'sent' && r.state.push === 'failed') {
      const tn = r.state.trackingNumber;
      const carrier = effectiveDraft(r.draft).carrier;
      return { id: 'retry-push', label: t('success.retry'), icon: icons.pull, onClick: () => startPush(r.id, tn, carrier) };
    }
    return null;
  };

  // ─── footer ───
  const senderReason = settings.state === 'ready' && !settings.complete ? t('senderMissing.reason') : undefined;
  const chosenElig = chosen ? elig.find((e) => e.carrier === chosen.carrier) : undefined;
  const dhlBlocked = chosen?.carrier === 'dhl' && !allTr;
  const carrierReason = dhlBlocked ? t('bulk.dhlMixed')
    : chosenElig && !chosenElig.available
      ? (chosenElig.reason === 'domesticOnly' ? t('unavailable.domesticOnly')
        : chosenElig.reason === 'incomplete' ? t('unavailable.incomplete', { carrier: CARRIER_NAME[chosenElig.carrier] })
          : t('unavailable.notConnected', { carrier: CARRIER_NAME[chosenElig.carrier] }))
      : undefined;
  const readyIds = rows.filter((r) => r.state.kind === 'ready').map((r) => r.id);
  // DHL needs a recipient phone; Trendyol orders never carry one. Offer the seller's phone in one click.
  const senderPhone = senderPhoneE164(settings.sender);
  const noPhoneCount = phase === 'setup' && chosen?.carrier === 'dhl' && senderPhone
    ? rows.filter((r) => r.state.kind === 'blocked' && r.state.missing.includes('phone')).length
    : 0;
  const useSenderPhone = () => setRows((prev) => withSenderPhone(prev, senderPhone).map((r) => (
    r.state.kind === 'ready' || r.state.kind === 'blocked' ? { ...r, state: initialRowState(effectiveDraft(r.draft)) } : r)));

  const primary = phase === 'running'
    ? { id: 'running', label: t('bulk.runningPrimary', progress), loading: true, loadingLabel: t('bulk.runningPrimary', progress), disabled: true }
    : phase === 'done'
      ? (sentHrefs.length > 0
        ? {
          id: 'print-all',
          label: batch.from > 0 ? t('bulk.printNext', { count: batch.to - batch.from }) : t('bulk.printAll', { count: batch.to - batch.from }),
          icon: icons.print,
          onClick: printAll,
        }
        : { id: 'close', label: t('cancel'), onClick: finish })
      : {
        id: 'create-all', label: t('bulk.submit', { count: readyIds.length }), icon: icons.label,
        onClick: () => void runRows(readyIds),
        disabled: readyIds.length === 0 || !!senderReason || !!carrierReason || limitHit,
        disabledReason: senderReason ?? carrierReason ?? (limitHit ? t('limit.reason') : undefined),
      };
  const retryIds = rows.filter((r) => ['failed', 'limit', 'notStarted'].includes(r.state.kind) || (phase === 'done' && r.state.kind === 'ready')).map((r) => r.id);
  const secondary = phase === 'running'
    ? { id: 'stop', label: t('bulk.stop'), onClick: () => { stopRef.current = true; } }
    : phase === 'done' && retryIds.length > 0
      ? { id: 'retry-failed', label: t('bulk.retryFailed'), onClick: () => void runRows(retryIds), disabled: limitHit, disabledReason: limitHit ? t('limit.reason') : undefined }
      : { id: 'cancel', label: t('cancel'), onClick: finish };

  const noCarrier = noCarrierConnected(snapshots);
  const doneLine = phase === 'done'
    ? [t('bulk.done', { ok: counts.sent, failed: counts.failed }), counts.pushFailed > 0 ? t('bulk.pushFailed', { count: counts.pushFailed }) : null].filter(Boolean).join(' · ')
    : t('bulk.summary', { ready: counts.ready, blocked: counts.blocked });
  const anyPushable = rows.some((r) => canPushTracking(r.draft.marketplace));

  return (
    <>
      <SidePanel
        open={open}
        onClose={requestClose}
        size="lg"
        title={t('bulk.title', { count: rows.length || orders.length })}
        meta={t('bulk.hint')}
        primary={primary}
        secondary={secondary}
        saveNote={doneLine}
        saveState="idle"
        data-testid="bulk-label-panel"
      >
        {!ready ? <PanelSkeleton sections={4} /> : noCarrier ? (
          <Box sx={{ p: '20px' }}>
            <EmptyState kind="first-use" icon={icons.label} title={t('noCarrier.title')} action={{ id: 'connect-carrier', label: t('noCarrier.action'), href: '/ayarlar?tab=connections' }} />
          </Box>
        ) : (
          <>
            {limitHit ? (
              <Box sx={{ p: '20px 20px 0' }}>
                <Banner tone="warning" title={t('limit.title')} action={settings.stripeUpsell ? { id: 'see-plans', label: t('limit.action'), href: '/fiyatlandirma' } : undefined} data-testid="bulk-limit" />
              </Box>
            ) : null}
            {openFailed ? <Box sx={{ p: '20px 20px 0' }}><Banner tone="warning" title={t('success.openFailed')} /></Box> : null}
            {noPhoneCount > 0 ? (
              <Box sx={{ p: '20px 20px 0' }}>
                <Banner
                  tone="warning"
                  title={t('bulk.noPhone', { count: noPhoneCount })}
                  action={{ id: 'use-sender-phone', label: t('useSenderPhone', { phone: senderPhone }), onClick: useSenderPhone }}
                  data-testid="bulk-no-phone"
                />
              </Box>
            ) : null}
            <FromSection sender={settings.sender} missing={settings.state === 'ready' ? settings.missing : []} compact />
            <CarrierServiceSection
              rows={rateList}
              value={rate}
              onChange={(id) => phase !== 'running' && setRate(id)}
              overrideReason={allTr ? undefined : { dhl: t('bulk.dhlMixed') }}
              // Same as the single panel: all-domestic batches show DHL eCommerce first, the rest folded.
              primary={primaryCarriersFor(allTr ? 'domestic' : 'international')}
            />
            <PackageSection
              pkg={rows[0]?.draft.pkg ?? { weightKg: 0, packaging: '' }}
              carrier={chosen?.carrier ?? 'fedex'}
              onChange={() => undefined}
              presets={presets}
              onApplyPreset={setPreset}
              presetOnly
              disabled={phase === 'running'}
            />
            {anyPushable ? (
              <SidePanelSection id="bulk-options" title={t('options')}>
                <Checkbox checked={sendTracking} onChange={setSendTracking} label={t('bulk.sendTracking')} disabled={phase === 'running'} data-testid="bulk-send-tracking" />
              </SidePanelSection>
            ) : null}
            <SidePanelSection id="bulk-orders" title={t('bulk.orders')}>
              <DataTable<BulkRow>
                rows={rows}
                columns={columns}
                getRowId={(r) => r.id}
                state={rows.length ? 'ready' : 'empty'}
                density="compact"
                columnStateKey="createLabel.bulk.v1"
                inlineAction={inlineAction}
                stickyHeader={false}
                ariaLabel={t('bulk.orders')}
                data-testid="bulk-rows"
              />
            </SidePanelSection>
          </>
        )}
      </SidePanel>
      <ConfirmDialog
        open={confirmStop}
        nested
        title={t('bulk.stopConfirm')}
        body={t('bulk.stopBody')}
        confirmLabel={t('bulk.stopAction')}
        cancelLabel={t('bulk.keepRunning')}
        onConfirm={() => { stopRef.current = true; setConfirmStop(false); }}
        onCancel={() => setConfirmStop(false)}
      />
    </>
  );
}

function RowStatus({ state, mp, fieldLabel }: { state: RowState; mp: string; fieldLabel: (f: string) => string }) {
  const t = useTranslations('createLabel');
  const [label, color, detail] = ((): [string, string, string | null] => {
    switch (state.kind) {
      case 'ready': return [t('bulk.ready'), tone.success.fg, null];
      case 'blocked': return [t('bulk.problem'), tone.danger.fg, t('bulk.missing', { fields: state.missing.map(fieldLabel).join(', ') })];
      case 'running': return [t('bulk.running'), tone.info.fg, null];
      case 'sent': {
        if (state.push === 'failed') return [t('bulk.sent'), tone.danger.fg, [state.trackingNumber, t('success.trackingFailed')].filter(Boolean).join(' · ')];
        const pushLine = state.push === 'sending' ? t('success.trackingSending')
          : state.push === 'queued' ? t('success.trackingQueued')
            : state.push === 'sent' ? t('success.trackingSent', { mp }) : null;
        return [t('bulk.sent'), tone.success.fg, [state.trackingNumber, pushLine].filter(Boolean).join(' · ') || null];
      }
      case 'failed': return [t('bulk.failed'), tone.danger.fg, state.message];
      case 'guard': return [state.code === 'ORDER_CANCELLED' ? t('bulk.guardCancelled', { mp }) : t('bulk.guardShipped', { mp }), tone.warning.fg, null];
      case 'limit': return [t('bulk.failed'), tone.danger.fg, t('limit.reason')];
      default: return [t('bulk.notStarted'), n[500], null];
    }
  })();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} data-testid={`bulk-state-${state.kind}`} data-push={state.kind === 'sent' ? state.push : undefined}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 13, lineHeight: '20px', color }}>
        <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        {label}
      </Box>
      {detail ? <Box component="span" title={detail} sx={{ fontSize: 12, lineHeight: '16px', color: n[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{detail}</Box> : null}
    </Box>
  );
}

export default BulkCreateLabelsPanel;
