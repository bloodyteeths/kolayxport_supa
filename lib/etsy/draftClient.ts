/**
 * Error thrown by the draft client helpers. Carries the server's typed error
 * code and next-intl key (relative to the `etsy` namespace) so callers can
 * render `t(err.key, err.params)` instead of the raw English message.
 */
export class EtsyDraftClientError extends Error {
  status: number;
  code?: string;
  key?: string;
  params?: Record<string, string | number>;
  issues?: Array<{ field: string; severity: string; key: string; params?: Record<string, string | number>; message: string }>;
  data: any;

  constructor(status: number, data: any) {
    super(data?.error || `HTTP ${status}`);
    this.name = 'EtsyDraftClientError';
    this.status = status;
    this.code = data?.code;
    this.key = data?.key;
    this.params = data?.params;
    this.issues = data?.issues;
    this.data = data;
  }

  get isConflict() {
    return this.status === 409 && this.data?.status === 'conflict';
  }
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EtsyDraftClientError(res.status, data);
  return data;
}

export async function stageEtsyDraft(input: {
  shopId: string;
  listingId: string | number;
  fields?: Record<string, any>;
  taxonomy?: Record<string, any>;
  inventory?: Record<string, any>;
  variationImages?: any;
  personalization?: any;
  media?: Array<Record<string, any>>;
  queuedActions?: Array<Record<string, any>>;
  replaceFields?: boolean;
}) {
  const res = await fetch('/api/etsy-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shop_id: input.shopId,
      listing_id: input.listingId,
      fields: input.fields,
      taxonomy: input.taxonomy,
      inventory: input.inventory,
      variationImages: input.variationImages,
      personalization: input.personalization,
      media: input.media,
      queuedActions: input.queuedActions,
      replaceFields: input.replaceFields,
    }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function fetchEtsyDrafts(shopId: string, listingId?: string | number) {
  const params = new URLSearchParams({ shop_id: shopId });
  if (listingId !== undefined) params.set('listing_id', String(listingId));
  const res = await fetch(`/api/etsy-drafts?${params}`);
  const data = await parseOrThrow(res);
  return data.drafts || [];
}

/**
 * Sync one draft. Throws EtsyDraftClientError; `err.isConflict` is true when
 * the listing changed on Etsy since staging — retry with `{ force: true }`
 * only after the user explicitly confirms overwriting.
 * A successful result may carry `warnings` (partial success, e.g. a category
 * detail Etsy rejected) that should be shown to the user.
 */
export async function syncEtsyDraft(draftId: string, opts: { force?: boolean } = {}) {
  const res = await fetch(`/api/etsy-drafts/${draftId}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: Boolean(opts.force) }),
  });
  return parseOrThrow(res);
}

export async function syncEtsyDrafts(draftIds: string[], opts: { force?: boolean } = {}) {
  const res = await fetch('/api/etsy-drafts/bulk-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftIds, force: Boolean(opts.force) }),
  });
  return parseOrThrow(res);
}

/** Un-queue staged actions (e.g. `['delete']`) without discarding the draft. */
export async function removeEtsyDraftQueuedActions(draftId: string, types: string[]) {
  const res = await fetch(`/api/etsy-drafts/${draftId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeQueuedActions: types }),
  });
  const data = await parseOrThrow(res);
  return data.draft;
}

export async function discardEtsyDraft(draftId: string) {
  const res = await fetch(`/api/etsy-drafts/${draftId}`, { method: 'DELETE' });
  return parseOrThrow(res);
}

export async function stageEtsyDraftFile(input: {
  shopId: string;
  listingId: string | number;
  file: File;
  kind: 'image' | 'video';
  operation?: string;
  rank?: number;
  altText?: string;
  payload?: Record<string, any>;
}) {
  const form = new FormData();
  form.append('shop_id', input.shopId);
  form.append('listing_id', String(input.listingId));
  form.append('file', input.file);
  form.append('kind', input.kind);
  form.append('operation', input.operation || 'upload');
  if (input.rank !== undefined) form.append('rank', String(input.rank));
  if (input.altText) form.append('alt_text', input.altText);
  if (input.payload) form.append('payload', JSON.stringify(input.payload));
  const res = await fetch('/api/etsy-drafts/media', { method: 'POST', body: form });
  return parseOrThrow(res);
}
