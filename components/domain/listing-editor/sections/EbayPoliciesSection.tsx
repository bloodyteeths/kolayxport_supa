// components/domain/listing-editor/sections/EbayPoliciesSection.tsx — listing-editor §2.1 #8 "Shipping" (eBay).
// Business policies (shipping / fulfillment, return, payment) and package weight + dimensions. All three
// policies are required by eBay's offer; a policy list that fails to load keeps the current value visible and
// offers Retry (listing-editor §6.1). Values stage through the engine's `setField` (adapters/ebay.ts builds
// `offerPatch.listingPolicies` / `inventoryPatch.packageWeightAndSize`); nothing is sent to eBay until Send.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FormField, NumberField, Select } from '@/components/ds/inputs';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { useListingEditor } from '../useListingDraft';
import { useFieldError } from './useEtsySection';
import {
  EBAY_DIMENSION_UNITS,
  EBAY_WEIGHT_UNITS,
  type EbayEditorFields,
  type EbayFieldKey,
} from '../adapters/ebay';

export interface EbayPolicy {
  policyId: string;
  name: string;
  description?: string;
}

export type PolicyKind = 'fulfillment' | 'return' | 'payment';

export interface PolicyList {
  status: 'loading' | 'ready' | 'error';
  items: EbayPolicy[];
  retry: () => void;
}

export type EbayPolicyLists = Record<PolicyKind, PolicyList>;

const ENDPOINT: Record<PolicyKind, { action: string; key: string }> = {
  fulfillment: { action: 'fulfillment_policies', key: 'fulfillmentPolicies' },
  return: { action: 'return_policies', key: 'returnPolicies' },
  payment: { action: 'payment_policies', key: 'paymentPolicies' },
};

const FIELD: Record<PolicyKind, 'fulfillmentPolicyId' | 'returnPolicyId' | 'paymentPolicyId'> = {
  fulfillment: 'fulfillmentPolicyId',
  return: 'returnPolicyId',
  payment: 'paymentPolicyId',
};

/** Short unit labels (units are not translated). */
export const EBAY_UNIT_LABEL: Record<string, string> = {
  KILOGRAM: 'kg',
  POUND: 'lb',
  GRAM: 'g',
  OUNCE: 'oz',
  CENTIMETER: 'cm',
  INCH: 'in',
  METER: 'm',
  FEET: 'ft',
};

/** Pure: a policies response → options (exported for tests). */
export function parsePolicies(kind: PolicyKind, data: unknown): EbayPolicy[] {
  const list = (data as Record<string, unknown> | null)?.[ENDPOINT[kind].key];
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      const id = r.policyId ?? r.fulfillmentPolicyId ?? r.returnPolicyId ?? r.paymentPolicyId;
      return {
        policyId: id != null ? String(id) : '',
        name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : String(id ?? ''),
        description: typeof r.description === 'string' ? r.description : undefined,
      };
    })
    .filter((p) => p.policyId);
}

