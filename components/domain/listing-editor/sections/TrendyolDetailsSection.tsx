// components/domain/listing-editor/sections/TrendyolDetailsSection.tsx — M6b-D: Trendyol "Details" /
// "Category & brand" (marketplace-editors §3 row 6, §5.1), plus the Trendyol "Shipping" (row 8) and "Variants"
// (row 5, read-only siblings) sections and the status banner (row "status"). Brand, category, barcode and cargo
// company are fixed after create (read-only with the reason); in create they are picked here and the M6b-C
// adapter moves them into `queuedActions.create.payload`. Nothing is sent from a section.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Banner } from '@/components/ds/feedback';
import { useToast } from '@/components/ds/feedback/toast';
import { Thumb } from '@/components/ds/data/Thumb';
import { Button, Combobox, FormField, NumberField, Select, TextField, type ComboboxOption } from '@/components/ds/inputs';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { editorHref } from '@/lib/listingEditor/editorNav';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { FieldIssue, ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS } from '@/lib/catalogDrafts/schemas';
import { useRegisterDraftSection } from '../useListingDraft';
import {
  NormalizedTextField, fetchJson, numOrBlank, rawRecord, toNum, toStr, useCatalogSection, useRemoteList,
} from './marketplaceSectionShared';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendyolLeafCategory {
  id: number;
  name: string;
  /** "Ev & Yaşam › Dekorasyon › Saklama kutuları" */
  path: string;
}

/** `metadata?action=categories` tree → leaf categories with their path (Trendyol accepts leaves only). */
export function flattenTrendyolCategories(data: unknown): TrendyolLeafCategory[] {
  const roots = (data as { categories?: unknown[] } | null)?.categories;
  const out: TrendyolLeafCategory[] = [];
  const walk = (nodes: unknown[], trail: string[], depth: number) => {
    if (depth > 12) return;
    for (const n of nodes) {
      const r = rawRecord(n);
      const id = toNum(r.id);
      const name = toStr(r.name).trim();
      if (!id || !name) continue;
      const subs = Array.isArray(r.subCategories) ? r.subCategories : [];
      if (subs.length) walk(subs, [...trail, name], depth + 1);
      else out.push({ id, name, path: [...trail, name].join(' › ') });
    }
  };
  if (Array.isArray(roots)) walk(roots, [], 0);
  return out;
}

