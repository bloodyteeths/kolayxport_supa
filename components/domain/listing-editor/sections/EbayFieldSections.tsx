// components/domain/listing-editor/sections/EbayFieldSections.tsx — eBay "Title & description", "Price & inventory"
// and "Details" (listing-editor §2.1 rows 2, 4, 6 for eBay). Group B's sections are Etsy-specific (140-char title,
// commas-only helper, Etsy taxonomy), so the eBay route renders these instead; they read the engine through
// `useListingEditor()` and only call `setField` (adapters/ebay.ts stages; nothing reaches eBay until Send).
// Text is shown entity-decoded (adapter), so every edit stages decoded text (P5).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import {
  Button, Combobox, CurrencySelect, FieldSuggestion, FormField, MoneyField, NumberField, TextArea, TextField,
  type ComboboxOption,
} from '@/components/ds/inputs';
import { useToast } from '@/components/ds/feedback/toast';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { TITLE_MAX as EBAY_TITLE_MAX } from '@/lib/ebay/payloadRules';
import { SELLER_SKU_MAX } from '@/lib/ebay/draftPlan';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { FieldMap, ListingSectionProps, ListingView } from '@/lib/listingEditor/types';
import ConditionSelector from '@/components/ebay/ConditionSelector';
import type { PreviewModel } from '@/components/domain/MarketplacePreview';
import { computeListingHealth, type ListingHealth } from '../RailHealth';
import type { SectionComponents } from '../ListingEditor';
import { PhotosSection } from './PhotosSection';
import { VariationsSection } from './VariationsSection';
import { SpecificsSection, type SpecificsAi } from './SpecificsSection';
import { useListingAI, type UseListingAI } from '../useListingAI';
import { EbayPoliciesSection } from './EbayPoliciesSection';
import { useListingEditor } from '../useListingDraft';
import { useFieldError } from './useEtsySection';
import { wordCount } from './etsyShared';
import type { FieldAiState } from './sectionTypes';
import { DESCRIPTION_MAX_ROWS, DESCRIPTION_MIN_ROWS, TitleInput } from './TitleInput';
import {
  EBAY_CURRENCIES, EBAY_SUBTITLE_MAX, decodeAspects, ebayCreateStarted, encodeAspects, toPriceString, ebayScoreInput, normalizeEbayFields, type EbayEditorFields, type EbayFieldKey,
} from '../adapters/ebay';

/** eBay descriptions are HTML; long ones are fine (eBay's cap is 500k characters). */
const EBAY_DESCRIPTION_MAX = 500_000;
const STORE_CATEGORY_MAX = 2;

function useEbayFields() {
  const ed = useListingEditor<EbayEditorFields>();
  const errorFor = useFieldError({ issues: ed.issues });
  const dirty = (key: EbayFieldKey) => ed.mode === 'edit' && ed.isFieldDirty(key);
  const set = <K extends EbayFieldKey>(key: K, value: EbayEditorFields[K]) => ed.setField(key, value);
  // Listing created on eBay: subtitle and currency are not editable through the Trading API path.
  const legacy = Boolean((ed.view.meta.raw as { isLegacy?: boolean } | undefined)?.isLegacy);
  return { ed, f: ed.view.fields, ro: ed.readOnly, legacy, errorFor, dirty, set };
}

/**
 * The eBay AI hook bound to the engine. The frame's own `useListingAI` instance is Etsy-wired (no aspects /
 * category in its input, no eBay writers), so the eBay sections run their own when the frame passes nothing.
 * Writers convert to the adapter's shapes: specifics → encoded `aspects`, price → decimal string.
 */
