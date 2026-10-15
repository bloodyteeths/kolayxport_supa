// components/domain/listing-editor/catalogSectionMap.tsx — section id → component for the Trendyol, Wix and Shopify
// editors (marketplace-editors §3; M6b-C wiring of the M6b-D sections). Which sections render, in which order and
// under which title comes from `lib/listingEditor/sections.ts` (`sectionsFor`); a section id missing here is not
// rendered. Photos and Title & description are CatalogBasicSections (no §11 owner); everything else is M6b-D.
import * as React from 'react';
import type { ListingSectionProps, SectionId } from '@/lib/listingEditor/types';
import type { CatalogMarketplace } from './adapters/catalog';
import { useListingEditor } from './useListingDraft';
import { attributesAiFrom, titleSectionAiProps, useListingAI, type UseListingAI } from './useListingAI';
import type { TrendyolEditorFields } from './adapters/trendyol';
import { CatalogPhotosSection, CatalogTitleSection } from './sections/CatalogBasicSections';
import { TrendyolAttributesSection } from './sections/TrendyolAttributesSection';
import { TrendyolPriceSection } from './sections/TrendyolPriceSection';
import {
  TrendyolDetailsSection,
  TrendyolShippingSection,
  TrendyolStatusBanner,
  TrendyolVariantsSection,
} from './sections/TrendyolDetailsSection';
import { WixPriceSection } from './sections/WixPriceSection';
import { WixDetailsSection, WixVariantsSection } from './sections/WixDetailsSection';
import { WixPersonalizationSection } from './sections/WixPersonalizationSection';
import { ShopifyDetailsSection, ShopifyOrgSection } from './sections/ShopifyOrgSection';
import { ShopifyPriceSection, ShopifyShippingSection, ShopifyVariantsSection } from './sections/ShopifyVariantsSection';
import { ShopifySeoSection } from './sections/ShopifySeoSection';

type AnySection = React.ComponentType<ListingSectionProps & Record<string, unknown>>;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Trendyol AI (marketplace-editors §1 AI; M6b-E `useListingAI('trendyol')`). The frame's own AI instance is
// Etsy-wired, so the Trendyol sections run their own (same pattern as the eBay sections' `useEbayAI`).
// Proposals only: Use writes the field through `setField` (autosave → draft), nothing is sent.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Route → sections: the workspace was opened from a cross-list pick (Start faster), so the Turkish draft runs once. */
export const CatalogCopyContext = React.createContext<{ translateCopy: boolean }>({ translateCopy: false });

export function useTrendyolAI(): UseListingAI {
  const ed = useListingEditor<TrendyolEditorFields>();
  const f = ed.view.fields;
  const price = typeof f.price === 'number' ? f.price : null;
  const setField = ed.setField;
  return useListingAI({
    marketplace: 'trendyol',
    input: {
      title: String(f.title ?? ''),
      description: String(f.description ?? ''),
      categoryId: f.categoryId !== '' && f.categoryId != null ? String(f.categoryId) : null,
      categoryName: f.categoryName || null,
      brandName: f.brandName || null,
      price,
      currency: 'TRY',
    },
    getField: (key) => (ed.view.fields as Record<string, unknown>)[key],
    setField: (key, value) => setField(key as keyof TrendyolEditorFields & string, value as never),
  });
}

/** Title & description with Trendyol's ✦ Suggest a title / Write description (and the copy's Turkish draft). */
export function TrendyolTitleSection(props: Partial<ListingSectionProps>) {
  const ai = useTrendyolAI();
  const ed = useListingEditor<TrendyolEditorFields>();
  const { translateCopy } = React.useContext(CatalogCopyContext);
  const ran = React.useRef(false);
  const seed = String(ed.view.fields.title ?? '');
  const sourceDescription = String(ed.view.fields.description ?? '');
  const ready = ed.loadState === 'ready';
  React.useEffect(() => {
    // Once per cross-list pick: the seller chose "Copy an Etsy or eBay listing…" with its AI cost shown.
    if (ran.current || !translateCopy || !ready || ed.mode !== 'create' || seed.trim().length < 3) return;
    ran.current = true;
    void ai.fillListing({ seed, sourceDescription });
  }, [translateCopy, ready, ed.mode, seed, sourceDescription, ai]);
  return <CatalogTitleSection {...props} {...titleSectionAiProps(ai)} />;
}

/** Attributes with Trendyol's ✦ value proposals (the hook loads the category's attributes itself). */
export function TrendyolAttributesAiSection(props: Partial<ListingSectionProps>) {
  const ai = useTrendyolAI();
  const aiAttributes = attributesAiFrom(ai) ?? undefined;
  return <TrendyolAttributesSection {...(props as ListingSectionProps)} aiAttributes={aiAttributes} />;
}

/** Trendyol photos with the approval / rejection banner on top (marketplace-editors §4.1, §8). */
export function TrendyolPhotosSection(props: Partial<ListingSectionProps>) {
  const ed = useListingEditor();
  const sentAt = ed.draft?.status === 'syncing' ? ed.draft.updatedAt ?? null : null;
  const banner = ed.mode === 'edit' ? <TrendyolStatusBanner raw={ed.view.meta.raw} sentAt={sentAt} /> : null;
  return <CatalogPhotosSection {...props} banner={banner} />;
}

export const CATALOG_SECTIONS: Record<CatalogMarketplace, Partial<Record<SectionId, AnySection>>> = {
  trendyol: {
    photos: TrendyolPhotosSection as AnySection,
    title: TrendyolTitleSection as AnySection,
    attributes: TrendyolAttributesAiSection as AnySection,
    price: TrendyolPriceSection as AnySection,
    variations: TrendyolVariantsSection as AnySection,
    details: TrendyolDetailsSection as AnySection,
    shipping: TrendyolShippingSection as AnySection,
  },
  wix: {
    photos: CatalogPhotosSection as AnySection,
    title: CatalogTitleSection as AnySection,
    price: WixPriceSection as AnySection,
    variations: WixVariantsSection as AnySection,
    details: WixDetailsSection as AnySection,
    personalization: WixPersonalizationSection as AnySection,
  },
  shopify: {
    photos: CatalogPhotosSection as AnySection,
    title: CatalogTitleSection as AnySection,
    tags: ShopifyOrgSection as AnySection,
    price: ShopifyPriceSection as AnySection,
    variations: ShopifyVariantsSection as AnySection,
    details: ShopifyDetailsSection as AnySection,
    shipping: ShopifyShippingSection as AnySection,
    seo: ShopifySeoSection as AnySection,
  },
};
