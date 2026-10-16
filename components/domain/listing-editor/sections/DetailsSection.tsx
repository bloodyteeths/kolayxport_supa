// components/domain/listing-editor/sections/DetailsSection.tsx — listing-editor §2.1 #6 "Details" (Etsy).
// Category (taxonomy Combobox), category details (taxonomy properties; required first), who made it / what is
// it / when was it made, and the shop section with "+ New section".
//
// Category details stage through the autosave engine (registered DraftSection, no "Save category details"
// button any more): the payload is the drawer's `stageEtsyDraft({ taxonomy: { properties: changed } })` with
// `changed` computed against the Etsy values exactly like `getChangedListingProperties`. On open the staged
// `taxonomyPatch` is overlaid on the Etsy values (I0 server-draft overlay). A new shop section is a queued
// `create_shop_section` with a negative temp id (drawer payload, unchanged).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, Combobox, FormField, RadioGroup, Select, type ComboboxOption } from '@/components/ds/inputs';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { icons } from '@/lib/ds/icons';
import { neutral, tone, type as typeScale } from '@/lib/ds/tokens';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';
import { WHEN_MADE_OPTIONS, whenMadeLabelKey } from '@/lib/etsy/validation';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { CategoryCombobox } from './CategoryCombobox';
import { NewSectionModal } from './NewSectionModal';
import {
  changedListingProperties, fieldDomId, keepApplicableProperties, mergeById, newTempId, overlayStagedProperties,
  parseListingProperties, parseTaxonomyProperties, pendingCreates, requiredAttributeSummary, useEtsyShopMeta,
  WHO_MADE_I18N, WHO_MADE_VALUES,
  type EtsyShopMeta, type ListingPropertyMap, type ListingPropertyValue, type LoadStatus, type TaxonomyProperty,
} from './etsyShared';
import { useEtsySection, useFieldError } from './useEtsySection';

export interface DetailsSectionProps extends Partial<ListingSectionProps> {
  /** Shop lists loaded once by the frame (shared with ShippingSection). Omit to load here. */
  shopMeta?: EtsyShopMeta;
}

type PropsLoad = { status: LoadStatus | 'none'; props: TaxonomyProperty[] };