export function useEbayAI(): UseListingAI {
  const ed = useListingEditor<EbayEditorFields>();
  const f = normalizeEbayFields(ed.view.fields);
  const price = parseFloat(f.price);
  const setField = ed.setField;
  return useListingAI({
    marketplace: 'ebay',
    input: {
      title: f.title,
      description: f.description,
      price: Number.isFinite(price) ? price : null,
      currency: f.currency || null,
      condition: f.condition || null,
      categoryId: f.categoryId || null,
      aspects: decodeAspects(f.aspects),
    },
    getField: (key) => (ed.view.fields as Record<string, unknown>)[key],
    setField: (key, value) => setField(key as EbayFieldKey, value as EbayEditorFields[EbayFieldKey]),
    fieldKeys: { category: 'categoryId', specifics: 'aspects' },
    appliers: {
      specifics: (v) => setField('aspects', typeof v === 'string' ? v : encodeAspects((v ?? {}) as Record<string, unknown>)),
      price: (v) => setField('price', typeof v === 'number' && Number.isFinite(v) ? toPriceString(v) : typeof v === 'string' ? v : ''),
    },
  });
}

/** `useListingAI` → SpecificsSection's `ai` hand-off. */
export function specificsAiFrom(ai: UseListingAI): SpecificsAi {
  const p = ai.get<Record<string, string[]>>('specifics');
  return {
    run: (names) => void ai.fillSpecifics(names),
    loading: p.status === 'loading',
    proposals: p.status === 'ready' && p.value ? p.value : null,
    error: p.status === 'error' ? p.error ?? true : undefined,
    basis: p.basis,
    dismiss: () => ai.dismiss('specifics'),
    accept: (name) => ai.acceptAspect(name),
    skip: (name) => ai.skipAspect(name),
    acceptAll: () => ai.apply('specifics'),
    disabled: ai.buttonState('specifics').disabled,
    disabledReason: ai.buttonState('specifics').disabledReason,
  };
}

/** SpecificsSection with the eBay AI hand-off (unless the frame passes one). */
export function EbaySpecificsSection(props: Partial<ListingSectionProps> & { ai?: SpecificsAi | null }) {
  const ai = useEbayAI();
  return <SpecificsSection {...props} ai={props.ai !== undefined ? props.ai : specificsAiFrom(ai)} />;
}

/** Strips tags for the word count (the description is HTML). Pure (exported for tests). */
export function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Title & description
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EbayTitleSectionProps extends Partial<ListingSectionProps> {
  aiTitle?: FieldAiState<string>;
  aiDescription?: FieldAiState<string>;
}

