// components/domain/photo-studio/studioApi.ts — M7-E PhotoStudio: the client calls (no React).
// Reads: `GET /api/listings` (DB only, the selected ids), `GET /api/clawd/etsy?action=get_listing_images|videos`
// (one per listing, cached by the hook), `GET /api/etsy-drafts?shop_id=` (staged media of the shop's drafts).
// Writes (stage only, never Etsy): `POST /api/etsy-drafts/batch-media` (≤ 50 listings, 2 in flight) and
// `POST /api/etsy-drafts/media` through `stageEtsyDraftFile` (one file per call, fanned out by the hook).
// AI: `POST /api/ai/generate-image` (images, 10 credits) and `POST /api/ai/etsy {action:'generate_alt_text'}`
// (1 credit), both through the seoRules guards for text.
import { stageEtsyDraftFile, EtsyDraftClientError } from '@/lib/etsy/draftClient';
import { AiRequestError, aiErrorCode, coerceAiString, looksGarbled } from '@/lib/etsy/seoRules';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';
import { cleanAltText } from '@/components/domain/listing-editor/sections/photosModel';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import {
  BATCH_IN_FLIGHT,
  BATCH_MEDIA_MAX_ITEMS,
  batchWaves,
  chunk,
  draftsByListing,
  normalizeEtsyImages,
  normalizeEtsyVideos,
  toStudioDraft,
  type EtsyVideoLike,
  type MediaOp,
  type StudioDraft,
  type StudioMediaRow,
} from './studioModel';
import type { EtsyImageLike } from '@/components/domain/listing-editor/sections/photosModel';

export class StudioHttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(`HTTP ${status}${code ? ` ${code}` : ''}`);
    this.name = 'StudioHttpError';
    this.status = status;
    this.code = code;
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : undefined;
    throw new StudioHttpError(res.status, code);
  }
  return body;
}

export interface StudioListingsResult {
  rows: ListingRow[];
  store: ListingsResponse['store'];
  stores: ListingsResponse['stores'];
}

/** The selected listings from the DB cache (`not_connected` → StudioHttpError code 'not_connected'). */
export async function fetchStudioListings(shopId: string | null, ids: string[]): Promise<StudioListingsResult> {
  const params = new URLSearchParams({ marketplace: 'etsy', size: '250', ids: ids.join(',') });
  if (shopId) params.set('store', shopId);
  const body = (await getJson(`/api/listings?${params}`)) as ListingsResponse;
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = (Array.isArray(body?.rows) ? body.rows : []).slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { rows, store: body.store, stores: Array.isArray(body.stores) ? body.stores : [] };
}

export async function fetchListingImages(shopId: string, listingId: string): Promise<EtsyImageLike[]> {
  const params = new URLSearchParams({ action: 'get_listing_images', listing_id: listingId, shop_id: shopId });
  return normalizeEtsyImages(await getJson(`/api/clawd/etsy?${params}`));
}

export async function fetchListingVideos(shopId: string, listingId: string): Promise<EtsyVideoLike[]> {
  const params = new URLSearchParams({ action: 'get_listing_videos', listing_id: listingId, shop_id: shopId });
  return normalizeEtsyVideos(await getJson(`/api/clawd/etsy?${params}`));
}

/** Live drafts of the shop, per listing id. */
export async function fetchShopDrafts(shopId: string): Promise<Map<string, StudioDraft>> {
  return draftsByListing(await getJson(`/api/etsy-drafts?${new URLSearchParams({ shop_id: shopId })}`));
}

export type BatchItemResult =
  | { listingId: string; ok: true; draftId: string; status: string; media: StudioMediaRow[] }
  | { listingId: string; ok: false; code: string; key?: string; params?: Record<string, string | number> };

/** Thrown when the server gate answers 402 featureLocked (the global interceptor swaps the page to locked). */
export class FeatureLockedError extends Error {
  constructor() {
    super('featureLocked');
    this.name = 'FeatureLockedError';
  }
}

async function postBatch(shopId: string, items: { listingId: string; media: MediaOp[] }[]): Promise<BatchItemResult[]> {
  const res = await fetch('/api/etsy-drafts/batch-media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
    body: JSON.stringify({ shopId, items }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 402) throw new FeatureLockedError();
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; key?: string; params?: Record<string, string | number> };
    // The whole request failed (shop not found, server error): every item reports it.
    return items.map((i) => ({ listingId: i.listingId, ok: false as const, code: b.code || `HTTP_${res.status}`, key: b.key, params: b.params }));
  }
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return items.map((i) => ({ listingId: i.listingId, ok: false as const, code: 'BAD_RESPONSE' }));
  return results.map((r: Record<string, unknown>, idx: number) => {
    const listingId = typeof r?.listingId === 'string' ? r.listingId : items[idx]?.listingId ?? '';
    if (r?.ok === true) {
      const draft = toStudioDraft({ id: r.draftId, etsyListingId: listingId, status: r.status, media: r.media, queuedActions: [] });
      return { listingId, ok: true as const, draftId: String(r.draftId), status: String(r.status), media: draft?.media ?? [] };
    }
    return {
      listingId,
      ok: false as const,
      code: typeof r?.code === 'string' ? r.code : 'STAGE_FAILED',
      key: typeof r?.key === 'string' ? r.key : undefined,
      params: r?.params && typeof r.params === 'object' ? (r.params as Record<string, string | number>) : undefined,
    };
  });
}

