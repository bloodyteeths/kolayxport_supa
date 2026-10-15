// components/domain/listing-editor/sections/TrendyolAttributesSection.tsx — M6b-D: Trendyol "Attributes"
// (marketplace-editors §3 row 3, §4.1). Required group first (from `metadata?action=category_attributes`), then
// the optional group behind "Optional (n) · Show". A listed value is a `Combobox` (creatable when the attribute
// allows custom values); an attribute with no listed values and `allowCustom` is a `TextField`.
// Stages only through `setField('attributes', encodeAttributes(list))`; AI proposals are `FieldSuggestion`-style
// cards the seller accepts one by one (never applied silently).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, Combobox, FormField, TextField, type ComboboxOption } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, tone } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { FieldIssue, ListingSectionProps } from '@/lib/listingEditor/types';
import type { TrendyolAttributeValue } from '@/lib/catalogDrafts/schemas';
import { useRegisterDraftSection } from '../useListingDraft';
import type { FieldAiState } from './sectionTypes';
import {
  MobileEditSheet, NormalizedTextField, decodeAttributes, encodeAttributes, rawRecord, toNum, toStr, useCatalogSection,
  useRemoteList,
} from './marketplaceSectionShared';

/** Content keys that go through Trendyol's product update (attributes are re-checked there); price / stock don't. */
const CONTENT_KEYS = ['title', 'description', 'images', 'attributes'] as const;

export interface TrendyolCategoryAttribute {
  id: number;
  name: string;
  required: boolean;
  allowCustom: boolean;
  /** Variant-defining attribute (color / size): shown, but Trendyol groups siblings by it. */
  varianter: boolean;
  values: Array<{ id: number; name: string }>;
}

/** `GET /api/trendyol/metadata?action=category_attributes` → attributes, required first (pure, for tests). */
export function parseCategoryAttributes(data: unknown): TrendyolCategoryAttribute[] {
  const list = (data as { categoryAttributes?: unknown[] } | null)?.categoryAttributes;
  if (!Array.isArray(list)) return [];
  const out: TrendyolCategoryAttribute[] = [];
  for (const raw of list) {
    const r = rawRecord(raw);
    const attr = rawRecord(r.attribute);
    const id = toNum(attr.id);
    if (!id || out.some((a) => a.id === id)) continue;
    const values: Array<{ id: number; name: string }> = [];
    for (const v of Array.isArray(r.attributeValues) ? r.attributeValues : []) {
      const vr = rawRecord(v);
      const vid = toNum(vr.id);
      const name = toStr(vr.name).trim();
      if (vid && name) values.push({ id: vid, name });
    }
    out.push({
      id,
      name: toStr(attr.name).trim() || `#${id}`,
      required: r.required === true,
      allowCustom: r.allowCustom === true,
      varianter: r.varianter === true,
      values,
    });
  }
  return out.sort((a, b) => Number(b.required) - Number(a.required));
}

/** Required attributes without a value (pure). */
export function missingRequired(defs: TrendyolCategoryAttribute[], values: TrendyolAttributeValue[]): TrendyolCategoryAttribute[] {
  const filled = new Set(values.filter((v) => v.attributeValueId || (v.customAttributeValue ?? '').trim()).map((v) => v.attributeId));
  return defs.filter((d) => d.required && !filled.has(d.id));
}

/** Set (or clear with `null`) one attribute's value in the list (pure). */
export function setAttributeValue(
  list: TrendyolAttributeValue[],
  attributeId: number,
  value: { attributeValueId: number } | { customAttributeValue: string } | null,
): TrendyolAttributeValue[] {
  const rest = list.filter((a) => a.attributeId !== attributeId);
  if (!value) return rest;
  if ('attributeValueId' in value) return [...rest, { attributeId, attributeValueId: value.attributeValueId }];
  const custom = value.customAttributeValue.trim();
  return custom ? [...rest, { attributeId, customAttributeValue: custom }] : rest;
}

