// components/domain/listing-editor/sections/WixDetailsSection.tsx — M6b-D: Wix "Details" (marketplace-editors
// §3 row 6, §4.2): Collections (multi `Combobox` from `/api/wix/collections`; the target set, the executor diffs
// it), Ribbon, Visible in store. Also the Wix "Variants" section (row 5): a read-only option summary with
// "Edit options in Wix ↗" (no invented variant editor, §1). Only `setField` here.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, Combobox, FormField, Switch, TextField, type ComboboxOption } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS } from '@/lib/catalogDrafts/schemas';
import { rawRecord, toBool, toStr, toStrList, useCatalogSection, useRemoteList } from './marketplaceSectionShared';

/** Wix's automatic "All Products" collection: every product is in it, it can't be added or removed. */
export const WIX_ALL_PRODUCTS_COLLECTION = '00000000-000000-000000-000000000001';

/** `GET /api/wix/collections` → manual collections (pure). */
export function parseWixCollections(data: unknown): Array<{ id: string; name: string }> {
  const list = (data as { collections?: unknown[] } | null)?.collections;
  if (!Array.isArray(list)) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const c of list) {
    const r = rawRecord(c);
    const id = toStr(r.id) || toStr(r._id);
    const name = toStr(r.name).trim();
    if (id && name && id !== WIX_ALL_PRODUCTS_COLLECTION && !out.some((x) => x.id === id)) out.push({ id, name });
  }
  return out;
}

export function WixDetailsSection({ id = 'details' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const collections = useRemoteList('/api/wix/collections', parseWixCollections);
  const selected = toStrList(f.collectionIds).filter((c) => c !== WIX_ALL_PRODUCTS_COLLECTION);
  const nameOf = (cid: string) => collections.items.find((c) => c.id === cid)?.name ?? t('wix.collectionUnknown');
  const options: ComboboxOption[] = collections.items.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Section id={sectionAnchorId(id)} title={t('section.details')} variant="plain" data-testid="le-section-details">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField
          label={t('wix.collections')}
          htmlFor={fieldAnchorId('collectionIds')}
          helper={collections.status === 'error' ? t('wix.collectionsLoadFailed') : undefined}
          labelAction={collections.status === 'error' && !ro ? (
            <Button variant="ghost" size="sm" onClick={collections.retry}>{t('save.retry')}</Button>
          ) : undefined}
          error={errorFor('collectionIds')}
          dirty={dirty('collectionIds')}
          onRevert={() => revert('collectionIds')}
          optional
        >
          <Combobox
            id={fieldAnchorId('collectionIds')}
            multiple
            value={selected.map((cid) => ({ value: cid, label: nameOf(cid) }))}
            onChange={(list) => set('collectionIds', Array.from(new Set(list.map((o) => o.value))).slice(0, LIMITS.wixCollections))}
            options={options}
            disabled={ro || collections.status === 'loading'}
            placeholder={t('wix.collectionsPlaceholder')}
          />
        </FormField>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '240px 1fr' }, gap: '12px', alignItems: 'end' }}>
          <FormField label={t('wix.ribbon')} htmlFor={fieldAnchorId('ribbon')} helper={t('wix.ribbonHelper')} error={errorFor('ribbon')} dirty={dirty('ribbon')} onRevert={() => revert('ribbon')} optional>
            <TextField id={fieldAnchorId('ribbon')} value={toStr(f.ribbon)} onChange={(v) => set('ribbon', v)} maxLength={LIMITS.wixRibbon} readOnly={ro} />
          </FormField>
          <Box sx={{ pb: '6px' }}>
            <Switch id={fieldAnchorId('visible')} checked={toBool(f.visible, true)} onChange={(c) => set('visible', c)} label={t('wix.visible')} disabled={ro} />
          </Box>
        </Box>
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Variants (read-only summary)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Wix `productOptions` (cache `options`) → "Size" with its choice count. Pure. */
export function wixOptionSummary(raw: Record<string, unknown>): { options: Array<{ name: string; count: number }>; combinations: number } {
  const opts = Array.isArray(raw.options) ? raw.options : Array.isArray(raw.productOptions) ? raw.productOptions : [];
  const options = opts
    .map((o) => {
      const r = rawRecord(o);
      return { name: toStr(r.name).trim(), count: Array.isArray(r.choices) ? r.choices.length : 0 };
    })
    .filter((o) => o.name && o.count > 0);
  const variants = Array.isArray(raw.variants) ? raw.variants.length : 0;
  const product = options.reduce((n, o) => n * o.count, options.length ? 1 : 0);
  return { options, combinations: variants > 1 ? variants : product };
}

/**
 * Wix dashboard page of the product (where options are edited): `raw.editUrl`, else built from the cache row's
 * `wixSiteId` + `wixProductId`. Null when neither is known; never the storefront page. Pure.
 */
export function wixDashboardUrl(raw: Record<string, unknown>): string | null {
  const explicit = toStr(raw.editUrl);
  if (/^https:\/\/manage\.wix\.com\//.test(explicit)) return explicit;
  const site = toStr(raw.wixSiteId).trim();
  const product = toStr(raw.wixProductId).trim();
  const safe = /^[A-Za-z0-9-]+$/;
  return safe.test(site) && safe.test(product)
    ? `https://manage.wix.com/dashboard/${site}/store/products/product/${product}`
    : null;
}

export interface WixVariantsSectionProps extends Partial<ListingSectionProps> {
  /** Wix dashboard link for this product (default: `wixDashboardUrl(view.meta.raw)`). */
  editUrl?: string | null;
}

export function WixVariantsSection({ id = 'variations', editUrl }: WixVariantsSectionProps) {
  const t = useTranslations('listingEditor');
  const { ed, raw } = useCatalogSection();
  if (ed.mode === 'create') return null;
  const { options, combinations } = wixOptionSummary(raw);
  const href = editUrl ?? wixDashboardUrl(raw);
  return (
    <Section id={sectionAnchorId(id)} title={t('section.variants')} variant="plain" data-testid="le-section-variations">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: neutral[700], fontSize: 14, maxWidth: 720 }}>
        {options.length ? (
          <span>
            {options.map((o) => `${o.name} (${o.count})`).join(' · ')}
            {combinations > 1 ? ` · ${t('wix.combinations', { count: combinations })}` : ''}
          </span>
        ) : (
          <span>{t('variations.none')}</span>
        )}
        {href ? (
          <Button variant="ghost" size="sm" href={href} external trailingIcon={icons.externalLink}>
            {t('wix.editOptions')}
          </Button>
        ) : null}
      </Box>
    </Section>
  );
}
