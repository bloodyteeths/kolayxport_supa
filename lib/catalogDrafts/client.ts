/**
 * Browser helpers for catalog drafts (Trendyol, Wix, Shopify), the same shape
 * as `lib/etsy/draftClient.ts`, plus `scheduleDraftSend` for all five
 * marketplaces (Etsy/eBay go through PATCH /api/{etsy,ebay}-drafts/[id]).
 *
 * Nothing here talks to a marketplace: stage/discard/schedule only write the
 * local draft; `sendCatalogDrafts` is the explicit send.
 */
import type {
  CatalogDraftDiff,
  CatalogDiffField,
  CatalogDraftDTO,
  SendResult,
  SendSummary,
} from './service';
import type { CatalogFieldPatch, CatalogMarketplace, CatalogQueuedActionType } from './schemas';

export type { CatalogDraftDiff, CatalogDiffField, CatalogDraftDTO, CatalogFieldPatch, CatalogMarketplace, CatalogQueuedActionType, SendResult, SendSummary };
export type {
  ShopifyImageOp,
  ShopifySeo,
  ShopifyVariantEdit,
  TrendyolAttributeValue,
  TrendyolCreatePayload,
  WixCreatePayload,
  WixCustomTextField,
  WixDiscount,
  WixMediaOp,
} from './schemas';

export class CatalogDraftClientError extends Error {
  status: number;
  code?: string;
  /** Full i18n key, e.g. 'listings.draftError.multiLocation'. */
  key?: string;
  params?: Record<string, string | number>;
  data: any;

  constructor(status: number, data: any) {
    super(data?.error || `HTTP ${status}`);
    this.name = 'CatalogDraftClientError';
    this.status = status;
    this.code = data?.code;
    this.key = data?.key;
    this.params = data?.params;
    this.data = data;
  }

  /** The CatalogDraft model is not deployed yet (backend BR-1a). */
  get isUnavailable() {
    return this.status === 503 && (this.code === 'UNAVAILABLE' || this.code === 'SCHEDULED_SEND_UNAVAILABLE');
  }
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CatalogDraftClientError(res.status, data);
  return data;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Merge into the product's open draft (creates it when there is none).
 * `fields` keys set to `null` drop that field from the draft.
 * `scheduledSendAt`: ISO string schedules, `null` unschedules, omitted keeps.
 */
export async function stageCatalogDraft(input: {
  marketplace: CatalogMarketplace;
  storeId?: string;
  externalId: string;
  fields?: { [K in keyof CatalogFieldPatch]?: CatalogFieldPatch[K] | null };
  /** `create` takes `payload` (create-only values; `null` drops a key) and needs externalId `new` / `new:<id>`. */
  queuedActions?: { type: CatalogQueuedActionType; payload?: Record<string, unknown> }[];
  removeQueuedActions?: CatalogQueuedActionType[];
  scheduledSendAt?: string | null;
}): Promise<CatalogDraftDTO> {
  const res = await fetch('/api/catalog-drafts', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function fetchCatalogDrafts(params: {
  marketplace: CatalogMarketplace;
  storeId?: string;
  ids?: string[];
  includeSynced?: boolean;
  scheduled?: boolean;
}): Promise<CatalogDraftDTO[]> {
  const qs = new URLSearchParams({ marketplace: params.marketplace });
  if (params.storeId) qs.set('store', params.storeId);
  if (params.ids?.length) qs.set('ids', params.ids.join(','));
  if (params.includeSynced) qs.set('includeSynced', '1');
  if (params.scheduled) qs.set('scheduled', '1');
  const res = await fetch(`/api/catalog-drafts?${qs}`);
  const data = await parseOrThrow(res);
  return data.drafts || [];
}

/** One draft by id (e.g. `?draft=` in the editor, or to read a create's new externalId after send). */
export async function fetchCatalogDraft(draftId: string): Promise<CatalogDraftDTO> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}`);
  const data = await parseOrThrow(res);
  return data.draft;
}

/** Review differences data (read-only, never sends). 409 CREATE_DRAFT for a new product. */
export async function fetchCatalogDraftDiff(draftId: string): Promise<CatalogDraftDiff> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}/diff`, { credentials: 'same-origin' });
  return parseOrThrow(res);
}

/**
 * "Keep my choices": staged keys in `keep` stay, other remotely-changed keys are dropped, the draft is
 * re-based on the live product and returns to `draft`. Never sends; never touches queued actions.
 */
export async function resolveCatalogDraft(draftId: string, keep: string[]): Promise<CatalogDraftDTO> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}/resolve`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ keep }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function discardCatalogDraft(draftId: string): Promise<CatalogDraftDTO> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function removeCatalogDraftQueuedActions(draftId: string, types: CatalogQueuedActionType[]): Promise<CatalogDraftDTO> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ removeQueuedActions: types }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

/**
 * "Keep my changes" after Review differences: the marketplace's current values
 * become the draft's base and a conflict goes back to `draft`. Never sends.
 */
export async function rebaseCatalogDraft(draftId: string): Promise<CatalogDraftDTO> {
  const res = await fetch(`/api/catalog-drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ rebase: true }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

/**
 * Explicit send (≤ 500 per call; chunk larger sets). Conflicts are never
 * forced. Drafts with a queued delete/archive are skipped unless their id is in
 * `confirmDeleteIds` (pass only after the type-to-confirm).
 */
export async function sendCatalogDrafts(draftIds: string[], opts: { confirmDeleteIds?: string[] } = {}): Promise<SendSummary> {
  const res = await fetch('/api/catalog-drafts/send', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ draftIds, confirmDeleteIds: opts.confirmDeleteIds || [] }),
  });
  return parseOrThrow(res);
}

export type ScheduleMarketplace = 'etsy' | 'ebay' | CatalogMarketplace;

const SCHEDULE_ENDPOINT: Record<ScheduleMarketplace, string> = {
  etsy: '/api/etsy-drafts',
  ebay: '/api/ebay-drafts',
  trendyol: '/api/catalog-drafts',
  wix: '/api/catalog-drafts',
  shopify: '/api/catalog-drafts',
};

/**
 * Set (`at` = Date) or clear (`at` = null) the scheduled send of drafts.
 * One PATCH per draft, sequential; resolves with the ids that failed.
 * Drafts with a queued delete cannot be scheduled (409 SCHEDULE_DELETE_REFUSED).
 */
export async function scheduleDraftSend(
  marketplace: ScheduleMarketplace,
  draftIds: string[],
  at: Date | null,
): Promise<{ scheduled: string[]; failed: { id: string; key?: string; code?: string }[] }> {
  const base = SCHEDULE_ENDPOINT[marketplace];
  const body = JSON.stringify({ scheduledSendAt: at ? at.toISOString() : null });
  const scheduled: string[] = [];
  const failed: { id: string; key?: string; code?: string }[] = [];
  for (const id of draftIds) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body });
      await parseOrThrow(res);
      scheduled.push(id);
    } catch (err) {
      const e = err as CatalogDraftClientError;
      failed.push({ id, key: e?.key, code: e?.code });
    }
  }
  return { scheduled, failed };
}
