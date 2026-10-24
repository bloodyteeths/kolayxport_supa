// components/domain/listing-editor/crosslistTrendyolToEtsy.ts — Trendyol → Etsy "Copy to Etsy"
// (`/app/etsy-listings/new?crosslist=trendyol:<barcode>`). Same contract as eBay → Etsy (crosslistEbayToEtsy.ts): the
// Trendyol product is read with the Trendyol editor's own read (`fetchTrendyolProduct`, read-only) and mapped to the
// Etsy creator's copy data. Nothing is staged here: the create workspace stages it on the seller's first save, and
// nothing reaches Etsy until the explicit send. The price is TRY: it is kept only when the Etsy shop is in TRY
// (fitEbayCopyToShop; no conversion). Text stays as written (Turkish); the creator's AI can rewrite it in English.
import type { CopySourceData } from '@/lib/listingEditor/types';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { fetchTrendyolProduct } from './adapters/trendyol';
import { ETSY_MAX_IMAGES } from './adapters/etsy';
import { ebayHtmlToPlainText } from './crosslistEbayToEtsy';

const ETSY_TITLE_MAX = 140;
const ETSY_MATERIALS_MAX = 13;
const ETSY_MATERIAL_LEN = 45;
/** Trendyol attribute names that describe what the item is made of. */
const MATERIAL_ATTRIBUTES = /^(materyal|malzeme|kumaş( tipi)?|ana malzeme|materyal bileşeni|material)$/i;

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function positive(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A Trendyol API product (`content[]` item) → Etsy create copy data (pure). Tags stay empty: Trendyol has none. */
export function etsyCopyFromTrendyolProduct(p: Record<string, unknown>): CopySourceData {
  const images = (Array.isArray(p.images) ? p.images : [])
    .map((it) => (typeof it === 'string' ? it : it && typeof it === 'object' ? str((it as { url?: unknown }).url) : ''))
    .filter((u) => /^https:\/\//i.test(u));
  const materials = (Array.isArray(p.attributes) ? p.attributes : [])
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object' && MATERIAL_ATTRIBUTES.test(str((a as Record<string, unknown>).attributeName).trim()))
    .flatMap((a) => str(a.attributeValue ?? a.customAttributeValue).split(/[,/]/))
    .map((m) => decodeEntities(m).trim().slice(0, ETSY_MATERIAL_LEN))
    .filter(Boolean);
  const qty = positive(p.quantity);
  return {
    source: 'trendyol',
    title: decodeEntities(str(p.title)).replace(/\s+/g, ' ').trim().slice(0, ETSY_TITLE_MAX),
    description: ebayHtmlToPlainText(str(p.description)),
    tags: [],
    materials: Array.from(new Set(materials)).slice(0, ETSY_MATERIALS_MAX),
    price: positive(p.salePrice),
    quantity: qty !== undefined && Number.isInteger(qty) ? qty : undefined,
    imageUrls: Array.from(new Set(images)).slice(0, ETSY_MAX_IMAGES),
  };
}

/** Reads the Trendyol product (by barcode) and returns the Etsy copy data plus its currency. Null = not found. */
export async function loadTrendyolCrosslistForEtsy(barcode: string): Promise<{ copy: CopySourceData; currency: string | null } | null> {
  const p = await fetchTrendyolProduct(barcode).catch(() => null);
  if (!p) return null;
  const currency = str(p.currencyType).trim() || 'TRY';
  return { copy: etsyCopyFromTrendyolProduct(p), currency };
}
