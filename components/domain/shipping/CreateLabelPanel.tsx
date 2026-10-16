/**
 * CreateLabelPanel (orders §2.5, §6, §7.3; DS §3.16): one SidePanel lg (720) for FedEx, UPS and DHL eCommerce.
 * From · Ship to (summary, Edit expands the shared G3 `ShipToForm`) · Package · Carrier & service (RateList)
 * · Customs (international FedEx/UPS) · Options. One `LabelDraft`, three submit adapters (byte-compatible
 * with the legacy drawers). States: PanelSkeleton while settings + connections load; settings error →
 * inline ErrorState and a disabled primary; no carrier connected → EmptyState first-use; sender incomplete →
 * danger Banner + disabled primary; 402 → inline warning Banner + disabled primary (no toast, no dialog);
 * 409 ORDER_CANCELLED / ORDER_SHIPPED_EXTERNALLY → the backend `CancelledOrderLabelDialog` (z 1550) and a
 * retry with `forceCancelled`; carrier error → inline ErrorState with the carrier's text. Success replaces
 * the body (preview, tracking, push result) and the footer becomes [Next order ›] [Print label].
 * An order that already has a label opens on that label, with its stored tracking-push result. "Create another
 * label…" sits in ⋯ only when no Shipment backs the existing label: the label routes refuse a second label
 * while a created Shipment exists (UPS/DHL: any; FedEx: a FedEx one), so the way there is "Delete label" first.
 * The recipient phone is the order's as stored; it is normalised to E.164 only for the phone input, and the
 * typed value is sent only when the user edits it (the legacy drawers sent the stored phone).
 * Usability wave 2026-10-15: Ship to is a read-only card (`ShipToSummary`); a missing required field renders
 * alone under it, highlighted; the full form opens only from "Edit" or Fix address. Carriers: the route's
 * carriers up front (TR → TR: DHL eCommerce), the rest behind "Other carriers"; the last service per route
 * is remembered. A masked marketplace address (Trendyol "***") shows an info line with the marketplace cargo
 * code instead of a form of stars, and the stars are never sent to a carrier.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { mutate as globalMutate } from 'swr';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { CopyText } from '@/components/ds/format/CopyText';
import { icons } from '@/lib/ds/icons';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { useConnections } from '@/lib/hooks/useConnections';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import CancelledOrderLabelDialog, { type LabelGuardCode } from '@/components/orders-live/CancelledOrderLabelDialog';
import { ShipToForm, phoneToE164, senderPhoneE164, type ShipToFieldKey } from '@/components/domain/orders/panel/ShipToForm';
import type { OrderRow, TrackingSubmissionSummary } from '@/lib/orders/types';
import {
  canPushTracking, draftFromOrder, isInternational, withCarrier, applyPreset, marketplaceSelectKey,
  type CarrierKey, type LabelDraft, type LabelOrderInput, type PackagePreset, type ShipTo,
} from '@/lib/shipping/labelDraft';
import {
  CARRIER_NAME, CARRIER_PROVIDER, connectionSnapshot, eligibilityAll, findService, noCarrierConnected,
  packagingCodes, parseRateId, pickDefaultCarrier, rateId, rateRows, readLastCarrier, readSendTracking,
  rememberCarrier, rememberSendTracking, saveDetails, serviceCodes, submitLabel,
  type ConnectionSnapshot, type Eligibility,
} from '@/lib/shipping/carriers';
import {
  errorCount, firstErrorPath, requiredShipTo, shipToFieldsFor, showsIoss, validateDraft,
  type DraftErrors, type FieldError, type FieldPath,
} from '@/lib/shipping/validate';
import { openLabelUrl } from '@/lib/shipping/labelLinks';
import { pushTracking, sendEtgb } from '@/lib/shipping/submit/tracking';
import { useSenderProfile } from '@/lib/shipping/useSenderProfile';
import { usePackagePresets } from '@/lib/shipping/usePackagePresets';
import { FromSection } from './FromSection';
import { PackageSection } from './PackageSection';
import { CarrierServiceSection } from './CarrierServiceSection';
import { CustomsSection } from './CustomsSection';
import { OptionsSection } from './OptionsSection';
import { LabelSuccess, type PushState } from './LabelSuccess';
import { ShipToSummary } from './ShipToSummary';
import {
  isMaskedShipTo, primaryCarriersFor, rememberRouteRate, rememberedRate, routeOf, stripMasked,
} from './labelUx';

export type { CarrierKey } from '@/lib/shipping/labelDraft';

export interface CreateLabelPanelProps {
  order: OrderRow | null;
  open: boolean;
  onClose(): void;
  /** "‹ Order": back to the OrderPanel (orders §1.1: panels replace each other, never stack). */
  onBack?(): void;
  defaultCarrier?: CarrierKey;
  /** 'fixAddress': Ship to opens in edit mode with the first invalid field focused. */
  mode?: 'create' | 'fixAddress';
  onCreated(r: { orderId: string; trackingNumber: string; labelHref: string | null }): void;
  /** "Next order ›" in the success state (the next labelable row of the current list). */
  onNext?(): void;
}