/** The proposal is already the staged value (accepted, or the product already had it). Pure. */
export function proposalApplied(values: TrendyolAttributeValue[], p: TrendyolAttributeValue): boolean {
  const v = values.find((x) => x.attributeId === p.attributeId);
  if (!v) return false;
  if (p.attributeValueId) return v.attributeValueId === p.attributeValueId;
  return !v.attributeValueId && (v.customAttributeValue ?? '').trim() === (p.customAttributeValue ?? '').trim();
}

/**
 * Severity of "required attributes missing": blocks Send on create, and on edit only when the draft changes
 * content (Trendyol re-validates attributes on a product update). A price / stock-only edit goes through
 * price-and-inventory, which doesn't touch attributes, so there it is a warning. Pure.
 */
export function requiredMissingSeverity(mode: 'create' | 'edit', contentDirty: boolean): 'block_sync' | 'warn' {
  return mode === 'create' || contentDirty ? 'block_sync' : 'warn';
}

/** Display label of a staged value: the listed value name, the custom text, or the cache's name. */
function valueLabel(def: TrendyolCategoryAttribute, v: TrendyolAttributeValue | undefined, cacheNames: Map<number, string>): string {
  if (!v) return '';
  if (v.attributeValueId) return def.values.find((x) => x.id === v.attributeValueId)?.name ?? cacheNames.get(def.id) ?? `#${v.attributeValueId}`;
  return v.customAttributeValue ?? '';
}

/** Names the cache row holds for the current values (`attributes[].attributeValue`), by attribute id. */
function cacheValueNames(raw: Record<string, unknown>): Map<number, string> {
  const m = new Map<number, string>();
  for (const a of Array.isArray(raw.attributes) ? raw.attributes : []) {
    const r = rawRecord(a);
    const id = toNum(r.attributeId);
    const name = toStr(r.attributeValue).trim();
    if (id && name) m.set(id, name);
  }
  return m;
}

export interface TrendyolAttributesSectionProps extends Partial<ListingSectionProps> {
  /** `suggest_attributes` (M6b-E `useListingAI`): proposals the seller accepts one by one. */
  aiAttributes?: FieldAiState<TrendyolAttributeValue[]>;
}

