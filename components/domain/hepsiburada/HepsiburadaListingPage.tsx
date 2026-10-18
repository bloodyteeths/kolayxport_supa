/**
 * /app/hepsiburada-urunler/[id] — one Hepsiburada listing (id = hbSku).
 *
 * Content (title, images, attributes) belongs to HB's catalog and is shown read-only. The listing values HB lets a
 * merchant change — price, stock, dispatch time, max per order — are staged as a CatalogDraft (marketplace
 * 'hepsiburada'), exactly like grid edits, and reach Hepsiburada only on "Send to Hepsiburada". Fulfilled-by-HB
 * listings keep stock read-only (HB's warehouse owns it).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Page, PageHeader, Section } from '@/components/ds/page';
import { FormField } from '@/components/ds/inputs/FormField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { Button } from '@/components/ds/inputs/Button';
import { Banner, useToast } from '@/components/ds/feedback';
import { ErrorState, PanelSkeleton } from '@/components/ds/state';
import { Thumb } from '@/components/ds/data/Thumb';
import { CopyText } from '@/components/ds/format/CopyText';
import { neutral as n, space, px } from '@/lib/ds/tokens';
import {
  fetchCatalogDrafts,
  sendCatalogDrafts,
  stageCatalogDraft,
  discardCatalogDraft,
  type CatalogDraftDTO,
} from '@/lib/catalogDrafts/client';

type HbListing = {
  hbSku: string;
  merchantId: string;
  merchantSku: string | null;
  barcode: string | null;
  title: string | null;
  brand: string | null;
  categoryName: string | null;
  images: string[] | null;
  thumbnailUrl: string | null;
  price: number | null;
  availableStock: number;
  dispatchTime: number | null;
  maximumPurchasableQuantity: number | null;
  isSalable: boolean;
  isSuspended: boolean;
  isLocked: boolean;
  isFrozen: boolean;
  isFulfilledByHB: boolean;
  deactivationReasons: string[];
  syncedAt: string;
};

type Values = { price: number | null; quantity: number | null; dispatchTime: number | null; maxPurchasableQuantity: number | null };

const FIELDS = ['price', 'quantity', 'dispatchTime', 'maxPurchasableQuantity'] as const;

/** Live values ⊕ the open draft's patch. Pure (tested). */
export function effectiveValues(l: Pick<HbListing, 'price' | 'availableStock' | 'dispatchTime' | 'maximumPurchasableQuantity'>, draft: { fieldPatch?: Record<string, unknown> } | null): Values {
  const p = (draft?.fieldPatch || {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
  return {
    price: num(p.price, l.price),
    quantity: num(p.quantity, l.availableStock),
    dispatchTime: num(p.dispatchTime, l.dispatchTime),
    maxPurchasableQuantity: num(p.maxPurchasableQuantity, l.maximumPurchasableQuantity),
  };
}

/** Fields that differ from the live listing (what to stage; `null` = drop from the draft). Pure (tested). */
export function stagePatch(live: Values, next: Values): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const k of FIELDS) {
    if (next[k] === null || next[k] === undefined) continue;
    out[k] = next[k] === live[k] ? null : next[k];
  }
  return out;
}