type View = 'form' | 'success';
type Failure = { kind: 'error'; message: string; carrier: CarrierKey } | { kind: 'limit' } | null;

interface Created {
  carrier: CarrierKey | string | null;
  serviceName: string | null;
  trackingNumber: string | null;
  labelHref: string | null;
  alerts: string[];
  existing: boolean;
  shipmentId: string | null;
}

/** DOM id of the control behind a validation path (for focus-first-error). */
export function fieldDomId(path: FieldPath): string {
  if (path.startsWith('shipTo.')) return `label-shipto-${path.slice(7)}`;
  if (path === 'pkg.weightKg') return 'label-weight';
  const m = /^customs\.items\.(\d+)\.(description|hsCode)$/.exec(path);
  if (m) return m[2] === 'hsCode' ? `customs-${m[1]}-hs` : `customs-${m[1]}-description`;
  return '';
}

/** Stored push result of an existing label (orders §6.4); 'pending' (saved, not confirmed) shows no line. */
export function pushStateFromSubmission(s: TrackingSubmissionSummary | null | undefined, trackingNumber: string | null): PushState {
  if (!s) return 'idle';
  if (trackingNumber && s.trackingNumber && s.trackingNumber.trim() !== trackingNumber.trim()) return 'idle';
  return s.state === 'sent' || s.state === 'queued' || s.state === 'failed' ? s.state : 'idle';
}

/** OrderRow is structurally a LabelOrderInput (checked by the compiler, no cast). */
function asInput(order: OrderRow): LabelOrderInput {
  return order;
}