export function TrendyolAttributesSection({ id = 'attributes', aiAttributes }: TrendyolAttributesSectionProps) {
  const t = useTranslations('listingEditor');
  const { ed, f, raw, ro, mode, errorFor, dirty, set, revert } = useCatalogSection();
  const [showOptional, setShowOptional] = React.useState(false);
  const categoryId = toNum(f.categoryId) ?? toNum(raw.categoryId);
  const defsList = useRemoteList<TrendyolCategoryAttribute>(
    categoryId ? `/api/trendyol/metadata?action=category_attributes&categoryId=${encodeURIComponent(String(categoryId))}` : null,
    parseCategoryAttributes,
  );
  const defs = defsList.items;
  const values = React.useMemo(() => decodeAttributes(f.attributes), [f.attributes]);
  const cacheNames = React.useMemo(() => cacheValueNames(raw), [raw]);
  const missing = missingRequired(defs, values);
  const required = defs.filter((d) => d.required);
  const optional = defs.filter((d) => !d.required);
  const ready = defsList.status === 'ready';

  // Score input (lib/listingScore/trendyol `required_attributes`): unknown until the category's list loaded.
  const { reportFacts } = ed;
  const requiredCount = required.length;
  const filledCount = requiredCount - missing.length;
  React.useEffect(() => {
    reportFacts({ attributes: ready ? { required: requiredCount, filled: filledCount } : undefined });
  }, [reportFacts, ready, requiredCount, filledCount]);

  const missingCount = missing.length;
  const { isFieldDirty } = ed;
  const contentDirty = mode === 'edit' && CONTENT_KEYS.some((k) => isFieldDirty(k));
  const missingSeverity = requiredMissingSeverity(mode, contentDirty);
  useRegisterDraftSection({
    id: 'attributes',
    key: 'attributes:required',
    isDirty: () => false,
    stage: async () => undefined,
    validate: (): FieldIssue[] =>
      ready && missingCount > 0
        ? [{ field: 'attributes', section: 'attributes', severity: missingSeverity, key: 'listingEditor.trendyol.requiredMissing', params: { count: missingCount } }]
        : [],
  });

  const write = (next: TrendyolAttributeValue[]) => set('attributes', encodeAttributes(next));

  const renderField = (def: TrendyolCategoryAttribute) => {
    const current = values.find((v) => v.attributeId === def.id);
    const label = valueLabel(def, current, cacheNames);
    const isMissing = ready && def.required && !label;
    const anchor = fieldAnchorId(`attributes.${def.id}`);
    let input: React.ReactNode;
    if (def.values.length > 0) {
      const options: ComboboxOption[] = def.values.map((v) => ({ value: String(v.id), label: v.name }));
      const value: ComboboxOption | null = current
        ? current.attributeValueId
          ? { value: String(current.attributeValueId), label }
          : { value: `custom:${label}`, label, created: true }
        : null;
      input = (
        <Combobox
          id={anchor}
          value={value}
          options={options}
          creatable={def.allowCustom}
          invalid={isMissing}
          disabled={ro}
          placeholder={t('field.choose')}
          onChange={(o) => {
            if (!o) return write(setAttributeValue(values, def.id, null));
            const listed = def.values.find((v) => String(v.id) === o.value);
            write(setAttributeValue(values, def.id, listed && !o.created ? { attributeValueId: listed.id } : { customAttributeValue: o.label }));
          }}
        />
      );
    } else if (def.allowCustom) {
      input = (
        <NormalizedTextField
          id={anchor}
          value={label}
          invalid={isMissing}
          readOnly={ro}
          onChange={(v) => write(setAttributeValue(values, def.id, { customAttributeValue: v }))}
        />
      );
    } else {
      input = <TextField id={anchor} value={label} readOnly onChange={() => undefined} />;
    }
    return (
      <FormField key={def.id} label={def.name} htmlFor={anchor} required={def.required} optional={!def.required} error={isMissing ? t('trendyol.attributeRequired') : null}>
        {input}
      </FormField>
    );
  };

  // Proposals still to decide: an accepted one (now the staged value) leaves the card; the last one closes it.
  const proposals = (aiAttributes?.value ?? []).filter((p) => !proposalApplied(values, p));
  const acceptProposal = (p: TrendyolAttributeValue) => {
    write(setAttributeValue(values, p.attributeId, p.attributeValueId ? { attributeValueId: p.attributeValueId } : { customAttributeValue: p.customAttributeValue ?? '' }));
    if (proposals.length <= 1) aiAttributes?.dismiss();
  };
  const proposalLabel = (p: TrendyolAttributeValue) => {
    const def = defs.find((d) => d.id === p.attributeId);
    const value = p.attributeValueId ? def?.values.find((v) => v.id === p.attributeValueId)?.name : p.customAttributeValue;
    return { name: def?.name ?? `#${p.attributeId}`, value: value ?? '' };
  };

  const aiButton =
    aiAttributes && !ro && defs.length > 0 ? (
      <Button variant="ghost" size="sm" icon={icons.ai} onClick={aiAttributes.run} loading={aiAttributes.loading} loadingLabel={t('ai.writing')}>
        {t('trendyol.suggestAttributes')}
      </Button>
    ) : null;

  const body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
      {!categoryId ? (
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('trendyol.chooseCategoryFirst')}</Box>
      ) : defsList.status === 'loading' ? (
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('field.detailsLoading')}</Box>
      ) : defsList.status === 'error' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', color: neutral[700], fontSize: 14 }}>
          {t('field.detailsLoadFailed')}
          <Button variant="ghost" size="sm" onClick={defsList.retry}>{t('save.retry')}</Button>
        </Box>
      ) : defs.length === 0 ? (
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('field.detailsNone')}</Box>
      ) : (
        <>
          {proposals.length > 0 ? (
            <Box
              data-testid="le-trendyol-attr-suggestions"
              sx={{ border: `1px solid ${tone.info.border}`, bgcolor: tone.info.bg, borderRadius: '8px', p: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              {aiAttributes?.basis ? <Box sx={{ color: neutral[600], fontSize: 13 }}>{aiAttributes.basis}</Box> : null}
              {proposals.map((p) => {
                const l = proposalLabel(p);
                return (
                  <Box key={p.attributeId} sx={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 14 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box component="span" sx={{ color: neutral[600] }}>{l.name}</Box> · {l.value}
                    </Box>
                    <Button variant="ghost" size="sm" onClick={() => acceptProposal(p)}>{t('common.use')}</Button>
                  </Box>
                );
              })}
              <Box sx={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    let next = values;
                    for (const p of proposals) {
                      next = setAttributeValue(next, p.attributeId, p.attributeValueId ? { attributeValueId: p.attributeValueId } : { customAttributeValue: p.customAttributeValue ?? '' });
                    }
                    write(next);
                    aiAttributes?.dismiss();
                  }}
                >
                  {t('ai.useAllCount', { count: proposals.length })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => aiAttributes?.dismiss()}>{t('common.dismiss')}</Button>
              </Box>
            </Box>
          ) : aiAttributes?.error ? (
            <Box sx={{ color: tone.danger.fg, fontSize: 13 }}>{typeof aiAttributes.error === 'string' ? aiAttributes.error : t('ai.garbled')}</Box>
          ) : null}

          {required.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Box component="h3" sx={{ m: 0, fontSize: 14, fontWeight: 600, color: neutral[800] }}>{t('trendyol.requiredGroup')}</Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: '12px' }}>{required.map(renderField)}</Box>
            </Box>
          ) : null}

          {optional.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Box>
                <Button variant="ghost" size="sm" onClick={() => setShowOptional((s) => !s)} data-testid="le-trendyol-optional-toggle">
                  {showOptional ? t('trendyol.optionalHide', { count: optional.length }) : t('trendyol.optionalCount', { count: optional.length })}
                </Button>
              </Box>
              {showOptional ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: '12px' }}>{optional.map(renderField)}</Box>
              ) : null}
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );

  const summary = ready && missingCount > 0
    ? t('trendyol.requiredMissing', { count: missingCount })
    : t('field.detailsFilled', { filled: filledCount, total: requiredCount });

  return (
    <Section
      id={sectionAnchorId(id)}
      title={t('section.attributes')}
      variant="plain"
      data-testid="le-section-attributes"
      description={ready && missingCount > 0 ? (
        <Box component="span" sx={{ color: tone.danger.fg }}>{t('trendyol.requiredMissing', { count: missingCount })}</Box>
      ) : undefined}
      headerSlot={aiButton}
    >
      <Box id={fieldAnchorId('attributes')}>
        {errorFor('attributes') ? <Box sx={{ mb: '8px' }}><Box sx={{ color: tone.danger.fg, fontSize: 13 }}>{errorFor('attributes')}</Box></Box> : null}
        {dirty('attributes') && !ro ? (
          <Box sx={{ mb: '8px' }}>
            <Button variant="ghost" size="sm" icon={icons.revert} onClick={() => revert('attributes')}>{t('common.revertAll')}</Button>
          </Box>
        ) : null}
        <MobileEditSheet title={t('section.attributes')} summary={summary} keys={['attributes']} disabled={ro} data-testid="le-trendyol-attr-sheet">
          {body}
        </MobileEditSheet>
      </Box>
    </Section>
  );
}