/** Local filter over the leaf list (Turkish-aware, every word must match the path). At most `limit` results. */
export function searchTrendyolCategories(leaves: TrendyolLeafCategory[], query: string, limit = 50): TrendyolLeafCategory[] {
  const words = query.toLocaleLowerCase('tr').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: TrendyolLeafCategory[] = [];
  for (const c of leaves) {
    const hay = c.path.toLocaleLowerCase('tr');
    if (words.every((w) => hay.includes(w))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Brands search response (array or `{ brands }`) → options. */
export function parseBrands(data: unknown): Array<{ id: number; name: string }> {
  const list = Array.isArray(data) ? data : (data as { brands?: unknown[] } | null)?.brands;
  if (!Array.isArray(list)) return [];
  return list
    .map((b) => {
      const r = rawRecord(b);
      return { id: toNum(r.id) ?? 0, name: toStr(r.name).trim() };
    })
    .filter((b) => b.id > 0 && b.name);
}

export function parseCargoCompanies(data: unknown): Array<{ id: number; name: string }> {
  const list = Array.isArray(data) ? data : (data as { cargoCompanies?: unknown[] } | null)?.cargoCompanies;
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => {
      const r = rawRecord(c);
      return { id: toNum(r.id) ?? 0, name: toStr(r.name).trim() || toStr(r.code).trim() };
    })
    .filter((c) => c.id > 0 && c.name);
}

export interface TrendyolAddress {
  id: number;
  type: 'shipment' | 'returning' | 'invoice' | 'other';
  label: string;
  isDefault: boolean;
}

export function parseAddresses(data: unknown): TrendyolAddress[] {
  const list = (data as { supplierAddresses?: unknown[] } | null)?.supplierAddresses ?? (Array.isArray(data) ? data : null);
  if (!Array.isArray(list)) return [];
  const out: TrendyolAddress[] = [];
  for (const a of list) {
    const r = rawRecord(a);
    const id = toNum(r.id);
    if (!id) continue;
    const kind = toStr(r.addressType).toLowerCase();
    const label = toStr(r.fullAddress).trim() || [toStr(r.address), toStr(r.district), toStr(r.city)].filter(Boolean).join(', ') || `#${id}`;
    out.push({
      id,
      type: kind === 'shipment' ? 'shipment' : kind === 'returning' ? 'returning' : kind === 'invoice' ? 'invoice' : 'other',
      label,
      isDefault: r.isDefault === true,
    });
  }
  return out;
}

/** EAN-13 check digit for 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * A new EAN-13 in the GS1 restricted-circulation range (prefix 2), so it never collides with a registered
 * manufacturer code. `rand` is injectable for tests.
 */
export function generateBarcode(rand: () => number = Math.random): string {
  let body = '2';
  for (let i = 0; i < 11; i++) body += String(Math.floor(rand() * 10) % 10);
  return body + String(ean13CheckDigit(body));
}

/** `GET /api/trendyol/products?action=list&barcode=…` answer → one of the seller's products already has it. Pure. */
export function barcodeInUse(data: unknown, barcode: string): boolean {
  const list = (data as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(list) || !barcode) return false;
  return list.some((p) => toStr(rawRecord(p).barcode) === barcode);
}

/** Ask Trendyol whether the seller already uses this barcode (null = could not check). */
export async function checkBarcodeInUse(barcode: string): Promise<boolean | null> {
  try {
    return barcodeInUse(await fetchJson(`/api/trendyol/products?action=list&size=5&barcode=${encodeURIComponent(barcode)}`), barcode);
  } catch {
    return null;
  }
}

/** Reject reasons as the cache keeps them (`rejectReasonDetails`, strings, or objects) → plain text lines. */
export function decodeRejectReasons(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: string[] = [];
  for (const r of list) {
    let text = '';
    if (typeof r === 'string') text = r;
    else {
      const o = rawRecord(r);
      const main = toStr(o.rejectReason) || toStr(o.reason);
      const detail = toStr(o.rejectReasonDetail) || toStr(o.detail);
      text = main && detail && detail !== main ? `${main}: ${detail}` : main || detail;
    }
    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

export type TrendyolListingStatus = 'archived' | 'blacklisted' | 'rejected' | 'in_review' | 'on_sale' | 'approved';

/** Lifecycle from the cache flags (archived and blacklisted win over the others). */
export function trendyolListingStatus(raw: unknown): TrendyolListingStatus | null {
  const r = rawRecord(raw);
  if (!Object.keys(r).length) return null;
  if (r.archived === true) return 'archived';
  if (r.blacklisted === true) return 'blacklisted';
  if (r.rejected === true) return 'rejected';
  if (r.approved !== true) return 'in_review';
  return r.onSale === true ? 'on_sale' : 'approved';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Status banner (rendered by the frame / route under the header; marketplace-editors §8)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendyolStatusBannerProps {
  /** The Trendyol product (`view.meta.raw`). */
  raw: unknown;
  /** Last send time while Trendyol has not resolved it yet (batch pending / in review). */
  sentAt?: Date | string | null;
}

export function TrendyolStatusBanner({ raw, sentAt }: TrendyolStatusBannerProps) {
  const t = useTranslations('listingEditor');
  const fmt = useFormatters();
  const status = trendyolListingStatus(raw);
  if (status === 'rejected') {
    const reasons = decodeRejectReasons(rawRecord(raw).rejectReasons);
    return (
      <Banner tone="danger" title={t('trendyol.rejected', { reasons: reasons.length ? reasons.join(' · ') : t('trendyol.noReason') })} data-testid="le-trendyol-status-banner" />
    );
  }
  if (status === 'archived' || status === 'blacklisted') {
    return <Banner tone="warning" title={t(status === 'archived' ? 'trendyol.archived' : 'trendyol.blacklisted')} data-testid="le-trendyol-status-banner" />;
  }
  if (status === 'in_review') {
    return (
      <Banner
        tone="info"
        title={sentAt ? t('trendyol.waiting', { time: fmt.date(sentAt, 'time') }) : t('trendyol.inReview')}
        data-testid="le-trendyol-status-banner"
      />
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Details / Category & brand
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

let categoriesCache: Promise<TrendyolLeafCategory[]> | null = null;
/** The leaf category list (one fetch per page load, shared by the category picker and the commission estimate). */
export function loadTrendyolLeafCategories(): Promise<TrendyolLeafCategory[]> {
  if (!categoriesCache) {
    categoriesCache = fetchJson('/api/trendyol/metadata?action=categories').then(flattenTrendyolCategories);
    categoriesCache.catch(() => { categoriesCache = null; });
  }
  return categoriesCache;
}

type BarcodeCheck = { barcode: string; state: 'checking' | 'free' | 'taken' | 'unknown' };

/**
 * Create-mode barcode (marketplace-editors §5.1: unique before Send). A typed barcode is checked against the
 * seller's Trendyol products after a pause; one already in use blocks Send. Generate retries on a collision.
 */
function CreateBarcodeField() {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const barcode = toStr(f.barcode);
  const [check, setCheck] = React.useState<BarcodeCheck | null>(null);
  const [generating, setGenerating] = React.useState(false);

  React.useEffect(() => {
    if (barcode.length < 8) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setCheck({ barcode, state: 'checking' });
      void checkBarcodeInUse(barcode).then((inUse) => {
        if (!cancelled) setCheck({ barcode, state: inUse === null ? 'unknown' : inUse ? 'taken' : 'free' });
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [barcode]);

  const taken = check?.barcode === barcode && check.state === 'taken';
  useRegisterDraftSection({
    id: 'details',
    key: 'details:barcode',
    isDirty: () => false,
    stage: async () => undefined,
    validate: (): FieldIssue[] =>
      taken ? [{ field: 'barcode', section: 'details', severity: 'block_sync', key: 'listingEditor.trendyol.barcodeTaken' }] : [],
  });

  const onGenerate = async () => {
    setGenerating(true);
    let candidate = generateBarcode();
    for (let i = 0; i < 5; i++) {
      const inUse = await checkBarcodeInUse(candidate);
      if (inUse !== true) {
        if (inUse === false) setCheck({ barcode: candidate, state: 'free' });
        break;
      }
      candidate = generateBarcode();
    }
    set('barcode', candidate);
    setGenerating(false);
  };

  return (
    <FormField
      label={t('trendyol.barcode')}
      htmlFor={fieldAnchorId('barcode')}
      error={errorFor('barcode') ?? (taken ? t('trendyol.barcodeTaken') : null)}
      dirty={dirty('barcode')}
      onRevert={() => revert('barcode')}
      labelAction={!ro ? (
        <Button variant="ghost" size="sm" onClick={() => void onGenerate()} loading={generating} data-testid="le-trendyol-generate-barcode">
          {t('trendyol.generateBarcode')}
        </Button>
      ) : undefined}
      required
    >
      <TextField
        id={fieldAnchorId('barcode')}
        value={barcode}
        invalid={taken}
        onChange={(v) => set('barcode', v.replace(/\s+/g, ''))}
        maxLength={LIMITS.trendyolBarcode}
        readOnly={ro}
        mono
      />
    </FormField>
  );
}

function FixedField({ label, value, anchor, mono }: { label: string; value: string; anchor: string; mono?: boolean }) {
  const t = useTranslations('listingEditor');
  return (
    <FormField label={label} htmlFor={anchor} helper={t('trendyol.fixedAfterCreate')}>
      <TextField id={anchor} value={value || t('field.notSet')} onChange={() => undefined} readOnly mono={mono} />
    </FormField>
  );
}

export function TrendyolDetailsSection({ id = 'details' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const { ed, f, raw, ro, mode, errorFor, dirty, set, revert } = useCatalogSection();
  const create = mode === 'create';

  if (!create) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.details')} variant="plain" data-testid="le-section-details">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px', maxWidth: 720 }}>
          <FixedField label={t('trendyol.brand')} value={toStr(raw.brandName) || toStr(raw.brand)} anchor={fieldAnchorId('brandId')} />
          <FixedField label={t('trendyol.category')} value={toStr(raw.categoryName)} anchor={fieldAnchorId('categoryId')} />
          <FixedField label={t('trendyol.barcode')} value={toStr(raw.barcode) || toStr(ed.ctx.listingId)} anchor={fieldAnchorId('barcode')} mono />
          <FixedField label={t('trendyol.productMainId')} value={toStr(raw.productMainId)} anchor={fieldAnchorId('productMainId')} mono />
        </Box>
      </Section>
    );
  }

  const categoryId = toNum(f.categoryId);
  const categoryValue: ComboboxOption | null = categoryId
    ? { value: String(categoryId), label: toStr(f.categoryName) || t('field.categoryUnknown', { id: categoryId }), description: toStr(f.categoryPath) || undefined }
    : null;
  const brandId = toNum(f.brandId);
  const brandValue: ComboboxOption | null = brandId ? { value: String(brandId), label: toStr(f.brandName) || `#${brandId}` } : null;

  const loadCategories = async (q: string): Promise<ComboboxOption[]> =>
    searchTrendyolCategories(await loadTrendyolLeafCategories(), q).map((c) => ({ value: String(c.id), label: c.name, description: c.path }));
  const loadBrands = async (q: string): Promise<ComboboxOption[]> =>
    parseBrands(await fetchJson(`/api/trendyol/metadata?action=brands&name=${encodeURIComponent(q)}`)).map((b) => ({ value: String(b.id), label: b.name }));

  const onCategory = (o: ComboboxOption | null) => {
    const previous = { categoryId: f.categoryId ?? '', categoryName: f.categoryName ?? '', categoryPath: f.categoryPath ?? '', attributes: f.attributes ?? '[]' };
    const hadAttributes = typeof f.attributes === 'string' && f.attributes !== '[]' && f.attributes !== '';
    // The attributes belong to the category: a new category starts them empty (with Undo).
    ed.setFields({
      categoryId: o ? Number(o.value) : '',
      categoryName: o?.label ?? '',
      categoryPath: o?.description ?? '',
      attributes: '[]',
    });
    if (hadAttributes) {
      toast.success(t('trendyol.attributesCleared'), { undo: () => ed.setFields(previous as never), undoLabel: t('banner.undo') });
    }
  };

  const stockCode = toStr(f.stockCode);
  return (
    <Section id={sectionAnchorId(id)} title={t('section.categoryBrand')} description={t('trendyol.categoryFirst')} variant="plain" data-testid="le-section-details">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField label={t('trendyol.category')} htmlFor={fieldAnchorId('categoryId')} helper={t('trendyol.categoryLeaf')} error={errorFor('categoryId')} required>
          <Combobox
            id={fieldAnchorId('categoryId')}
            value={categoryValue}
            onChange={onCategory}
            loadOptions={loadCategories}
            minQueryLength={2}
            placeholder={t('field.categorySearch')}
            noOptionsText={t('field.categoryNoMatch')}
            disabled={ro}
          />
        </FormField>
        <FormField label={t('trendyol.brand')} htmlFor={fieldAnchorId('brandId')} helper={t('trendyol.brandHelper')} error={errorFor('brandId')} required>
          <Combobox
            id={fieldAnchorId('brandId')}
            value={brandValue}
            onChange={(o) => ed.setFields({ brandId: o ? Number(o.value) : '', brandName: o?.label ?? '' })}
            loadOptions={loadBrands}
            minQueryLength={2}
            placeholder={t('trendyol.brandSearch')}
            disabled={ro}
          />
        </FormField>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px', alignItems: 'start' }}>
          <CreateBarcodeField />
          <FormField label={t('trendyol.productMainId')} htmlFor={fieldAnchorId('productMainId')} helper={t('trendyol.productMainIdHelper')} error={errorFor('productMainId')} optional>
            <NormalizedTextField
              id={fieldAnchorId('productMainId')}
              value={toStr(f.productMainId)}
              placeholder={stockCode || undefined}
              onChange={(v) => set('productMainId', v)}
              maxLength={LIMITS.trendyolStockCode}
              readOnly={ro}
              mono
            />
          </FormField>
        </Box>
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Shipping: desi, cargo company (fixed after create), shipment / returning address (create only)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TrendyolShippingSection({ id = 'shipping' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { ed, f, raw, ro, mode, errorFor, dirty, set, revert } = useCatalogSection();
  const create = mode === 'create';
  const cargo = useRemoteList('/api/trendyol/metadata?action=cargo_companies', parseCargoCompanies);
  const addresses = useRemoteList(create ? '/api/trendyol/metadata?action=addresses' : null, parseAddresses);

  // Create: preselect Trendyol's default shipment / returning address once the list arrives.
  const { setFields } = ed;
  const shipmentId = toNum(f.shipmentAddressId);
  const returningId = toNum(f.returningAddressId);
  React.useEffect(() => {
    if (!create || addresses.status !== 'ready') return;
    const patch: Record<string, number> = {};
    const defShip = addresses.items.find((a) => a.type === 'shipment' && a.isDefault) ?? addresses.items.find((a) => a.type === 'shipment');
    const defRet = addresses.items.find((a) => a.type === 'returning' && a.isDefault) ?? addresses.items.find((a) => a.type === 'returning');
    if (!shipmentId && defShip) patch.shipmentAddressId = defShip.id;
    if (!returningId && defRet) patch.returningAddressId = defRet.id;
    if (Object.keys(patch).length) setFields(patch);
  }, [create, addresses.status, addresses.items, shipmentId, returningId, setFields]);

  const cargoId = create ? toNum(f.cargoCompanyId) : toNum(raw.cargoCompanyId);
  const cargoName = cargo.items.find((c) => c.id === cargoId)?.name ?? (cargoId ? `#${cargoId}` : '');
  const addressOptions = (type: 'shipment' | 'returning') =>
    addresses.items.filter((a) => a.type === type).map((a) => ({ value: a.id, label: a.label }));
  const listHelper = (status: string, retry: () => void) =>
    status === 'error' ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        {t('trendyol.listLoadFailed')}
        <Button variant="ghost" size="sm" onClick={retry}>{t('save.retry')}</Button>
      </Box>
    ) : undefined;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.shipping')} variant="plain" data-testid="le-section-shipping">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: '12px', alignItems: 'start' }}>
          <FormField label={t('trendyol.desi')} htmlFor={fieldAnchorId('dimensionalWeight')} error={errorFor('dimensionalWeight')} dirty={dirty('dimensionalWeight')} onRevert={() => revert('dimensionalWeight')} required={create}>
            <NumberField
              id={fieldAnchorId('dimensionalWeight')}
              value={toNum(f.dimensionalWeight)}
              onChange={(n) => set('dimensionalWeight', numOrBlank(n))}
              min={0}
              max={LIMITS.desiMax}
              decimals={2}
              readOnly={ro}
            />
          </FormField>
          {create ? (
            <FormField label={t('trendyol.cargo')} htmlFor={fieldAnchorId('cargoCompanyId')} helper={listHelper(cargo.status, cargo.retry) ?? t('trendyol.fixedAfterCreate')} error={errorFor('cargoCompanyId')} required>
              <Select<number>
                id={fieldAnchorId('cargoCompanyId')}
                value={cargoId}
                options={cargo.items.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => set('cargoCompanyId', v)}
                disabled={ro || cargo.status !== 'ready'}
                placeholder={t('field.choose')}
              />
            </FormField>
          ) : (
            <FormField label={t('trendyol.cargo')} htmlFor={fieldAnchorId('cargoCompanyId')} helper={t('trendyol.fixedAfterCreate')}>
              <TextField id={fieldAnchorId('cargoCompanyId')} value={cargoName || t('field.notSet')} onChange={() => undefined} readOnly />
            </FormField>
          )}
        </Box>
        {create ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px', alignItems: 'start' }}>
            {(['shipment', 'returning'] as const).map((type) => {
              const key = type === 'shipment' ? 'shipmentAddressId' : 'returningAddressId';
              return (
                <FormField key={key} label={t(type === 'shipment' ? 'trendyol.shipAddress' : 'trendyol.returnAddress')} htmlFor={fieldAnchorId(key)} helper={listHelper(addresses.status, addresses.retry)} error={errorFor(key)} required>
                  <Select<number>
                    id={fieldAnchorId(key)}
                    value={toNum(f[key])}
                    options={addressOptions(type)}
                    onChange={(v) => set(key, v)}
                    disabled={ro || addresses.status !== 'ready'}
                    placeholder={t('field.choose')}
                  />
                </FormField>
              );
            })}
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Variants: read-only siblings by productMainId; each opens its own editor
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendyolSibling {
  barcode: string;
  title?: string;
  image?: string | null;
  /** "Renk: Naturel · Beden: M" style pairs (variant attributes). */
  attributes?: Array<{ name: string; value: string }>;
  quantity?: number | null;
}

/** Cache rows (`TrendyolProduct`) → siblings (drops the product itself). Pure. */
export function parseSiblings(list: unknown, selfBarcode: string | null): TrendyolSibling[] {
  if (!Array.isArray(list)) return [];
  const out: TrendyolSibling[] = [];
  for (const row of list) {
    const r = rawRecord(row);
    const barcode = toStr(r.barcode);
    if (!barcode || barcode === selfBarcode || out.some((s) => s.barcode === barcode)) continue;
    const images = Array.isArray(r.images) ? r.images : [];
    const firstImage = toStr(r.thumbnailUrl) || toStr(rawRecord(images[0]).url) || null;
    const attributes = (Array.isArray(r.attributes) ? r.attributes : [])
      .map((a) => ({ name: toStr(rawRecord(a).attributeName), value: toStr(rawRecord(a).attributeValue) }))
      .filter((a) => a.name && a.value);
    out.push({ barcode, title: toStr(r.title) || undefined, image: firstImage, attributes, quantity: toNum(r.quantity) });
  }
  return out;
}

export interface TrendyolVariantsSectionProps extends Partial<ListingSectionProps> {
  /** Siblings sharing `productMainId` (default: `view.meta.raw.siblings`, rows of the cache). */
  siblings?: TrendyolSibling[];
}

export function TrendyolVariantsSection({ id = 'variations', siblings: siblingsProp }: TrendyolVariantsSectionProps) {
  const t = useTranslations('listingEditor');
  const fmt = useFormatters();
  const { raw, ed } = useCatalogSection();
  const [open, setOpen] = React.useState(false);
  const self = toStr(raw.barcode) || ed.ctx.listingId;
  // `undefined` = not loaded (the editor has no sibling list yet), which is not the same as "none".
  const siblings = siblingsProp ?? (Array.isArray(raw.siblings) ? parseSiblings(raw.siblings, self) : undefined);
  if (ed.mode === 'create') return null;
  const productMainId = toStr(raw.productMainId);
  if (productMainId && siblings === undefined) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.variants')} variant="plain" data-testid="le-section-variations">
        <Box sx={{ color: neutral[600], fontSize: 14 }} data-testid="le-trendyol-siblings-unknown">
          {t('trendyol.siblingsNotLoaded', { id: productMainId })}
        </Box>
      </Section>
    );
  }

  return (
    <Section id={sectionAnchorId(id)} title={t('section.variants')} variant="plain" data-testid="le-section-variations">
      {!productMainId || !siblings || siblings.length === 0 ? (
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('trendyol.noSiblings')}</Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: 720 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', color: neutral[700], fontSize: 14 }}>
            {t('trendyol.siblings', { count: siblings.length + 1 })}
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} data-testid="le-trendyol-siblings-toggle">
              {open ? t('common.hide') : t('common.show')}
            </Button>
          </Box>
          {open ? (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {siblings.map((s) => (
                <Box component="li" key={s.barcode} sx={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: 48 }}>
                  <Thumb src={s.image ?? null} alt={s.title ?? s.barcode} size={40} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ fontSize: 14, color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.attributes?.length ? s.attributes.map((a) => `${a.name}: ${a.value}`).join(' · ') : s.title ?? s.barcode}
                    </Box>
                    <Box sx={{ fontSize: 12, color: neutral[600], fontVariantNumeric: 'tabular-nums' }}>
                      {s.barcode}
                      {typeof s.quantity === 'number' ? ` · ${t('trendyol.inStockCount', { count: fmt.num(s.quantity) })}` : ''}
                    </Box>
                  </Box>
                  <Button variant="ghost" size="sm" href={editorHref('trendyol', s.barcode)} trailingIcon={icons.next}>
                    {t('common.open')}
                  </Button>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </Section>
  );
}