/**
 * Stages media ops for many listings: waves keep one listing's requests sequential (no two writes to one draft
 * in flight), each wave is cut into ≤ 50-item requests with at most 2 in flight. `onResult` fires per item.
 */
export async function stageBatchMedia(
  shopId: string,
  items: { listingId: string; media: MediaOp[] }[],
  onResult: (r: BatchItemResult) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  for (const wave of batchWaves(items)) {
    const requests = chunk(wave, BATCH_MEDIA_MAX_ITEMS);
    let cursor = 0;
    const next = async () => {
      while (cursor < requests.length) {
        if (signal?.cancelled) return;
        const req = requests[cursor++];
        const results = await postBatch(shopId, req);
        results.forEach(onResult);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_IN_FLIGHT, requests.length) }, next));
  }
}

/** One file onto one listing's draft (existing single-file endpoint). Returns the staged media row. */
export async function stageFile(input: { shopId: string; listingId: string; file: File; kind: 'image' | 'video'; operation?: 'upload' | 'ai_upload'; rank?: number }): Promise<{ draftId: string; media: StudioMediaRow | null }> {
  const data = (await stageEtsyDraftFile(input)) as { draftId?: unknown; media?: unknown };
  const draft = toStudioDraft({ id: data?.draftId, etsyListingId: input.listingId, status: 'draft', media: data?.media ? [data.media] : [], queuedActions: [] });
  return { draftId: String(data?.draftId ?? ''), media: draft?.media[0] ?? null };
}

export { EtsyDraftClientError };

// ─── AI ──────────────────────────────────────────────────────────────────────────────────────────────

/** The credits endpoint answered 402 (out of AI credits). Shown as an inline Banner, never the global dialog. */
export class AiCreditsError extends Error {
  constructor() {
    super('aiCredits');
    this.name = 'AiCreditsError';
  }
}

const REMOVE_BG_PROMPT = 'Remove the background completely and place the exact same product on a pure solid white (#FFFFFF) studio background. Keep the product identical, sharp, well-lit and centered, with a soft natural shadow. No text, no props.';
const ENHANCE_PROMPT = 'Enhance this product photo: increase sharpness and clarity, fix lighting and white balance, reduce noise, boost detail. Keep the exact same product, framing and background. Photorealistic, high resolution.';
const DEFAULT_ADD_PROMPT = 'A professional lifestyle product photo of this exact product, natural light, clean composition, no text, no watermark.';

export type AiImageMode = 'generate' | 'enhance' | 'removeBg';

/** Generates one Etsy-ready image (4:3). Prompts stay English (DS P5). Returns a File for the staging upload. */
export async function generateStudioImage(input: {
  mode: AiImageMode;
  title: string;
  prompt: string;
  refUrls: string[];
  listingId: string;
}): Promise<File> {
  const base = input.mode === 'removeBg' ? REMOVE_BG_PROMPT : input.mode === 'enhance' ? ENHANCE_PROMPT : (input.prompt.trim() || DEFAULT_ADD_PROMPT);
  const prompt = input.mode === 'generate' ? base : input.prompt.trim() ? `${base} ${input.prompt.trim()}` : base;
  const res = await fetch('/api/ai/generate-image', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
    body: JSON.stringify({
      prompt: `${prompt}. Product context: ${input.title}`,
      marketplace: 'etsy',
      aspect_ratio: '4:3',
      white_background: input.mode === 'removeBg',
      reference_images: [],
      reference_image_urls: input.refUrls.filter(Boolean).slice(0, 3),
    }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.status === 402) throw new AiCreditsError();
  const b64 = data && typeof data === 'object' ? (data as { image_base64?: unknown }).image_base64 : null;
  if (!res.ok || typeof b64 !== 'string' || !b64) throw new AiRequestError(aiErrorCode(data));
  const mime = typeof (data as { mime_type?: unknown }).mime_type === 'string' ? (data as { mime_type: string }).mime_type : 'image/jpeg';
  return base64ToFile(b64, mime, `ai-${input.listingId}-${Date.now()}.${mime.includes('png') ? 'png' : 'jpg'}`);
}

/** Alt text for one photo (English, ≤ 250, guarded). */
export async function writeStudioAlt(input: { imageUrl: string; title: string }): Promise<string> {
  const res = await fetch('/api/ai/etsy', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
    body: JSON.stringify({ action: 'generate_alt_text', title: input.title, image_url: input.imageUrl }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.status === 402) throw new AiCreditsError();
  if (!res.ok) throw new AiRequestError(aiErrorCode(data));
  const text = cleanAltText(coerceAiString((data as { alt_text?: unknown } | null)?.alt_text));
  if (!text || looksGarbled(text)) throw new AiRequestError('invalid_ai_response');
  return text;
}

export function base64ToFile(base64: string, mimeType: string, filename: string): File {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mimeType });
}