export function HepsiburadaListingPage({ hbSku }: { hbSku: string }) {
  const t = useTranslations('hepsiburada.listing');
  const toast = useToast();
  const [listing, setListing] = useState<HbListing | null>(null);
  const [draft, setDraft] = useState<CatalogDraftDTO | null>(null);
  const [form, setForm] = useState<Values | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'send' | 'discard' | 'toggle' | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/hepsiburada/products?action=detail&hbSku=${encodeURIComponent(hbSku)}`, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 404 ? t('notFound') : body?.error || `HTTP ${res.status}`);
      const l = body.listing as HbListing;
      const drafts: CatalogDraftDTO[] = await fetchCatalogDrafts({ marketplace: 'hepsiburada', storeId: l.merchantId, ids: [l.hbSku] }).catch(() => [] as CatalogDraftDTO[]);
      const open = drafts.find((d) => d.externalId === l.hbSku && ['draft', 'failed', 'conflict', 'syncing'].includes(d.status)) ?? null;
      setListing(l);
      setDraft(open);
      setForm(effectiveValues(l, open));
    } catch (err) {
      setLoadError((err as Error)?.message || String(err));
    }
  }, [hbSku, t]);

  useEffect(() => { void load(); }, [load]);

  const live: Values | null = useMemo(() => (listing ? effectiveValues(listing, null) : null), [listing]);
  const staged: Values | null = useMemo(() => (listing ? effectiveValues(listing, draft) : null), [listing, draft]);
  const dirty = !!form && !!staged && FIELDS.some((k) => form[k] !== staged[k]);
  const hasDraft = !!draft && Object.keys(draft.fieldPatch || {}).length > 0;

  const save = useCallback(async (): Promise<CatalogDraftDTO | null> => {
    if (!listing || !form || !live) return null;
    const fields = stagePatch(live, form);
    if (listing.isFulfilledByHB) delete fields.quantity;
    const dto = await stageCatalogDraft({ marketplace: 'hepsiburada', storeId: listing.merchantId, externalId: listing.hbSku, fields });
    setDraft(dto);
    return dto;
  }, [listing, form, live]);

  const onSave = async () => {
    setBusy('save');
    try {
      await save();
      toast.success(t('saved'));
    } catch (err) {
      toast.error(t('saveFailed', { reason: String((err as Error)?.message || err).slice(0, 200) }));
    } finally {
      setBusy(null);
    }
  };

  const onSend = async () => {
    setBusy('send');
    setSendError(null);
    try {
      const d = dirty || !draft ? await save() : draft;
      if (!d) return;
      const summary = await sendCatalogDrafts([d.id]);
      const r = summary.results.find((x) => x.draftId === d.id);
      if (r?.status === 'success') toast.success(t('sent'));
      else if (r?.status === 'pending') toast.success(t('sentPending'));
      else if (r?.status === 'skipped' && r.reason === 'empty') toast.success(t('nothingToSend'));
      else setSendError(r?.errorKey ? t('sendFailedKey') : t('sendFailed'));
      await load();
    } catch (err) {
      setSendError(String((err as Error)?.message || err).slice(0, 300));
    } finally {
      setBusy(null);
    }
  };

  const onDiscard = async () => {
    if (!draft) return;
    setBusy('discard');
    try {
      await discardCatalogDraft(draft.id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onToggle = async () => {
    if (!listing) return;
    setBusy('toggle');
    try {
      const action = listing.isSalable ? 'deactivate' : 'activate';
      const res = await fetch(`/api/hepsiburada/products?action=${action}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hbSku: listing.hbSku }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success(listing.isSalable ? t('deactivated') : t('activated'));
      await load();
    } catch (err) {
      toast.error(t('toggleFailed', { reason: String((err as Error)?.message || err).slice(0, 200) }));
    } finally {
      setBusy(null);
    }
  };

  const title = listing?.title || listing?.merchantSku || hbSku;

  return (
    <Page title={title} width="form" backHref="/app/hepsiburada-urunler" data-testid="hb-listing-page">
      <PageHeader
        title={title}
        backHref="/app/hepsiburada-urunler"
        backLabel={t('back')}
        subtitle={listing ? [listing.brand, listing.categoryName].filter(Boolean).join(' · ') || undefined : undefined}
        primaryAction={listing ? { id: 'hb-send', label: t('send'), onClick: () => void onSend(), loading: busy === 'send', disabled: !dirty && !hasDraft, disabledReason: t('noChanges') } : undefined}
        secondaryActions={listing ? [
          { id: 'hb-save', label: t('saveDraft'), onClick: () => void onSave(), loading: busy === 'save', disabled: !dirty, disabledReason: t('noChanges') },
          { id: 'hb-toggle', label: listing.isSalable ? t('deactivate') : t('activate'), onClick: () => void onToggle(), loading: busy === 'toggle' },
        ] : undefined}
        overflowActions={listing && hasDraft ? [{ id: 'hb-discard', label: t('discard'), onClick: () => void onDiscard(), tone: 'danger' }] : undefined}
      />

      {loadError ? (
        <ErrorState title={t('loadFailed')} cause={loadError} onRetry={() => void load()} />
      ) : !listing || !form ? (
        <PanelSkeleton />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[5]) }}>
          {(listing.isSuspended || listing.isLocked || listing.isFrozen || listing.deactivationReasons.length > 0) && (
            <Banner tone="warning" title={t('restricted')}>
              {listing.deactivationReasons.join(' · ') || t('restrictedNoReason')}
            </Banner>
          )}
          {draft?.status === 'failed' && <Banner tone="danger" title={t('lastSendFailed')} />}
          {draft?.status === 'syncing' && <Banner tone="info" title={t('syncing')} />}
          {sendError && <Banner tone="danger" title={t('sendFailed')}>{sendError}</Banner>}

          <Section title={t('sectionProduct')} variant="card">
            <Box sx={{ display: 'flex', gap: px(space[4]), alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Thumb src={listing.thumbnailUrl} alt={title} size={96} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]), minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</Typography>
                <Box sx={{ display: 'flex', gap: px(space[2]), alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ color: n[500] }}>{t('hbSku')}</Typography>
                  <CopyText value={listing.hbSku} mono />
                </Box>
                {listing.merchantSku && (
                  <Box sx={{ display: 'flex', gap: px(space[2]), alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" sx={{ color: n[500] }}>{t('merchantSku')}</Typography>
                    <CopyText value={listing.merchantSku} mono />
                  </Box>
                )}
                {listing.barcode && (
                  <Box sx={{ display: 'flex', gap: px(space[2]), alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" sx={{ color: n[500] }}>{t('barcode')}</Typography>
                    <CopyText value={listing.barcode} mono />
                  </Box>
                )}
                <Typography variant="caption" sx={{ color: n[500] }}>{t('contentNote')}</Typography>
              </Box>
            </Box>
          </Section>

          <Section title={t('sectionSale')} variant="card">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: px(space[4]) }}>
              <FormField label={t('price')} dirty={form.price !== live?.price}>
                <MoneyField currency="TRY" value={form.price} onChange={(v) => setForm({ ...form, price: v })} min={0.01} />
              </FormField>
              <FormField
                label={t('stock')}
                dirty={form.quantity !== live?.quantity}
                helper={listing.isFulfilledByHB ? t('fulfilledByHb') : undefined}
              >
                <NumberField value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} min={0} max={20000} disabled={listing.isFulfilledByHB} />
              </FormField>
              <FormField label={t('dispatchTime')} helper={t('dispatchTimeHelp')} dirty={form.dispatchTime !== live?.dispatchTime}>
                <NumberField value={form.dispatchTime} onChange={(v) => setForm({ ...form, dispatchTime: v })} min={0} max={30} unit={t('days')} />
              </FormField>
              <FormField label={t('maxPerOrder')} optional dirty={form.maxPurchasableQuantity !== live?.maxPurchasableQuantity}>
                <NumberField value={form.maxPurchasableQuantity} onChange={(v) => setForm({ ...form, maxPurchasableQuantity: v })} min={1} max={10000} />
              </FormField>
            </Box>
            {hasDraft && (
              <Typography variant="caption" component="p" sx={{ mt: px(space[3]), color: n[600] }}>{t('draftNote')}</Typography>
            )}
            <Box sx={{ mt: px(space[3]) }}>
              <Button variant="ghost" size="sm" onClick={() => void load()}>{t('reload')}</Button>
            </Box>
          </Section>
        </Box>
      )}
    </Page>
  );
}

export default HepsiburadaListingPage;