export function EbayTitleSection({ id = 'title', aiTitle: aiTitleProp, aiDescription: aiDescriptionProp }: EbayTitleSectionProps) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const { f, ro, legacy, errorFor, dirty, set, ed } = useEbayFields();
  const ownAi = useEbayAI();
  const aiTitle = aiTitleProp ?? ownAi.fieldState<string>('title');
  const aiDescription = aiDescriptionProp ?? ownAi.fieldState<string>('description');
  const words = wordCount(htmlToText(f.description));

  const use = (key: 'title' | 'description', value: string, done: () => void) => {
    const previous = f[key];
    set(key, key === 'title' ? value.slice(0, EBAY_TITLE_MAX) : value);
    done();
    toast.success(t('ai.replaced', { field: t(key === 'title' ? 'field.title' : 'field.description') }), {
      undo: () => set(key, previous),
      undoLabel: t('banner.undo'),
    });
  };
  const aiButton = (state: FieldAiState<string> | undefined, label: string) =>
    state && !ro ? (
      <Button variant="ghost" size="sm" icon={icons.ai} onClick={state.run} loading={state.loading} loadingLabel={t('ai.writing')}>
        {label}
      </Button>
    ) : null;
  const suggestion = (state: FieldAiState<string> | undefined, key: 'title' | 'description') =>
    state && (state.loading || state.value != null || state.error) ? (
      <FieldSuggestion
        value={state.value ?? ''}
        counter={key === 'title' && state.value ? { value: state.value.length, max: EBAY_TITLE_MAX } : undefined}
        basis={state.basis}
        rationale={state.rationale}
        loading={state.loading}
        error={state.error}
        credits={state.credits}
        onUse={() => state.value && use(key, state.value, state.dismiss)}
        onDismiss={state.dismiss}
        onRetry={state.run}
        data-testid={`le-ebay-${key}-suggestion`}
      />
    ) : null;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.title')} variant="plain" data-testid="le-section-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.title')}
            htmlFor={fieldAnchorId('title')}
            counter={{ value: f.title.length, max: EBAY_TITLE_MAX }}
            error={errorFor('title')}
            dirty={dirty('title')}
            onRevert={() => ed.revert(['title'])}
            labelAction={aiButton(aiTitle, t('ai.suggestTitle'))}
            required
          >
            <TitleInput
              id={fieldAnchorId('title')}
              value={f.title}
              onChange={(v) => set('title', v)}
              readOnly={ro}
              data-testid="le-ebay-title-input"
            />
          </FormField>
          {suggestion(aiTitle, 'title')}
        </Box>

        <FormField
          label={t('field.subtitle')}
          htmlFor={fieldAnchorId('subtitle')}
          counter={{ value: f.subtitle.length, max: EBAY_SUBTITLE_MAX }}
          helper={t('field.subtitleHelperEbay')}
          error={errorFor('subtitle')}
          dirty={dirty('subtitle')}
          onRevert={() => ed.revert(['subtitle'])}
          optional
        >
          <TextField id={fieldAnchorId('subtitle')} value={f.subtitle} onChange={(v) => set('subtitle', v.replace(/[\r\n]+/g, ' '))} readOnly={ro || legacy} />
        </FormField>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <FormField
            label={t('field.description')}
            htmlFor={fieldAnchorId('description')}
            helper={<Box component="span" sx={{ color: neutral[500], fontVariantNumeric: 'tabular-nums' }}>{t('field.descriptionWords', { count: words })}</Box>}
            error={errorFor('description')}
            dirty={dirty('description')}
            onRevert={() => ed.revert(['description'])}
            labelAction={aiButton(aiDescription, t('ai.writeDescription'))}
            required
          >
            {/* eBay renders the HTML itself; the live preview in the rail shows it sandboxed (MarketplacePreview). */}
            <TextArea
              id={fieldAnchorId('description')}
              value={f.description}
              onChange={(v) => set('description', v)}
              minRows={DESCRIPTION_MIN_ROWS}
              maxRows={DESCRIPTION_MAX_ROWS}
              maxLength={EBAY_DESCRIPTION_MAX}
              readOnly={ro}
              data-testid="le-ebay-description-input"
            />
          </FormField>
          {suggestion(aiDescription, 'description')}
        </Box>
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Price & inventory
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EbayPriceSectionProps extends Partial<ListingSectionProps> {
  /** Variation price range when variations set the prices (read-only summary instead of the fields). */
  priceRange?: { min: number; max: number } | null;
}

