// components/domain/listing-editor/sections/ShippingSection.tsx — listing-editor §2.1 #8 "Shipping" (Etsy).
// Shipping profile (+ New shipping profile → SidePanel md), processing profile, return policy (+ New return
// policy → Modal md), weight and size. New profiles/policies are queued `create_*` actions with negative temp
// ids (drawer payloads, unchanged) that Etsy runs on Send; the select shows them as "… · created when you send"
// and keeps showing them after a reload (read from the draft's queued actions). A list that fails to load keeps
// the current value visible and offers Retry (listing-editor §6.1).
import { useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FormField, NumberField, Select } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { EtsyFieldKey, ListingSectionProps } from '@/lib/listingEditor/types';
import { CreateShippingProfilePanel } from './CreateShippingProfilePanel';
import { CreateReturnPolicyModal, type ReturnPolicyPayload } from './CreateReturnPolicyModal';
import { ProcessingProfileField } from './ProcessingProfileField';
import {
  DIMENSION_UNITS, WEIGHT_UNITS, fieldDomId, mergeById, newTempId, numOrEmpty, numOrNull, pendingCreates,
  useEtsyShopMeta, type EtsyShopMeta, type ReturnPolicyOption, type ShopMetaList,
} from './etsyShared';
import { useEtsySection, useFieldError } from './useEtsySection';

export interface ShippingSectionProps extends Partial<ListingSectionProps> {
  /** Shop lists loaded once by the frame (shared with DetailsSection). Omit to load here. */
  shopMeta?: EtsyShopMeta;
  /** Seller's default origin country for new shipping profiles (settings). Default 'TR'. */
  defaultOrigin?: string;
}

