/**
 * Browser helpers for /api/stock/* (W2). JSON in/out; errors carry the API's
 * error code so the UI can show stockSync.errors.<code>.
 */
export class StockApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
    this.name = 'StockApiError';
  }
}

export async function stockFetch<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method || 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new StockApiError(String(data?.error || 'generic'), res.status);
  return data as T;
}

export const swrStockFetcher = (url: string) => stockFetch(url);

/** Key under stockSync.errors for an error (falls back to 'generic'). */
export function stockErrorKey(err: unknown): string {
  const known = new Set([
    'account_not_owned', 'token_missing', 'token_invalid', 'token_expired', 'typed_confirm_required', 'plan_changed', 'not_enabled',
    'already_live', 'needs_seed', 'snapshot_not_found', 'snapshot_expired', 'already_restored', 'invalid_quantity', 'invalid_value',
  ]);
  const code = err instanceof StockApiError ? err.code : '';
  return `errors.${known.has(code) ? code : 'generic'}`;
}

// ---- Response types (subset the UI uses) ----

export type StockLinkView = {
  id: string;
  channel: string;
  accountRef: string;
  externalId: string;
  variantRef: string;
  title: string | null;
  remoteSku: string | null;
  matchType: string;
  status: string;
  statusReason: string | null;
  unitsPerSale: number;
  buffer: number;
  maxListedQty: number | null;
  lastSeenRemoteQty: number | null;
  lastSeenAt: string | null;
  lastPushedQty: number | null;
  lastPushedAt: string | null;
  deactivatedByStock: boolean;
  target: number;
};

export type StockItemView = {
  id: string;
  sku: string;
  displaySku: string;
  title: string | null;
  imageUrl: string | null;
  onHand: number;
  safetyBuffer: number;
  tracking: string;
  status: 'active' | 'paused' | 'needs_review' | string;
  seededAt: string | null;
  updatedAt: string;
  openPushes: number;
  lastError: string | null;
  links: StockLinkView[];
};

export type StockSettingsView = {
  configured: boolean;
  enabled: boolean;
  dryRun: boolean;
  live: boolean;
  globallyDisabled: boolean;
  enabledAt: string | null;
  goLiveAt: string | null;
  restockOnCancel: boolean;
  autoFixDrift: boolean;
  etsyZeroStockAction: string;
  seedPolicy: string;
  seedSubtractReserved: boolean;
  channels: string[];
  shopifyLocationId: string | null;
};

export type ChannelAccounts = {
  channel: string;
  supportsWrite: boolean;
  unsupportedReason: string | null;
  oversellWindowMinutes: number;
  accounts: Array<{ accountRef: string; label: string }>;
};

export type SettingsResponse = {
  settings: StockSettingsView;
  channels: ChannelAccounts[];
  counts: { items: number; needsReview: number; activeLinks: number; suggestedLinks: number; failedPushes24h: number };
};

export type Candidate = {
  channel: string;
  accountRef: string;
  accountLabel?: string | null;
  externalId: string;
  variantRef: string;
  variantValueKey?: string | null;
  sku: string | null;
  title: string | null;
  variantLabel?: string | null;
  imageUrl?: string | null;
  quantity: number;
  state?: string | null;
  supportsWrite: boolean;
  unsupportedReason?: string | null;
};

export type MatchGroup = {
  sku: string;
  displaySku: string;
  members: Candidate[];
  channels: string[];
  multiChannel: boolean;
  sharedPoolChannels: string[];
  conflict: boolean;
  needsReview: boolean;
  reviewReasons: string[];
};

export type CandidatesResponse = {
  channels: ChannelAccounts[];
  groups: MatchGroup[];
  groupsTotal: number;
  multiChannelGroups: number;
  unmatched: Candidate[];
  unmatchedTotal: number;
  loose: Array<{ key: string; skus: string[]; members: Candidate[] }>;
  titles: Array<{ candidate: Candidate; matches: Array<{ candidate: Candidate; score: number }> }>;
  coverage: { lines: number; covered: number; percent: number };
  candidateCount: number;
};

export type PreviewResponse = {
  items: Array<{
    stockItemId: string;
    sku: string;
    title: string | null;
    imageUrl: string | null;
    onHand: number;
    status: string;
    links: Array<{
      linkId: string;
      channel: string;
      externalId: string;
      variantRef: string;
      title: string | null;
      remoteSku: string | null;
      status: string;
      remote: number | null;
      remoteSource: 'live' | 'last_seen' | 'none';
      target: number;
      wouldSend: number | null;
      effect: 'none' | 'set' | 'deactivate' | 'disable_variation' | 'unsupported';
      bigDrop: boolean;
    }>;
  }>;
  totals: { pushes: number; deactivations: number; disabledVariations: number; bigDrops: number; liveReads: number; cappedLinks: number; needsReview: number };
  oversellWindowMinutes: Record<string, number>;
  requiresTypedConfirm: boolean;
  confirmToken: string | null;
  confirmTokenExpiresAt: string | null;
};

export type TimelineEntryView = {
  id: string;
  at: string;
  source: 'ledger' | 'push' | 'observation';
  kind: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  params: Record<string, string | number>;
  adoptObservationId?: string;
  linkId?: string | null;
};

/** Member payload for POST /api/stock/links. */
export function memberOf(c: Candidate) {
  return {
    channel: c.channel,
    accountRef: c.accountRef,
    externalId: c.externalId,
    variantRef: c.variantRef,
    variantValueKey: c.variantValueKey ?? null,
    sku: c.sku,
    title: c.variantLabel ? `${c.title ?? ''} (${c.variantLabel})` : c.title,
  };
}
