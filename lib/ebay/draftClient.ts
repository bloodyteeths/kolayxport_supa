export async function stageEbayDraft(input: {
  sku: string;
  offerId?: string;
  inventoryFields?: Record<string, any>;
  offerFields?: Record<string, any>;
  variationFields?: Record<string, any>;
  queuedActions?: Array<Record<string, any>>;
  media?: Array<Record<string, any>>;
  replaceFields?: boolean;
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
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.draft;
}

export async function fetchEbayDrafts(sku?: string) {
  const params = new URLSearchParams();
  if (sku) params.set('sku', sku);
  const qs = params.toString();
  const res = await fetch(`/api/ebay-drafts${qs ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.drafts || [];
}

export async function syncEbayDraft(draftId: string) {
  const res = await fetch(`/api/ebay-drafts/${draftId}/sync`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function syncEbayDrafts(draftIds: string[]) {
  const res = await fetch('/api/ebay-drafts/bulk-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function discardEbayDraft(draftId: string) {
  const res = await fetch(`/api/ebay-drafts/${draftId}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