function PropertyField({ prop, value, onChange, disabled }: {
  prop: TaxonomyProperty;
  value: ListingPropertyValue | undefined;
  onChange: (next: ListingPropertyValue) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('listingEditor');
  const options: ComboboxOption[] = prop.possible_values.map((v) => ({ value: v.value_id != null ? String(v.value_id) : `n:${v.name}`, label: v.name }));
  const selected: ComboboxOption[] = (value?.values ?? []).map((name, i) => {
    const vid = value?.value_ids?.[i];
    const byId = vid != null ? options.find((o) => o.value === String(vid)) : undefined;
    return byId ?? options.find((o) => o.label === name) ?? { value: `n:${name}`, label: name, created: true };
  });
  return (
    <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FormField label={prop.display_name} required={prop.is_required}>
          <Combobox
            multiple
            value={selected}
            options={options}
            creatable={options.length === 0}
            disabled={disabled}
            placeholder={selected.length ? undefined : t('field.choose')}
            onChange={(next) => onChange({
              ...(value ?? { property_id: prop.property_id, values: [] }),
              property_id: prop.property_id,
              values: next.map((o) => o.label),
              value_ids: next.map((o) => (o.created || o.value.startsWith('n:') ? NaN : Number(o.value))).filter((n) => Number.isFinite(n)),
            })}
          />
        </FormField>
      </Box>
      {prop.scales.length > 0 ? (
        <Box sx={{ width: 120, flexShrink: 0 }}>
          <FormField label={t('field.scale')}>
            <Select<string>
              value={value?.scale_id ? String(value.scale_id) : ''}
              disabled={disabled}
              onChange={(v) => onChange({ ...(value ?? { property_id: prop.property_id, values: [] }), property_id: prop.property_id, scale_id: v ? Number(v) : null })}
              placeholder={t('field.choose')}
              options={prop.scales.map((s) => ({ value: String(s.scale_id), label: s.display_name }))}
            />
          </FormField>
        </Box>
      ) : null}
    </Box>
  );
}

export function DetailsSection({ id = 'details', shopMeta }: DetailsSectionProps) {
  const t = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const api = useEtsySection();
  const errorFor = useFieldError(api);
  const ownMeta = useEtsyShopMeta(shopMeta ? null : api.shopId);
  const meta = shopMeta ?? ownMeta;
  const [newSectionOpen, setNewSectionOpen] = useState(false);

  const taxonomyId = api.fields.taxonomy_id;
  const realListingId = api.listingId && !api.listingId.startsWith('-') ? api.listingId : null;

  // ── Category details state ──────────────────────────────────────────────────────────────────────────────
  const [load, setLoad] = useState<PropsLoad>({ status: 'none', props: [] });
  const [nonce, setNonce] = useState(0);
  const [values, setValues] = useState<ListingPropertyMap>({});
  const [dropped, setDropped] = useState(0);
  /** Etsy's values (the baseline every diff is computed against); refreshed after Send / a remote refresh. */
  const original = useRef<ListingPropertyMap>({});
  /** JSON of the properties currently in the DB draft's taxonomyPatch ('[]' = none). */
  const stagedKey = useRef<string>('[]');
  /**
   * Every value seen this session, including ones a category change hid: changing the category back (or
   * Revert) restores them instead of showing them empty while Etsy still holds them.
   */
  const pool = useRef<ListingPropertyMap>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const apiRef = useRef(api);
  apiRef.current = api;
  const firstLoad = useRef(true);

  const isDetailsDirty = () => JSON.stringify(changedListingProperties(original.current, valuesRef.current)) !== stagedKey.current;

  /** Etsy values (+ staged overlay) after the first load or a refresh. */
  const adoptRemote = (remote: ListingPropertyMap) => {
    const patch = apiRef.current.draft?.taxonomyPatch;
    const staged = (patch as { properties?: unknown[] } | null | undefined)?.properties;
    const overlaid = overlayStagedProperties(remote, patch);
    original.current = remote;
    stagedKey.current = JSON.stringify(Array.isArray(staged) ? changedListingProperties(remote, overlaid) : []);
    pool.current = { ...overlaid };
    return overlaid;
  };

  useEffect(() => {
    if (taxonomyId === '' || !taxonomyId) {
      setLoad({ status: 'none', props: [] });
      return undefined;
    }
    let cancelled = false;
    setLoad((l) => ({ status: 'loading', props: l.props }));
    const shop = encodeURIComponent(api.shopId);
    const propsReq = fetch(`/api/clawd/etsy?action=get_taxonomy_properties&taxonomy_id=${taxonomyId}&shop_id=${shop}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    // Listing values are read on the first load (and again after Send / a remote refresh, below); a category
    // change re-derives the shown values from everything seen this session.
    const valuesReq = firstLoad.current && realListingId
      ? fetch(`/api/clawd/etsy?action=get_listing_properties&listing_id=${encodeURIComponent(realListingId)}&shop_id=${shop}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .catch(() => ({ results: [] }))
      : Promise.resolve(null);
    Promise.all([propsReq, valuesReq])
      .then(([pj, vj]) => {
        if (cancelled) return;
        const props = parseTaxonomyProperties(pj);
        if (firstLoad.current) {
          firstLoad.current = false;
          setValues(adoptRemote(vj ? parseListingProperties(vj) : {}));
          setDropped(0);
        } else {
          const { kept } = keepApplicableProperties({ ...pool.current, ...valuesRef.current }, props);
          setDropped(keepApplicableProperties(valuesRef.current, props).dropped);
          setValues(kept);
        }
        setLoad({ status: 'ready', props });
      })
      .catch(() => { if (!cancelled) setLoad({ status: 'error', props: [] }); });
    return () => { cancelled = true; };
  }, [taxonomyId, api.shopId, realListingId, nonce]);

  // After Send (or any remote refresh) Etsy holds new values: re-read them as the baseline so the "Changed"
  // marker clears and a later change back to the old value is still staged. Unsaved edits are kept.
  const lastRemote = useRef(api.remote);
  useEffect(() => {
    if (lastRemote.current === api.remote) return undefined;
    lastRemote.current = api.remote;
    if (firstLoad.current || !realListingId) return undefined;
    let cancelled = false;
    const shop = encodeURIComponent(api.shopId);
    fetch(`/api/clawd/etsy?action=get_listing_properties&listing_id=${encodeURIComponent(realListingId)}&shop_id=${shop}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((vj) => {
        if (cancelled) return;
        const remote = parseListingProperties(vj);
        if (isDetailsDirty()) {
          const keepEdits = { ...valuesRef.current };
          adoptRemote(remote);
          pool.current = { ...pool.current, ...keepEdits };
          setValues(keepEdits);
        } else {
          setValues(adoptRemote(remote));
        }
      })
      .catch(() => { /* keep the previous baseline; the next refresh retries */ });
    return () => { cancelled = true; };
  }, [api.remote, api.shopId, realListingId]);

  // Every change of the shown values goes to the engine: it schedules the 1.5s autosave, marks the page dirty
  // (leave-page guards) and recounts the changes. The engine stages only when `isDirty()` says so.
  const notifyRef = useRef(api.notifyChange);
  notifyRef.current = api.notifyChange;
  useEffect(() => {
    pool.current = { ...pool.current, ...values };
    notifyRef.current?.();
  }, [values]);

  const changed = useMemo(() => changedListingProperties(original.current, values), [values]);

  // Score input: required attributes filled (null → `na` while no taxonomy is loaded).
  const { reportFacts } = api;
  const attrKey = load.status === 'ready' ? JSON.stringify(requiredAttributeSummary(load.props, values)) : 'null';
  useEffect(() => {
    reportFacts({ attributes: attrKey === 'null' ? null : JSON.parse(attrKey) });
  }, [attrKey, reportFacts]);

  // Autosave registration (replaces the drawer's "Save category details" button).
  const stage = useCallback(async () => {
    const a = apiRef.current;
    const next = changedListingProperties(original.current, valuesRef.current);
    const key = JSON.stringify(next);
    if (key === stagedKey.current || !a.listingId) return;
    await stageEtsyDraft({
      shopId: a.shopId,
      listingId: a.listingId,
      taxonomy: next.length ? { properties: next } : (null as unknown as Record<string, unknown>),
    });
    stagedKey.current = key;
  }, []);
  const { register } = api;
  useEffect(() => register({
    id: 'details',
    key: 'details:categoryDetails',
    isDirty: () => JSON.stringify(changedListingProperties(original.current, valuesRef.current)) !== stagedKey.current,
    stage,
    changes: () => [{ group: 'categoryDetails' }],
    // Called by the engine's discard() after the DB draft was deleted: back to Etsy's values, nothing staged.
    reset: () => {
      stagedKey.current = '[]';
      pool.current = {};
      setDropped(0);
      setValues({ ...original.current });
    },
  }), [register, stage]);

  const setProp = (v: ListingPropertyValue) => setValues((prev) => ({ ...prev, [v.property_id]: v }));
  const required = load.props.filter((p) => p.is_required);
  const others = load.props.filter((p) => !p.is_required);
  const filled = load.props.filter((p) => (values[p.property_id]?.values.length ?? 0) > 0).length;
  const detailsDirty = api.mode === 'edit' && changed.length > 0;

  // ── Shop section options ────────────────────────────────────────────────────────────────────────────────
  const pending = pendingCreates(api.draft?.queuedActions);
  const sections = mergeById(meta.sections.items, pending.sections.map((s) => ({ ...s, title: t('field.pendingItem', { name: s.title }) })), 'shop_section_id');
  const sectionValue = api.fields.shop_section_id;
  const sectionKnown = sectionValue === '' || sections.some((s) => s.shop_section_id === sectionValue);

  const createSection = async (title: string) => {
    const tempId = newTempId();
    await api.stageActions([{ type: 'create_shop_section', tempId, payload: { title } }], { shop_section_id: tempId });
  };

  const whenMade = api.fields.when_made;
  const whenOptions = [
    ...WHEN_MADE_OPTIONS.map((o) => ({ value: o.value, label: tEtsy(`whenMade.${o.labelKey}`) })),
    ...(whenMade && !WHEN_MADE_OPTIONS.some((o) => o.value === whenMade)
      ? [{ value: whenMade, label: whenMadeLabelKey(whenMade) ? tEtsy(`whenMade.${whenMadeLabelKey(whenMade)}`) : whenMade }]
      : []),
  ];

  const ro = api.readOnly;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.details')} variant="plain" data-testid="le-section-details">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField
          label={t('field.category')}
          htmlFor={fieldDomId('taxonomy_id')}
          error={errorFor('taxonomy_id')}
          dirty={api.isDirty('taxonomy_id')}
          onRevert={() => api.revert('taxonomy_id')}
          helper={dropped > 0 ? (
            <Box component="span" sx={{ color: tone.attention.fg }}>{t('field.categoryDropped', { count: dropped })}</Box>
          ) : undefined}
          required
        >
          <CategoryCombobox
            id={fieldDomId('taxonomy_id')}
            shopId={api.shopId}
            value={taxonomyId}
            disabled={ro}
            onChange={(v) => api.setField('taxonomy_id', v)}
          />
        </FormField>

        {taxonomyId !== '' ? (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}
            data-dirty={detailsDirty ? 'true' : undefined}
            data-testid="le-category-details"
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <Box component="h3" sx={{ m: 0, fontSize: typeScale.titleSm[0], lineHeight: `${typeScale.titleSm[1]}px`, fontWeight: 600, color: neutral[900] }}>
                {t('field.categoryDetails')}
              </Box>
              {load.status === 'ready' && load.props.length > 0 ? (
                <Box component="span" sx={{ fontSize: 12, color: neutral[500], fontVariantNumeric: 'tabular-nums' }}>
                  {t('field.detailsFilled', { filled, total: load.props.length })}
                </Box>
              ) : null}
              {detailsDirty ? (
                <Box component="span" sx={{ fontSize: 12, color: tone.attention.fg }}>{t('field.changed')}</Box>
              ) : null}
            </Box>
            {load.status === 'loading' && load.props.length === 0 ? (
              <Box sx={{ fontSize: 13, color: neutral[500] }}>{t('field.detailsLoading')}</Box>
            ) : load.status === 'error' ? (
              <ErrorState variant="inline" title={t('field.detailsLoadFailed')} onRetry={() => setNonce((n) => n + 1)} />
            ) : load.props.length === 0 ? (
              <Box sx={{ fontSize: 13, color: neutral[500] }}>{t('field.detailsNone')}</Box>
            ) : (
              <>
                {required.length ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: '12px 16px' }}>
                    {required.map((p) => <PropertyField key={p.property_id} prop={p} value={values[p.property_id]} onChange={setProp} disabled={ro} />)}
                  </Box>
                ) : null}
                {others.length ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: '12px 16px' }}>
                    {others.map((p) => <PropertyField key={p.property_id} prop={p} value={values[p.property_id]} onChange={setProp} disabled={ro} />)}
                  </Box>
                ) : null}
              </>
            )}
          </Box>
        ) : null}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
          <FormField
            label={t('field.whoMade')}
            htmlFor={fieldDomId('who_made')}
            error={errorFor('who_made')}
            dirty={api.isDirty('who_made')}
            onRevert={() => api.revert('who_made')}
            required
          >
            <Select<string>
              id={fieldDomId('who_made')}
              value={api.fields.who_made || null}
              onChange={(v) => api.setField('who_made', v)}
              disabled={ro}
              placeholder={t('field.choose')}
              options={WHO_MADE_VALUES.map((v) => ({ value: v, label: tEtsy(`whoMade.${WHO_MADE_I18N[v]}`) }))}
            />
          </FormField>
          <FormField
            label={t('field.whenMade')}
            htmlFor={fieldDomId('when_made')}
            error={errorFor('when_made')}
            dirty={api.isDirty('when_made')}
            onRevert={() => api.revert('when_made')}
            required
          >
            <Select<string>
              id={fieldDomId('when_made')}
              value={whenMade || null}
              onChange={(v) => api.setField('when_made', v)}
              disabled={ro}
              placeholder={t('field.choose')}
              options={whenOptions}
            />
          </FormField>
        </Box>

        <FormField
          label={t('field.whatIsIt')}
          htmlFor={fieldDomId('is_supply')}
          error={errorFor('is_supply')}
          dirty={api.isDirty('is_supply')}
          onRevert={() => api.revert('is_supply')}
          required
        >
          <RadioGroup<'product' | 'supply'>
            value={api.fields.is_supply ? 'supply' : 'product'}
            onChange={(v) => { if (!ro) api.setField('is_supply', v === 'supply'); }}
            direction="row"
            options={[
              { value: 'product', label: t('field.finishedProduct'), disabled: ro },
              { value: 'supply', label: t('field.supplyOrTool'), disabled: ro },
            ]}
          />
        </FormField>

        <FormField
          label={t('field.section')}
          htmlFor={fieldDomId('shop_section_id')}
          optional
          width="medium"
          dirty={api.isDirty('shop_section_id')}
          onRevert={() => api.revert('shop_section_id')}
          error={meta.sections.status === 'error' ? t('field.profilesLoadFailed') : null}
          helper={api.fromDefaults?.has('shop_section_id') ? t('field.fromLastListing') : undefined}
          labelAction={ro ? undefined : meta.sections.status === 'error' ? (
            <Button variant="ghost" size="sm" onClick={meta.sections.retry}>{t('save.retry')}</Button>
          ) : (
            <Button variant="ghost" size="sm" icon={icons.add} onClick={() => setNewSectionOpen(true)}>{t('field.newSection')}</Button>
          )}
        >
          <Select<string>
            id={fieldDomId('shop_section_id')}
            value={sectionValue === '' ? '' : String(sectionValue)}
            onChange={(v) => api.setField('shop_section_id', v ? Number(v) : '')}
            disabled={ro || meta.sections.status === 'loading'}
            options={[
              { value: '', label: t('field.noSection') },
              ...sections.map((s) => ({ value: String(s.shop_section_id), label: s.title })),
              ...(!sectionKnown ? [{ value: String(sectionValue), label: t('field.currentItem', { id: sectionValue }) }] : []),
            ]}
          />
        </FormField>
      </Box>

      <NewSectionModal open={newSectionOpen} onClose={() => setNewSectionOpen(false)} onSubmit={createSection} />
    </Section>
  );
}

export default DetailsSection;