export function ShippingSection({ id = 'shipping', shopMeta, defaultOrigin }: ShippingSectionProps) {
  const t = useTranslations('listingEditor');
  const api = useEtsySection();
  const errorFor = useFieldError(api);
  const ownMeta = useEtsyShopMeta(shopMeta ? null : api.shopId);
  const meta = shopMeta ?? ownMeta;
  const [shippingOpen, setShippingOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const ro = api.readOnly;
  const f = api.fields;

  const pending = pendingCreates(api.draft?.queuedActions);
  const profiles = mergeById(
    meta.shippingProfiles.items,
    pending.shippingProfiles.map((p) => ({ ...p, title: t('field.pendingItem', { name: p.title }) })),
    'shipping_profile_id',
  );
  const policies = mergeById(meta.returnPolicies.items, pending.returnPolicies.map((p) => ({ ...p, description: 'pending' })), 'return_policy_id');

  const policyLabel = (p: ReturnPolicyOption) => {
    const base = !p.accepts_returns && !p.accepts_exchanges
      ? t('returnForm.none')
      : p.accepts_returns && p.accepts_exchanges
        ? t('returnForm.returnsAndExchanges')
        : p.accepts_returns ? t('returnForm.returnsOnly') : t('returnForm.exchangesOnly');
    const withDays = p.return_deadline && (p.accepts_returns || p.accepts_exchanges) ? `${base} · ${t('returnForm.days', { count: p.return_deadline })}` : base;
    return p.description === 'pending' ? t('field.pendingItem', { name: withDays }) : withDays;
  };

  const createShipping = async (payload: Record<string, unknown>) => {
    const tempId = newTempId();
    await api.stageActions([{ type: 'create_shipping_profile', tempId, payload }], { shipping_profile_id: tempId });
  };
  const createReturn = async (payload: ReturnPolicyPayload) => {
    const tempId = newTempId();
    await api.stageActions([{ type: 'create_return_policy', tempId, payload: { ...payload } }], { return_policy_id: tempId });
  };

  const fromDefaults = (key: string) => (api.fromDefaults?.has(key) ? t('field.fromLastListing') : undefined);

  const listAction = (list: ShopMetaList<unknown>, onNew: () => void, newLabel: string) => (ro ? undefined : list.status === 'error' ? (
    <Button variant="ghost" size="sm" onClick={list.retry}>{t('save.retry')}</Button>
  ) : (
    <Button variant="ghost" size="sm" icon={icons.add} onClick={onNew}>{newLabel}</Button>
  ));

  const idSelect = (
    key: 'shipping_profile_id' | 'return_policy_id',
    list: ShopMetaList<unknown>,
    options: Array<{ value: string; label: string }>,
  ) => {
    const v = f[key];
    const known = v === '' || options.some((o) => o.value === String(v));
    return (
      <Select<string>
        id={fieldDomId(key)}
        value={v === '' ? '' : String(v)}
        onChange={(next) => api.setField(key, next ? Number(next) : '')}
        disabled={ro || list.status === 'loading'}
        placeholder={t('field.choose')}
        options={[
          ...options,
          ...(!known ? [{ value: String(v), label: t('field.currentItem', { id: v }) }] : []),
        ]}
      />
    );
  };

  const dim = (key: EtsyFieldKey & ('item_length' | 'item_width' | 'item_height'), label: string) => (
    <FormField label={label} htmlFor={fieldDomId(key)} dirty={api.isDirty(key)} onRevert={() => api.revert(key)}>
      <NumberField
        id={fieldDomId(key)}
        value={numOrNull(f[key])}
        onChange={(n) => api.setField(key, numOrEmpty(n))}
        min={0}
        decimals={2}
        unit={f.item_dimensions_unit || undefined}
        readOnly={ro}
      />
    </FormField>
  );

  return (
    <Section id={sectionAnchorId(id)} title={t('section.shipping')} variant="plain" data-testid="le-section-shipping">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField
          label={t('field.shippingProfile')}
          htmlFor={fieldDomId('shipping_profile_id')}
          width="medium"
          required
          error={errorFor('shipping_profile_id') ?? (meta.shippingProfiles.status === 'error' ? t('field.profilesLoadFailed') : null)}
          helper={fromDefaults('shipping_profile_id')}
          dirty={api.isDirty('shipping_profile_id')}
          onRevert={() => api.revert('shipping_profile_id')}
          labelAction={listAction(meta.shippingProfiles, () => setShippingOpen(true), t('field.newShippingProfile'))}
        >
          {idSelect('shipping_profile_id', meta.shippingProfiles, profiles.map((p) => ({ value: String(p.shipping_profile_id), label: p.title })))}
        </FormField>

        <ProcessingProfileField
          shopId={api.shopId}
          value={f.readiness_state_id}
          onChange={(v) => api.setField('readiness_state_id', v)}
          options={meta.readinessStates.items}
          status={meta.readinessStates.status}
          onRetry={meta.readinessStates.retry}
          onCreated={meta.readinessStates.add}
          dirty={api.isDirty('readiness_state_id')}
          onRevert={() => api.revert('readiness_state_id')}
          readOnly={ro}
          error={errorFor('readiness_state_id') ?? errorFor('processing_min') ?? errorFor('processing_max')}
        />

        <FormField
          label={t('field.returnPolicy')}
          htmlFor={fieldDomId('return_policy_id')}
          width="medium"
          optional
          error={errorFor('return_policy_id') ?? (meta.returnPolicies.status === 'error' ? t('field.profilesLoadFailed') : null)}
          helper={fromDefaults('return_policy_id')}
          dirty={api.isDirty('return_policy_id')}
          onRevert={() => api.revert('return_policy_id')}
          labelAction={listAction(meta.returnPolicies, () => setReturnOpen(true), t('field.newReturnPolicy'))}
        >
          {idSelect('return_policy_id', meta.returnPolicies, [
            { value: '', label: t('field.notSet') },
            ...policies.map((p) => ({ value: String(p.return_policy_id), label: policyLabel(p) })),
          ])}
        </FormField>

        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Box sx={{ width: 160 }}>
            <FormField
              label={t('field.weight')}
              htmlFor={fieldDomId('item_weight')}
              error={errorFor('item_weight')}
              dirty={api.isDirty('item_weight') || api.isDirty('item_weight_unit')}
              onRevert={() => { api.revert('item_weight'); api.revert('item_weight_unit'); }}
            >
              <NumberField
                id={fieldDomId('item_weight')}
                value={numOrNull(f.item_weight)}
                onChange={(n) => api.setField('item_weight', numOrEmpty(n))}
                min={0}
                decimals={3}
                readOnly={ro}
              />
            </FormField>
          </Box>
          <Box sx={{ width: 96 }}>
            <FormField label={t('field.weightUnit')} hideLabel>
              <Select<string>
                value={f.item_weight_unit || 'g'}
                onChange={(v) => api.setField('item_weight_unit', v)}
                disabled={ro}
                aria-label={t('field.weightUnit')}
                options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))}
              />
            </FormField>
          </Box>
        </Box>

        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '120px 120px 120px 96px' }, gap: '12px', alignItems: 'end' }}>
            {dim('item_length', t('field.length'))}
            {dim('item_width', t('field.width'))}
            {dim('item_height', t('field.height'))}
            <FormField label={t('field.dimensionsUnit')} hideLabel dirty={api.isDirty('item_dimensions_unit')} onRevert={() => api.revert('item_dimensions_unit')}>
              <Select<string>
                value={f.item_dimensions_unit || 'cm'}
                onChange={(v) => api.setField('item_dimensions_unit', v)}
                disabled={ro}
                aria-label={t('field.dimensionsUnit')}
                options={DIMENSION_UNITS.map((u) => ({ value: u, label: u }))}
              />
            </FormField>
          </Box>
        </Box>
      </Box>

      <CreateShippingProfilePanel
        open={shippingOpen}
        onClose={() => setShippingOpen(false)}
        onSubmit={createShipping}
        currency={api.currency}
        defaultOrigin={defaultOrigin}
      />
      <CreateReturnPolicyModal open={returnOpen} onClose={() => setReturnOpen(false)} onSubmit={createReturn} />
    </Section>
  );
}

export default ShippingSection;