/** Loads the seller's three policy lists once (each list has its own state; none blocks the form). */
export function useEbayPolicies(enabled = true): EbayPolicyLists {
  const [state, setState] = useState<Record<PolicyKind, { status: PolicyList['status']; items: EbayPolicy[] }>>({
    fulfillment: { status: 'loading', items: [] },
    return: { status: 'loading', items: [] },
    payment: { status: 'loading', items: [] },
  });
  const [nonce, setNonce] = useState<Record<PolicyKind, number>>({ fulfillment: 0, return: 0, payment: 0 });

  const load = useCallback(async (kind: PolicyKind, signal: { cancelled: boolean }) => {
    setState((s) => ({ ...s, [kind]: { ...s[kind], status: 'loading' } }));
    try {
      const res = await fetch(`/api/clawd/ebay?action=${ENDPOINT[kind].action}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parsePolicies(kind, await res.json());
      if (!signal.cancelled) setState((s) => ({ ...s, [kind]: { status: 'ready', items } }));
    } catch {
      if (!signal.cancelled) setState((s) => ({ ...s, [kind]: { ...s[kind], status: 'error' } }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const signal = { cancelled: false };
    void load('fulfillment', signal);
    return () => { signal.cancelled = true; };
  }, [enabled, load, nonce.fulfillment]);
  useEffect(() => {
    if (!enabled) return undefined;
    const signal = { cancelled: false };
    void load('return', signal);
    return () => { signal.cancelled = true; };
  }, [enabled, load, nonce.return]);
  useEffect(() => {
    if (!enabled) return undefined;
    const signal = { cancelled: false };
    void load('payment', signal);
    return () => { signal.cancelled = true; };
  }, [enabled, load, nonce.payment]);

  const retry = (kind: PolicyKind) => () => setNonce((n) => ({ ...n, [kind]: n[kind] + 1 }));
  return {
    fulfillment: { ...state.fulfillment, retry: retry('fulfillment') },
    return: { ...state.return, retry: retry('return') },
    payment: { ...state.payment, retry: retry('payment') },
  };
}

export interface EbayPoliciesSectionProps extends Partial<ListingSectionProps> {
  /** Policy lists loaded once by the page (shared with the preview's "Free shipping" line). Omit to load here. */
  policies?: EbayPolicyLists;
}

const toNum = (v: number | ''): number | null => (v === '' ? null : v);
const fromNum = (v: number | null): number | '' => (typeof v === 'number' && Number.isFinite(v) ? v : '');

export function EbayPoliciesSection({ id = 'shipping', policies }: EbayPoliciesSectionProps) {
  const t = useTranslations('listingEditor');
  const ed = useListingEditor<EbayEditorFields>();
  const own = useEbayPolicies(!policies);
  const lists = policies ?? own;
  const errorFor = useFieldError({ issues: ed.issues });
  const ro = ed.readOnly;
  const f = ed.view.fields;
  const defaults = new Set(ed.defaultsApplied);
  const dirty = (key: EbayFieldKey) => ed.mode === 'edit' && ed.isFieldDirty(key);
  const set = <K extends EbayFieldKey>(key: K, value: EbayEditorFields[K]) => ed.setField(key, value);

  const policyField = (kind: PolicyKind, label: string) => {
    const key = FIELD[kind];
    const list = lists[kind];
    const value = f[key];
    const known = !value || list.items.some((p) => p.policyId === value);
    const options = [
      ...list.items.map((p) => ({ value: p.policyId, label: p.name, description: p.description })),
      ...(!known ? [{ value, label: t('field.currentItem', { id: value }) }] : []),
    ];
    return (
      <FormField
        key={key}
        label={label}
        htmlFor={fieldAnchorId(key)}
        width="medium"
        required
        error={errorFor(key) ?? (list.status === 'error' ? t('field.profilesLoadFailed') : null)}
        helper={defaults.has(key) ? t('field.fromLastListing') : undefined}
        dirty={dirty(key)}
        onRevert={() => ed.revert([key])}
        labelAction={list.status === 'error' && !ro ? (
          <Button variant="ghost" size="sm" onClick={list.retry}>{t('save.retry')}</Button>
        ) : undefined}
      >
        <Select<string>
          id={fieldAnchorId(key)}
          value={value || null}
          onChange={(next) => set(key, next)}
          disabled={ro || list.status === 'loading'}
          placeholder={t('field.choose')}
          options={options}
        />
      </FormField>
    );
  };

  const dim = (key: 'length' | 'width' | 'height', label: string) => (
    <FormField label={label} htmlFor={fieldAnchorId(key)} dirty={dirty(key)} onRevert={() => ed.revert([key])} error={errorFor(key)}>
      <NumberField
        id={fieldAnchorId(key)}
        value={toNum(f[key])}
        onChange={(n) => set(key, fromNum(n))}
        min={0}
        decimals={2}
        unit={EBAY_UNIT_LABEL[f.dimensionUnit] ?? f.dimensionUnit}
        readOnly={ro}
      />
    </FormField>
  );

  return (
    <Section id={sectionAnchorId(id)} title={t('section.shipping')} variant="plain" data-testid="le-section-shipping">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        {policyField('fulfillment', t('field.shippingPolicy'))}
        {policyField('return', t('field.returnPolicy'))}
        {policyField('payment', t('field.paymentPolicy'))}

        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Box sx={{ width: 160 }}>
            <FormField
              label={t('field.weight')}
              htmlFor={fieldAnchorId('weight')}
              error={errorFor('weight')}
              dirty={dirty('weight') || dirty('weightUnit')}
              onRevert={() => ed.revert(['weight', 'weightUnit'])}
            >
              <NumberField
                id={fieldAnchorId('weight')}
                value={toNum(f.weight)}
                onChange={(n) => set('weight', fromNum(n))}
                min={0}
                decimals={3}
                readOnly={ro}
              />
            </FormField>
          </Box>
          <Box sx={{ width: 96 }}>
            <FormField label={t('field.weightUnit')} hideLabel>
              <Select<string>
                value={f.weightUnit || 'KILOGRAM'}
                onChange={(v) => set('weightUnit', v)}
                disabled={ro}
                aria-label={t('field.weightUnit')}
                options={EBAY_WEIGHT_UNITS.map((u) => ({ value: u, label: EBAY_UNIT_LABEL[u] }))}
              />
            </FormField>
          </Box>
        </Box>

        <Box
          role="group"
          aria-label={t('field.dimensions')}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '120px 120px 120px 96px' }, gap: '12px', alignItems: 'end' }}
        >
          {dim('length', t('field.length'))}
          {dim('width', t('field.width'))}
          {dim('height', t('field.height'))}
          <FormField label={t('field.dimensionsUnit')} hideLabel dirty={dirty('dimensionUnit')} onRevert={() => ed.revert(['dimensionUnit'])}>
            <Select<string>
              value={f.dimensionUnit || 'CENTIMETER'}
              onChange={(v) => set('dimensionUnit', v)}
              disabled={ro}
              aria-label={t('field.dimensionsUnit')}
              options={EBAY_DIMENSION_UNITS.map((u) => ({ value: u, label: EBAY_UNIT_LABEL[u] }))}
            />
          </FormField>
        </Box>
      </Box>
    </Section>
  );
}

export default EbayPoliciesSection;