export function CreateLabelPanel({ order, open, onClose, onBack, defaultCarrier, mode = 'create', onCreated, onNext }: CreateLabelPanelProps) {
  const t = useTranslations('createLabel');
  const fmt = useFormatters();
  const toast = useToast();
  useLimitDialogOptOut(open);

  const settings = useSenderProfile(open);
  const { presets, save: savePreset } = usePackagePresets(open);
  const conns = useConnections();

  const snapshots = useMemo<Record<CarrierKey, ConnectionSnapshot>>(() => {
    const opts = { loading: conns.isLoading, error: conns.error };
    return {
      fedex: connectionSnapshot(conns.get(CARRIER_PROVIDER.fedex), opts),
      ups: connectionSnapshot(conns.get(CARRIER_PROVIDER.ups), opts),
      dhl: connectionSnapshot(conns.get(CARRIER_PROVIDER.dhl), opts),
    };
  }, [conns]);

  const [draft, setDraft] = useState<LabelDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const initialJson = useRef<string>('');
  /** Order the panel currently shows: late push / ETGB results of a previous order are dropped. */
  const currentOrderRef = useRef<string | null>(null);
  const [view, setView] = useState<View>('form');
  const [created, setCreated] = useState<Created | null>(null);
  const [push, setPush] = useState<PushState>('idle');
  const [etgb, setEtgb] = useState<{ status: 'sent' | 'failed'; email?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [showSummary, setShowSummary] = useState(false);
  const [editingShipTo, setEditingShipTo] = useState(false);
  const [guard, setGuard] = useState<LabelGuardCode | null>(null);
  const [confirmAnother, setConfirmAnother] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoFocusField, setAutoFocusField] = useState<ShipToFieldKey | undefined>(undefined);
  /** Ship-to fields asked under the summary card. Only grows while the panel is open (no field vanishes mid-typing). */
  const [askFields, setAskFields] = useState<ShipToFieldKey[]>([]);
  /** The order's address came masked ("***"): info line instead of a form. */
  const [masked, setMasked] = useState(false);

  const ready = open && !!order && settings.state !== 'loading' && !conns.isLoading;
  const senderCountry = settings.senderCountry;

  // Build the draft once per opened order (settings + connections loaded).
  useEffect(() => {
    if (!open) {
      setDraftFor(null);
      currentOrderRef.current = null;
      return;
    }
    currentOrderRef.current = order?.id ?? null;
    if (!order || !ready || draftFor === order.id) return;
    const input = asInput(order);
    const base = draftFromOrder(input, {
      sender: settings.sender, presets, baseCurrency: settings.baseCurrency, sendTracking: readSendTracking(),
    });
    const isMasked = isMaskedShipTo(base.shipTo);
    // Trendyol masks only its own (Turkish) addresses, and drops the country with them.
    const recipientCountry = base.shipTo.country || (isMasked && marketplaceSelectKey(base.marketplace) === 'trendyol' ? 'TR' : '');
    const domestic = senderCountry === 'TR' && recipientCountry === 'TR';
    const route = routeOf(senderCountry, recipientCountry);
    const elig = eligibilityAll(snapshots, { senderCountry, recipientCountry });
    const remembered = defaultCarrier ? null : rememberedRate(route, elig);
    const carrier = remembered?.carrier ?? pickDefaultCarrier(elig, { domestic, lastCarrier: readLastCarrier(), preferred: defaultCarrier });
    let next = draftFromOrder(input, {
      sender: settings.sender, presets, baseCurrency: settings.baseCurrency, carrier, sendTracking: readSendTracking(),
    }, { validServices: serviceCodes, validPackaging: packagingCodes });
    if (remembered && remembered.service !== next.service) next = { ...next, service: remembered.service };
    if (isMasked) next = { ...next, shipTo: { ...stripMasked(next.shipTo), country: recipientCountry } };
    setMasked(isMasked);
    setDraft(next);
    setDraftFor(order.id);
    initialJson.current = JSON.stringify(next);
    setFailure(null);
    setErrors({});
    setShowSummary(false);
    setPush('idle');
    setEtgb(null);
    setOpenFailed(false);
    const existing = order.label && mode !== 'fixAddress' ? order.label : null;
    if (existing) {
      setPush(canPushTracking(next.marketplace) ? pushStateFromSubmission(order.trackingSubmission, existing.trackingNumber) : 'idle');
      setView('success');
      setCreated({
        carrier: existing.carrier, serviceName: null, trackingNumber: existing.trackingNumber, labelHref: existing.labelHref,
        alerts: [], existing: true, shipmentId: existing.shipmentId,
      });
    } else {
      setView('form');
      setCreated(null);
    }
    const missing = requiredShipTo(next.carrier, next.shipTo.country).filter((f) => !next.shipTo[f]) as ShipToFieldKey[];
    // Fix address opens the full form; otherwise only the missing fields render under the summary card.
    setEditingShipTo(mode === 'fixAddress');
    setAskFields(isMasked ? [] : missing);
    setAutoFocusField(mode === 'fixAddress' ? missing[0] : undefined);
  }, [open, order, ready, draftFor, settings.sender, settings.baseCurrency, presets, snapshots, senderCountry, defaultCarrier, mode]);

  const international = draft ? isInternational(draft, settings.sender) : false;
  const vctx = useMemo(() => ({ international }), [international]);
  const elig: Eligibility[] = useMemo(
    () => eligibilityAll(snapshots, { senderCountry, recipientCountry: draft?.shipTo.country || '' }),
    [snapshots, senderCountry, draft?.shipTo.country],
  );
  const rows = useMemo(() => rateRows(elig), [elig]);
  const selectedElig = draft ? elig.find((e) => e.carrier === draft.carrier) : undefined;
  const noCarrier = noCarrierConnected(snapshots);

  const update = useCallback((fn: (d: LabelDraft) => LabelDraft) => {
    setDraft((d) => (d ? fn(d) : d));
  }, []);

  // Re-validate shown errors as the user types (only fields that already show an error, or all after a submit).
  useEffect(() => {
    if (!draft) return;
    const all = validateDraft(draft, vctx);
    setErrors((prev) => {
      if (showSummary) return all;
      const next: DraftErrors = {};
      for (const k of Object.keys(prev) as FieldPath[]) if (all[k]) next[k] = all[k];
      return next;
    });
  }, [draft, vctx, showSummary]);

  // A carrier switch can make more fields required (DHL: phone, district): ask for those too.
  const missingKey = draft && !masked
    ? (requiredShipTo(draft.carrier, draft.shipTo.country).filter((f) => !draft.shipTo[f]) as ShipToFieldKey[]).join(',')
    : '';
  useEffect(() => {
    if (!missingKey) return;
    const add = missingKey.split(',') as ShipToFieldKey[];
    setAskFields((prev) => (add.every((f) => prev.includes(f)) ? prev : [...prev, ...add.filter((f) => !prev.includes(f))]));
  }, [missingKey]);

  const blur = (path: FieldPath) => {
    if (!draft) return;
    const e = validateDraft(draft, vctx)[path];
    setErrors((prev) => {
      const next = { ...prev };
      if (e) next[path] = e;
      else delete next[path];
      return next;
    });
  };

  const msg = (e?: FieldError) => {
    if (!e) return undefined;
    if (e.code === 'stateRequired') {
      const country = String(e.params?.country || '');
      let name = country;
      try { name = new Intl.DisplayNames([fmt.intlLocale], { type: 'region' }).of(country) || country; } catch { /* keep code */ }
      return t('validation.stateRequired', { country: name });
    }
    return t(`validation.${e.code}`, e.params as Record<string, string | number> | undefined);
  };

  const shipToErrors = useMemo(() => {
    const out: Partial<Record<ShipToFieldKey, string>> = {};
    for (const [k, v] of Object.entries(errors)) if (k.startsWith('shipTo.')) out[k.slice(7) as ShipToFieldKey] = msg(v);
    return out;
  }, [errors, t]);
  const customsErrors = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(errors)) if (k.startsWith('customs.')) out[k.slice(8)] = msg(v);
    return out;
  }, [errors, t]);

  const focusPath = (path: FieldPath) => {
    if (path.startsWith('shipTo.')) {
      const f = path.slice(7) as ShipToFieldKey;
      // Masked address: the stars were cleared, so typing it in needs the full form.
      if (masked) setEditingShipTo(true);
      else if (!editingShipTo) setAskFields((prev) => (prev.includes(f) ? prev : [...prev, f]));
    }
    window.setTimeout(() => {
      const el = document.getElementById(fieldDomId(path));
      (el?.querySelector('input,textarea,[role="combobox"],button') as HTMLElement | null ?? el)?.focus?.();
    }, 0);
  };

  const finishCreated = async (d: LabelDraft, r: { trackingNumber: string; labelHref: string | null; alerts?: string[] }) => {
    const svc = findService(d.carrier, d.service);
    const serviceName = svc?.i18nKey ? `${CARRIER_NAME.dhl} · ${t(`dhl.service.${svc.i18nKey}`)}` : svc?.name ?? CARRIER_NAME[d.carrier];
    setCreated({ carrier: d.carrier, serviceName, trackingNumber: r.trackingNumber || null, labelHref: r.labelHref, alerts: r.alerts ?? [], existing: false, shipmentId: null });
    setView('success');
    rememberCarrier(d.carrier);
    rememberRouteRate(routeOf(senderCountry, d.shipTo.country), d.carrier, d.service);
    rememberSendTracking(d.options.sendTracking);
    initialJson.current = JSON.stringify(d);
    onCreated({ orderId: d.orderId, trackingNumber: r.trackingNumber, labelHref: r.labelHref });
    // Live events refresh the list too; this keeps it right when the live channel is down.
    void globalMutate((key) => typeof key === 'string' && key.startsWith('/api/orders'));
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="panel-print-label"]')?.focus(), 0);

    const stillHere = () => currentOrderRef.current === d.orderId;
    if (d.options.sendTracking && r.trackingNumber) {
      setPush('sending');
      const res = await pushTracking(d.orderId, r.trackingNumber, CARRIER_NAME[d.carrier]);
      if (!stillHere()) return;
      setPush(res.status);
    }
    if (international && d.customs.sendEtgb && settings.etgbEnabled) {
      if (!settings.etgbEmail) setEtgb({ status: 'failed' });
      else {
        const email = settings.etgbEmail;
        const res = await sendEtgb([d.orderId], email);
        if (!stillHere()) return;
        setEtgb({ status: res.ok ? 'sent' : 'failed', email });
      }
    }
  };

  const run = async (force: boolean) => {
    if (!draft || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const res = await submitLabel(draft, { forceCancelled: force || undefined });
      if (res.ok) {
        setGuard(null);
        // The label exists: free the primary now; the push / ETGB follow-ups run on their own.
        setSubmitting(false);
        void finishCreated(draft, res);
        return;
      }
      if (res.kind === 'guard') setGuard(res.code);
      else if (res.kind === 'limit') { setGuard(null); setFailure({ kind: 'limit' }); }
      else { setGuard(null); setFailure({ kind: 'error', message: res.message, carrier: draft.carrier }); }
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (!draft) return;
    const all = validateDraft(draft, vctx);
    setErrors(all);
    if (errorCount(all) > 0) {
      setShowSummary(true);
      const first = firstErrorPath(all);
      if (first) focusPath(first);
      return;
    }
    setShowSummary(false);
    void run(false);
  };

  const retryPush = async () => {
    if (!draft || !created?.trackingNumber) return;
    const orderId = draft.orderId;
    setPush('sending');
    const res = await pushTracking(orderId, created.trackingNumber, typeof created.carrier === 'string' && created.carrier in CARRIER_NAME ? CARRIER_NAME[created.carrier as CarrierKey] : created.carrier);
    if (currentOrderRef.current !== orderId) return;
    setPush(res.status);
  };

  const printLabel = () => {
    const href = created?.labelHref;
    if (!href) return;
    // Inside the click (popup-safe).
    const ok = openLabelUrl(href, `${String(created?.carrier || 'label').toLowerCase()}-${draft?.orderNumber || 'label'}`);
    setOpenFailed(!ok);
  };

  const deleteLabel = async () => {
    if (!created?.shipmentId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(created.shipmentId)}/delete`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('existing.deleted'));
      setConfirmDelete(false);
      setCreated(null);
      setView('form');
      void globalMutate((key) => typeof key === 'string' && key.startsWith('/api/orders'));
    } catch {
      toast.error(t('existing.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const doSaveDetails = async () => {
    if (!draft) return;
    setSaving(true);
    const res = await saveDetails(draft);
    setSaving(false);
    if (res.ok) {
      initialJson.current = JSON.stringify(draft);
      toast.success(t('detailsSaved'));
      void globalMutate((key) => typeof key === 'string' && key.startsWith('/api/orders'));
    } else toast.error(t('detailsFailed'));
  };

  const onPickRate = (id: string) => {
    const p = parseRateId(id);
    if (!p) return;
    update((d) => withCarrier(d, p.carrier, p.service, { sender: settings.sender, presets, validPackaging: packagingCodes(p.carrier) }));
  };

  const onPreset = (p: PackagePreset) => update((d) => applyPreset(d, p));
  const onSavePreset = async ({ name, isDefault }: { name: string; isDefault: boolean }) => {
    if (!draft) return;
    await savePreset({
      name, isDefault, weightKg: draft.pkg.weightKg, lengthCm: draft.pkg.lengthCm, widthCm: draft.pkg.widthCm, heightCm: draft.pkg.heightCm,
      packaging: { [draft.carrier]: draft.pkg.packaging },
    });
    toast.success(t('presetSaved'));
  };

  // ─── header ───
  const number = order?.orderNumber ? `#${order.orderNumber}` : '';
  const title = t('title', { number });
  const shipTo = draft?.shipTo;
  const meta = order ? [
    shipTo?.name || order.buyerName,
    [shipTo?.city, shipTo?.state, shipTo?.country].filter(Boolean).join(' '),
    t('customsItems', { count: order.items?.length || 1 }),
  ].filter(Boolean).join(' · ') : undefined;

  const leading = onBack ? (
    <IconButton icon={icons.back} label={t('backToOrder')} size="sm" onClick={onBack} data-testid="label-back" />
  ) : order ? <LogoTile brand={order.store?.marketplace || order.marketplace} size={24} /> : null;
  const status = order?.status ? (
    <StatusPill domain={order.status.domain} status={order.status.key as never} raw={order.status.raw} size="sm" />
  ) : null;

  // ─── footer ───
  const senderReason = !settings.complete && settings.state === 'ready' ? t('senderMissing.reason') : undefined;
  const settingsFailed = settings.state === 'error';
  const carrierReason = selectedElig && !selectedElig.available ? (
    selectedElig.reason === 'domesticOnly' ? t('unavailable.domesticOnly')
      : selectedElig.reason === 'incomplete' ? t('unavailable.incomplete', { carrier: CARRIER_NAME[selectedElig.carrier] })
        : t('unavailable.notConnected', { carrier: CARRIER_NAME[selectedElig.carrier] })
  ) : undefined;
  // A masked address stays unsendable until the seller types the real one (Edit): never "***" to a carrier.
  const maskedReason = masked && draft && requiredShipTo(draft.carrier, draft.shipTo.country).some((f) => !draft.shipTo[f])
    ? t('masked.reason', { mp: marketplaceSelectKey(draft.marketplace) })
    : undefined;
  const disabledReason = settingsFailed ? t('settingsFailed')
    : senderReason
      ?? (failure?.kind === 'limit' ? t('limit.reason') : undefined)
      ?? carrierReason
      ?? maskedReason;

  const formMode = view === 'form' && !!draft && !noCarrier;
  const primary = view === 'success'
    ? (created?.labelHref ? { id: 'print', label: t('success.print'), icon: icons.print, onClick: printLabel } : undefined)
    : formMode
      ? {
        id: 'create-label', label: t('submit'), icon: icons.label, onClick: submit, loading: submitting, loadingLabel: t('submitting'),
        disabled: !!disabledReason, disabledReason,
      }
      : undefined;
  const secondary = view === 'success'
    ? (onNext ? { id: 'next', label: t('success.next'), icon: icons.next, onClick: onNext } : { id: 'close', label: t('cancel'), onClick: onClose })
    : formMode ? { id: 'cancel', label: t('cancel'), onClick: onClose } : undefined;
  const overflow = view === 'success'
    ? [
      ...(created?.labelHref && /pdf/i.test(created.labelHref) ? [{ id: 'download', label: t('success.download'), icon: icons.download, onClick: printLabel }] : []),
      ...(created?.existing && !created.shipmentId ? [{ id: 'another', label: t('existing.another'), icon: icons.add, onClick: () => setConfirmAnother(true) }] : []),
      ...(created?.existing && created.shipmentId ? [{ id: 'delete-label', label: t('existing.deleteLabel'), icon: icons.delete, tone: 'danger' as const, onClick: () => setConfirmDelete(true) }] : []),
    ]
    : formMode ? [{ id: 'save-details', label: t('saveWithoutCreating'), loading: saving, onClick: doSaveDetails }] : undefined;

  const dirty = view === 'form' && !!draft && JSON.stringify(draft) !== initialJson.current;

  // ─── body ───
  let body: React.ReactNode;
  if (!order) body = null;
  else if (!ready || (!draft && !settingsFailed && !noCarrier)) body = <PanelSkeleton sections={5} />;
  else if (view === 'success' && created) {
    body = (
      <LabelSuccess
        carrier={created.carrier}
        serviceName={created.serviceName}
        trackingNumber={created.trackingNumber}
        labelHref={created.labelHref}
        marketplace={draft?.marketplace || order.store?.marketplace || order.marketplace}
        push={push}
        onRetryPush={retryPush}
        etgb={etgb}
        alerts={created.alerts}
        openFailed={openFailed}
        existing={created.existing}
      />
    );
  } else if (noCarrier) {
    body = (
      <Box sx={{ p: '20px' }}>
        <EmptyState
          kind="first-use"
          icon={icons.label}
          title={t('noCarrier.title')}
          action={{ id: 'connect-carrier', label: t('noCarrier.action'), href: '/ayarlar?tab=connections' }}
        />
      </Box>
    );
  } else if (!draft) {
    body = <Box sx={{ p: '20px' }}><ErrorState variant="inline" title={t('settingsFailed')} onRetry={() => void settings.mutate()} /></Box>;
  } else {
    const fields = shipToFieldsFor(draft.carrier, draft.shipTo.country);
    const required = Object.fromEntries(requiredShipTo(draft.carrier, draft.shipTo.country).map((f) => [f, true])) as Partial<Record<ShipToFieldKey, boolean>>;
    const shipToLine = summaryLine(draft.shipTo, fmt.intlLocale);
    // Only the fields that need input render under the summary card: the ones focused from an error, plus any
    // with a validation error now. The full form stays behind "Edit".
    const shipToMissing = Array.from(new Set([
      ...askFields,
      ...Object.keys(errors).filter((k) => k.startsWith('shipTo.')).map((k) => k.slice(7) as ShipToFieldKey),
    ]));
    const showCustoms = international && draft.carrier !== 'dhl';
    // FedEx and UPS have no option their routes read; only "Send tracking" (when the marketplace takes it).
    const optionsEmpty = draft.carrier !== 'dhl' && !canPushTracking(draft.marketplace);
    body = (
      <>
        {settingsFailed ? <Box sx={{ p: '20px 20px 0' }}><ErrorState variant="inline" title={t('settingsFailed')} onRetry={() => void settings.mutate()} /></Box> : null}
        {failure?.kind === 'limit' ? (
          <Box sx={{ p: '20px 20px 0' }}>
            <Banner
              tone="warning"
              title={t('limit.title')}
              action={settings.stripeUpsell ? { id: 'see-plans', label: t('limit.action'), href: '/fiyatlandirma' } : undefined}
              data-testid="label-limit"
            />
          </Box>
        ) : null}
        {failure?.kind === 'error' ? (
          <Box sx={{ p: '20px 20px 0' }} data-testid="label-error">
            <ErrorState
              variant="inline"
              title={t('error.title')}
              cause={t('error.carrierSaid', { carrier: CARRIER_NAME[failure.carrier], message: failure.message })}
              onRetry={() => void run(false)}
              retryLabel={t('error.tryAgain')}
            />
          </Box>
        ) : null}
        {showSummary && errorCount(errors) > 0 ? (
          <Box sx={{ p: '20px 20px 0' }}>
            <Banner tone="danger" title={t('fixFields', { count: errorCount(errors) })} data-testid="label-fix-fields" />
          </Box>
        ) : null}
        <FromSection sender={settings.sender} missing={settings.state === 'ready' ? settings.missing : []} />
        <SidePanelSection
          id="label-shipto"
          title={t('shipTo')}
          action={editingShipTo
            ? { id: 'shipto-done', label: t('done'), onClick: () => setEditingShipTo(false) }
            : { id: 'shipto-edit', label: t('edit'), icon: icons.edit, onClick: () => setEditingShipTo(true) }}
          data-testid="label-shipto"
        >
          {editingShipTo || masked ? (
            <ShipToForm
              value={{ ...draft.shipTo, phone: phoneToE164(draft.shipTo.phone, draft.shipTo.country) }}
              onChange={(v) => update((d) => {
                const shown = phoneToE164(d.shipTo.phone, d.shipTo.country);
                // Untouched phone → keep the stored value (what the carrier routes always received).
                return { ...d, shipTo: { ...(v as ShipTo), phone: v.phone === shown ? d.shipTo.phone : v.phone } };
              })}
              errors={shipToErrors}
              onBlurField={(f) => blur(`shipTo.${f}` as FieldPath)}
              showDistrict={fields.includes('district')}
              required={required}
              phoneFallback={draft.carrier === 'dhl' ? senderPhoneE164(settings.sender) || undefined : undefined}
              autoFocusField={autoFocusField}
              idPrefix="label-shipto"
            />
          ) : (
            <ShipToSummary
              value={draft.shipTo}
              intlLocale={fmt.intlLocale}
              missing={shipToMissing}
              onChange={(v) => update((d) => ({ ...d, shipTo: v }))}
              errors={shipToErrors}
              onBlurField={(f) => blur(`shipTo.${f}` as FieldPath)}
              phoneFallback={draft.carrier === 'dhl' ? senderPhoneE164(settings.sender) || undefined : undefined}
              idPrefix="label-shipto"
            />
          )}
        </SidePanelSection>
        <PackageSection
          pkg={draft.pkg}
          carrier={draft.carrier}
          onChange={(pkg) => update((d) => ({ ...d, pkg }))}
          presets={presets}
          onApplyPreset={onPreset}
          onSavePreset={onSavePreset}
          weightError={msg(errors['pkg.weightKg'])}
          onBlurWeight={() => blur('pkg.weightKg')}
        />
        <CarrierServiceSection
          rows={rows}
          value={rateId(draft.carrier, draft.service)}
          onChange={onPickRate}
          primary={primaryCarriersFor(routeOf(senderCountry, draft.shipTo.country))}
        />
        {showCustoms ? (
          <CustomsSection
            customs={draft.customs}
            carrier={draft.carrier}
            recipientCountry={draft.shipTo.country}
            onChange={(customs) => update((d) => ({ ...d, customs }))}
            errors={customsErrors}
            onBlurField={(p) => blur(`customs.${p}` as FieldPath)}
            etgbEnabled={settings.etgbEnabled}
            showIoss={showsIoss(draft.shipTo.country)}
          />
        ) : null}
        {!optionsEmpty ? (
          <OptionsSection
            options={draft.options}
            carrier={draft.carrier}
            marketplace={draft.marketplace}
            onChange={(options) => update((d) => ({ ...d, options }))}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <SidePanel
        open={open && !!order}
        onClose={onClose}
        size="lg"
        title={title}
        leading={leading}
        status={status}
        meta={meta}
        primary={primary}
        secondary={secondary}
        overflow={overflow && overflow.length > 0 ? overflow : undefined}
        dirty={dirty}
        data-testid="create-label-panel"
      >
        {body}
      </SidePanel>
      <CancelledOrderLabelDialog
        open={!!guard}
        code={guard}
        orderNumber={order?.orderNumber}
        busy={submitting}
        onClose={() => setGuard(null)}
        onConfirm={() => void run(true)}
      />
      <ConfirmDialog
        open={confirmAnother}
        nested
        title={t('existing.confirmTitle', { number })}
        confirmLabel={t('existing.confirm')}
        onConfirm={() => { setConfirmAnother(false); setCreated(null); setView('form'); }}
        onCancel={() => setConfirmAnother(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        nested
        tone="danger"
        title={t('existing.deleteTitle', { number })}
        body={t('existing.deleteBody')}
        confirmLabel={t('existing.deleteConfirm')}
        onConfirm={() => void deleteLabel()}
        onCancel={() => (deleting ? undefined : setConfirmDelete(false))}
      />
    </>
  );
}

/** "Sarah Miller · +1 555 0134 · 12 Oak St, Apt 4, Austin TX 78701 · United States". */
export function summaryLine(s: ShipTo, intlLocale: string): string {
  let country = s.country;
  try { country = s.country ? new Intl.DisplayNames([intlLocale], { type: 'region' }).of(s.country) || s.country : ''; } catch { /* code */ }
  const cityLine = [s.city, s.state, s.postal].filter(Boolean).join(' ');
  const addr = [s.street1, s.street2, s.district, cityLine].filter(Boolean).join(', ');
  return [s.name, s.phone, addr, country].filter(Boolean).join(' · ');
}

export default CreateLabelPanel;