export function EbayPriceSection({ id = 'price', priceRange }: EbayPriceSectionProps) {
  const t = useTranslations('listingEditor');
  const { f, ro, legacy, errorFor, dirty, set, ed } = useEbayFields();
  const fmt = useFormatters();
  const price = parseFloat(f.price);
  const range = priceRange ?? ed.view.facts.variations?.priceRange ?? null;
  const skuLocked = ed.mode === 'create' && ebayCreateStarted(ed.draft);
  // A new listing with variations: each variation has its own price; this one is their default.
  const hasCreateVariations = ed.mode === 'create' && Boolean(f.createVariations);

  return (
    <Section id={sectionAnchorId(id)} title={t('section.price')} variant="plain" data-testid="le-section-price">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        {range ? (
          <Box sx={{ color: neutral[600], fontSize: 14 }}>
            {t('field.priceFromVariations', { min: fmt.money(range.min, f.currency || 'USD'), max: fmt.money(range.max, f.currency || 'USD') })}
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '200px 140px 140px' }, gap: '12px', alignItems: 'end' }}>
            <FormField
              label={t('field.price')}
              htmlFor={fieldAnchorId('price')}
              required={!hasCreateVariations}
              helper={hasCreateVariations ? t('field.priceDefaultForVariations') : undefined}
              error={errorFor('price')}
              dirty={dirty('price')}
              onRevert={() => ed.revert(['price'])}
            >
              <MoneyField
                id={fieldAnchorId('price')}
                currency={f.currency || 'USD'}
                value={Number.isFinite(price) ? price : null}
                onChange={(n) => set('price', typeof n === 'number' && Number.isFinite(n) ? toPriceString(n) : '')}
                readOnly={ro}
              />
            </FormField>
            <FormField label={t('field.currency')} htmlFor={fieldAnchorId('currency')} error={errorFor('currency')} dirty={dirty('currency')} onRevert={() => ed.revert(['currency'])}>
              <CurrencySelect
                id={fieldAnchorId('currency')}
                value={f.currency || 'USD'}
                onChange={(c) => c && set('currency', c)}
                currencies={[...EBAY_CURRENCIES]}
                disabled={ro || legacy}
              />
            </FormField>
            <FormField label={t('field.quantity')} htmlFor={fieldAnchorId('quantity')} required error={errorFor('quantity')} dirty={dirty('quantity')} onRevert={() => ed.revert(['quantity'])}>
              <NumberField
                id={fieldAnchorId('quantity')}
                value={Number.isFinite(f.quantity) ? f.quantity : null}
                onChange={(n) => set('quantity', typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)}
                min={0}
                decimals={0}
                readOnly={ro}
              />
            </FormField>
          </Box>
        )}
        {ed.mode === 'create' ? (
          // The seller's own SKU (stock / warehouse matching); blank = the generated one. Locked once a send
          // created the item on eBay (the server keeps using that SKU).
          <FormField
            label={t('field.sku')}
            optional
            htmlFor={fieldAnchorId('sku')}
            error={errorFor('sku')}
            helper={skuLocked ? t('field.skuLockedEbay') : t('field.skuHelperEbayOwn', { sku: ed.ctx.listingId ?? '' })}
          >
            <TextField
              id={fieldAnchorId('sku')}
              value={skuLocked ? (f.sku || ed.ctx.listingId || '') : f.sku}
              placeholder={ed.ctx.listingId ?? undefined}
              onChange={(v) => set('sku', v.replace(/\s+/g, ''))}
              readOnly={ro || skuLocked}
              maxLength={SELLER_SKU_MAX}
              mono
            />
          </FormField>
        ) : ed.ctx.listingId ? (
          <FormField label={t('field.sku')} htmlFor={fieldAnchorId('sku')}>
            <TextField id={fieldAnchorId('sku')} value={ed.ctx.listingId} onChange={() => undefined} readOnly mono />
          </FormField>
        ) : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Details: category, condition, store categories
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `category_suggestions` response → options (pure, exported for tests). */
export function parseCategorySuggestions(data: unknown): ComboboxOption[] {
  const list = (data as { categorySuggestions?: unknown[] } | null)?.categorySuggestions;
  if (!Array.isArray(list)) return [];
  const out: ComboboxOption[] = [];
  for (const c of list) {
    const r = (c ?? {}) as { category?: { categoryId?: string; categoryName?: string }; categoryTreeNodeAncestors?: Array<{ categoryName?: string }> };
    const id = r.category?.categoryId;
    const name = r.category?.categoryName;
    if (!id || !name) continue;
    const path = (r.categoryTreeNodeAncestors ?? []).map((a) => a?.categoryName).filter(Boolean).reverse().join(' › ');
    out.push(path ? { value: String(id), label: name, description: path } : { value: String(id), label: name });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function EbayDetailsSection({ id = 'details' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, ed } = useEbayFields();
  const [categoryLabel, setCategoryLabel] = React.useState<Record<string, string>>({});
  const [conditions, setConditions] = React.useState<Array<{ conditionId: string; conditionDescription?: string }>>([]);
  const [storeCats, setStoreCats] = React.useState<{ status: 'loading' | 'ready' | 'error'; items: string[] }>({ status: 'loading', items: [] });
  const [storeNonce, setStoreNonce] = React.useState(0);

  // Conditions eBay allows for the category (an empty list = no restriction).
  React.useEffect(() => {
    if (!f.categoryId) {
      setConditions([]);
      return undefined;
    }
    let cancelled = false;
    fetchJson(`/api/clawd/ebay?action=item_conditions&category_id=${encodeURIComponent(f.categoryId)}`)
      .then((d) => {
        const list = (d as { itemConditions?: Array<{ conditionId: string; conditionDescription?: string }> })?.itemConditions;
        if (!cancelled) setConditions(Array.isArray(list) ? list : []);
      })
      .catch(() => { if (!cancelled) setConditions([]); });
    return () => { cancelled = true; };
  }, [f.categoryId]);

  React.useEffect(() => {
    let cancelled = false;
    setStoreCats((s) => ({ ...s, status: 'loading' }));
    fetchJson('/api/clawd/ebay?action=store_categories')
      .then((d) => {
        const list = (d as { categories?: unknown[] })?.categories;
        if (!cancelled) setStoreCats({ status: 'ready', items: Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [] });
      })
      .catch(() => { if (!cancelled) setStoreCats({ status: 'error', items: [] }); });
    return () => { cancelled = true; };
  }, [storeNonce]);

  const loadCategories = React.useCallback(async (query: string) => {
    const opts = parseCategorySuggestions(await fetchJson(`/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent(query)}`));
    setCategoryLabel((m) => ({ ...m, ...Object.fromEntries(opts.map((o) => [o.value, o.label])) }));
    return opts;
  }, []);

  const categoryValue: ComboboxOption | null = f.categoryId
    ? { value: f.categoryId, label: categoryLabel[f.categoryId] ?? t('field.categoryId', { id: f.categoryId }) }
    : null;
  const storeOptions: ComboboxOption[] = Array.from(new Set([...storeCats.items, ...f.storeCategoryNames])).map((n) => ({ value: n, label: n }));

  return (
    <Section id={sectionAnchorId(id)} title={t('section.details')} variant="plain" data-testid="le-section-details">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField
          label={t('field.category')}
          htmlFor={fieldAnchorId('categoryId')}
          helper={t('field.categoryHelperEbay')}
          error={errorFor('categoryId')}
          dirty={dirty('categoryId')}
          onRevert={() => ed.revert(['categoryId'])}
          required
        >
          <Combobox
            id={fieldAnchorId('categoryId')}
            value={categoryValue}
            onChange={(o) => set('categoryId', o?.value ?? '')}
            loadOptions={loadCategories}
            minQueryLength={2}
            placeholder={t('field.categorySearch')}
            disabled={ro}
          />
        </FormField>

        <Box id={fieldAnchorId('condition')}>
          <ConditionSelector
            embedded
            condition={f.condition}
            conditionDescription={f.conditionDescription}
            categoryConditions={conditions}
            onChange={(condition, description) => {
              if (condition !== f.condition) set('condition', condition);
              if (description !== f.conditionDescription) set('conditionDescription', description);
            }}
            dirty={{ condition: dirty('condition'), description: dirty('conditionDescription') }}
            onRevert={{ condition: () => ed.revert(['condition']), description: () => ed.revert(['conditionDescription']) }}
            error={{ condition: errorFor('condition'), description: errorFor('conditionDescription') }}
            disabled={ro}
          />
        </Box>

        <FormField
          label={t('field.storeCategories')}
          htmlFor={fieldAnchorId('storeCategoryNames')}
          helper={storeCats.status === 'error' ? t('field.profilesLoadFailed') : t('field.storeCategoriesHelper', { max: STORE_CATEGORY_MAX })}
          dirty={dirty('storeCategoryNames')}
          onRevert={() => ed.revert(['storeCategoryNames'])}
          labelAction={storeCats.status === 'error' && !ro ? (
            <Button variant="ghost" size="sm" onClick={() => setStoreNonce((n) => n + 1)}>{t('save.retry')}</Button>
          ) : undefined}
          optional
        >
          <Combobox
            id={fieldAnchorId('storeCategoryNames')}
            multiple
            creatable
            value={f.storeCategoryNames.map((n) => ({ value: n, label: n }))}
            onChange={(list) => set('storeCategoryNames', list.map((o) => o.value.trim()).filter(Boolean).slice(0, STORE_CATEGORY_MAX))}
            options={storeOptions}
            disabled={ro || storeCats.status === 'loading'}
          />
        </FormField>
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Frame wiring for the eBay routes (sections, health, preview) — `ListingEditor` props `sections`, `health`,
// `preview`. The frame's defaults are Etsy's.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ConditionEnum → the English text eBay shows on the item (marketplace content, not UI chrome). */
const CONDITION_TEXT: Record<string, string> = {
  NEW: 'New',
  NEW_OTHER: 'New (other)',
  NEW_WITH_DEFECTS: 'New with defects',
  CERTIFIED_REFURBISHED: 'Certified refurbished',
  EXCELLENT_REFURBISHED: 'Excellent refurbished',
  VERY_GOOD_REFURBISHED: 'Very good refurbished',
  GOOD_REFURBISHED: 'Good refurbished',
  SELLER_REFURBISHED: 'Seller refurbished',
  LIKE_NEW: 'Like new',
  USED_EXCELLENT: 'Used',
  USED_VERY_GOOD: 'Used, very good',
  USED_GOOD: 'Used, good',
  USED_ACCEPTABLE: 'Used, acceptable',
  FOR_PARTS_OR_NOT_WORKING: 'For parts or not working',
};

/** Draft view → eBay preview (search row + item page). Pure (exported for tests). */
export function ebayPreviewModel(view: ListingView<FieldMap>, _shopName: string | null): PreviewModel {
  const f = normalizeEbayFields(view.fields as EbayEditorFields);
  const price = parseFloat(f.price);
  const staged = view.facts.images;
  const images = staged
    ? staged.filter((i) => i.staged !== 'delete').map((i) => ({ url: i.src || null, alt: i.alt }))
    : f.images.map((url) => ({ url, alt: null }));
  return {
    title: f.title,
    subtitle: f.subtitle || null,
    description: f.description,
    price: Number.isFinite(price) ? price : null,
    priceRange: view.facts.variations?.priceRange ?? null,
    currency: f.currency || view.meta.currency,
    images,
    condition: CONDITION_TEXT[f.condition] ?? (f.condition || null),
    specifics: Object.entries(decodeAspects(f.aspects)).map(([name, values]) => ({ name, value: values.join(', ') })),
    // Unknown until the fulfillment policy details are read: never guessed (listing-editor §4.5).
    freeShipping: null,
  };
}

/** Health for the eBay rail (lib/listingScore/ebay.ts through `computeListingHealth`). */
export function ebayHealth(view: ListingView<FieldMap>, remote: FieldMap | null): ListingHealth {
  const input = ebayScoreInput(view.fields as EbayEditorFields, view.facts);
  const sent = remote ? ebayScoreInput(remote as EbayEditorFields, {}) : null;
  return computeListingHealth('ebay', input, sent);
}

type AnySection = React.ComponentType<ListingSectionProps & Record<string, unknown>>;

/** eBay sections by id (C photos, D specifics + variations, F title / price / details / shipping). */
export const EBAY_SECTIONS: SectionComponents = {
  photos: PhotosSection as AnySection,
  title: EbayTitleSection as AnySection,
  specifics: EbaySpecificsSection as AnySection,
  price: EbayPriceSection as AnySection,
  variations: VariationsSection as AnySection,
  details: EbayDetailsSection as AnySection,
  shipping: EbayPoliciesSection as AnySection,
};
