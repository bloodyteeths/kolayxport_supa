// Browser helpers for the eBay staged-draft API (/api/ebay-drafts/**).
// listing-editor §7.1 F2: every helper throws `EbayDraftClientError` carrying
// the server's HTTP status, typed `code` and next-intl `key` (relative to the
// `ebay` namespace, e.g. `draftSync.conflict`) so callers render
// `t(err.key, err.params)` (or `draftErrorI18n(err)`) instead of raw English.
// `err.message` stays the server's English `error` string, so existing callers
// that read `.message` keep working.

import type { EbayCreateAction, EbayCreateVariations, EbayDiffField } from './draftPlan';

export class EbayDraftClientError extends Error {
  status: number;
  code?: string;
  key?: string;
  params?: Record<string, string | number>;
  data: any;

  constructor(status: number, data: any) {
    super(data?.error || `HTTP ${status}`);
    this.name = 'EbayDraftClientError';
    this.status = status;
    this.code = data?.code;
    this.key = data?.key;
    this.params = data?.params;
    this.data = data;
  }

  get isConflict() {
    return this.status === 409 && this.data?.status === 'conflict';
  }
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EbayDraftClientError(res.status, data);
  return data;
}

export type { EbayCreateAction, EbayCreateVariations, EbayDiffField };

/**
 * Stage edits into the SKU's open draft (creates it when needed). Nothing is sent to eBay.
 * New listing (F1): pass a local SKU and `queuedActions: [{ type: 'create', publish }]`;
 * the content goes in inventoryFields / offerFields / variationFields exactly like an edit
 * (variationFields = `EbayCreateVariations` for a new multi-variation listing).
 * `preserveConflict: true` keeps a `conflict` draft in conflict (the editor's autosave).
 */
export async function stageEbayDraft(input: {
  sku: string;
  offerId?: string;
  inventoryFields?: Record<string, any>;
  offerFields?: Record<string, any>;
  variationFields?: Record<string, any> | null;
  queuedActions?: Array<Record<string, any>>;
  media?: Array<Record<string, any>>;
  replaceFields?: boolean;
  preserveConflict?: boolean;
}) {
  const res = await fetch('/api/ebay-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: input.sku,
      offerId: input.offerId,
      inventoryFields: input.inventoryFields,
      offerFields: input.offerFields,
      variationFields: input.variationFields,
      queuedActions: input.queuedActions,
      media: input.media,
      replaceFields: input.replaceFields,
      preserveConflict: input.preserveConflict,
    }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function fetchEbayDrafts(sku?: string) {
  const params = new URLSearchParams();
  if (sku) params.set('sku', sku);
  const qs = params.toString();
  const res = await fetch(`/api/ebay-drafts${qs ? `?${qs}` : ''}`);
  const data = await parseOrThrow(res);
  return data.drafts || [];
}

/** One draft by id (any status), with media and the last 10 sync attempts. */
export async function fetchEbayDraft(draftId: string) {
  const res = await fetch(`/api/ebay-drafts/${encodeURIComponent(draftId)}`);
  const data = await parseOrThrow(res);
  return data.draft;
}

/**
 * Send one draft to eBay. A conflict (HTTP 409 `{ status: 'conflict', fields }`) is
 * RETURNED, not thrown, so legacy callers that check `result.status === 'conflict'`
 * keep working; every other failure throws `EbayDraftClientError`.
 */
export async function syncEbayDraft(draftId: string) {
  const res = await fetch(`/api/ebay-drafts/${draftId}/sync`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.status === 'conflict') return data;
  if (!res.ok) throw new EbayDraftClientError(res.status, data);
  return data;
}

export async function syncEbayDrafts(draftIds: string[]) {
  const res = await fetch('/api/ebay-drafts/bulk-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftIds }),
  });
  return parseOrThrow(res);
}

export async function discardEbayDraft(draftId: string) {
  const res = await fetch(`/api/ebay-drafts/${draftId}`, { method: 'DELETE' });
  return parseOrThrow(res);
}

/** Un-queue staged actions (`delete`, `publish`, `withdraw`, `copy`) without discarding the draft. */
export async function removeEbayDraftQueuedActions(draftId: string, types: string[]) {
  const res = await fetch(`/api/ebay-drafts/${draftId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeQueuedActions: types }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export interface EbayDraftDiff {
  remoteUpdatedAt: string | null;
  fields: EbayDiffField[];
  queuedActions: Array<{ type: string; [k: string]: unknown }>;
  hasQueuedDelete: boolean;
}

/** Review differences data (F3). Read-only. */
export async function fetchEbayDraftDiff(draftId: string): Promise<EbayDraftDiff> {
  const res = await fetch(`/api/ebay-drafts/${encodeURIComponent(draftId)}/diff`);
  return parseOrThrow(res);
}

/** "Keep my choices" (F3): keys in `keep` stay staged; other eBay-changed fields are dropped. Never sends. */
export async function resolveEbayDraft(draftId: string, keep: string[]) {
  const res = await fetch(`/api/ebay-drafts/${encodeURIComponent(draftId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function stageEbayDraftFile(input: {
  sku: string;
  file: File;
  kind: 'image';
  operation?: string;
  rank?: number;
  payload?: Record<string, any>;
}) {
  const form = new FormData();
  form.append('sku', input.sku);
  form.append('file', input.file);
  form.append('kind', input.kind);
  form.append('operation', input.operation || 'upload');
  if (input.rank !== undefined) form.append('rank', String(input.rank));
  if (input.payload) form.append('payload', JSON.stringify(input.payload));
  const res = await fetch('/api/ebay-drafts/media', { method: 'POST', body: form });
  return parseOrThrow(res);
}
