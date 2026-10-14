/**
 * Channel adapter contract for stock sync (W2, T8).
 *
 * Rules every adapter follows:
 *  - Credentials are resolved by (link.userId, accountRef) and fail CLOSED when
 *    the account is not (or no longer) owned by that user: the result is
 *    'failed' (non-retryable) with linkPatch status 'paused' / 'account_changed'.
 *  - Every push reads the remote quantity fresh first. For reasons sale,
 *    remote_adjust and reconcile, sent = min(target, freshRemote)
 *    (decideSendQty). Only cancel, manual, seed, restore and adjust may raise.
 *  - Sent == fresh -> 'skipped' (no write).
 */
import type { StockLink } from '@prisma/client';
import type { StockChannel } from '../types';
import type { RemoteCandidate } from '../matching';
import type { StockSettingsRow } from '../settings';

export type { RemoteCandidate };
export type StockLinkRow = StockLink;

export type PushItem = {
  pushId: string;
  link: StockLinkRow;
  targetQty: number;
  reason: string;
};

export type PushResultStatus = 'applied' | 'skipped' | 'unknown' | 'awaiting_batch' | 'failed' | 'retry';

export type PushResult = {
  pushId: string;
  linkId: string;
  status: PushResultStatus;
  /** 'failed' only: false = give up now (auth/ownership/structure). */
  retryable?: boolean;
  /** 'retry' only: defer without consuming an attempt (rate limit / lock busy). */
  deferMs?: number;
  freshRemoteQty?: number | null;
  sentQty?: number | null;
  remoteQtyAfter?: number | null;
  externalRef?: string | null;
  error?: string | null;
  linkPatch?: Partial<Pick<StockLinkRow, 'status' | 'statusReason' | 'deactivatedByStock' | 'deactivatedAt' | 'variantRef' | 'variantValueKey'>>;
};

export type RemoteQty = { qty: number; remoteUpdatedTs?: number };

export interface StockAdapter {
  channel: StockChannel;
  /** false: listed as 'coming soon' / unsupported; links can exist but are never pushed. */
  supportsWrite: boolean;
  unsupportedReason?: string;
  /** Accounts of this channel the user owns: accountRef -> label. */
  listAccounts(userId: string): Promise<Array<{ accountRef: string; label: string }>>;
  ownsAccount(userId: string, accountRef: string): Promise<boolean>;
  listCandidates(userId: string): Promise<RemoteCandidate[]>;
  /** Remote quantities by link id (missing = unreadable). cacheOnly: no network (reconcile for Etsy). */
  readQuantities(userId: string, links: StockLinkRow[], opts?: { cacheOnly?: boolean }): Promise<Map<string, RemoteQty>>;
  pushQuantities(userId: string, items: PushItem[], ctx: { settings: StockSettingsRow }): Promise<PushResult[]>;
  /** awaiting_batch resolution (Trendyol). */
  resolveBatch?(userId: string, accountRef: string, batchRef: string): Promise<{ done: boolean; failedBarcodes?: Set<string>; error?: string }>;
}

export function failAll(items: PushItem[], error: string, opts: { retryable: boolean; linkPatch?: PushResult['linkPatch'] }): PushResult[] {
  return items.map((it) => ({
    pushId: it.pushId,
    linkId: it.link.id,
    status: 'failed' as const,
    retryable: opts.retryable,
    error: error.slice(0, 500),
    linkPatch: opts.linkPatch,
  }));
}

export const ACCOUNT_CHANGED_PATCH = { status: 'paused', statusReason: 'account_changed' } as const;

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as any;
    return `${e.status ?? ''} ${JSON.stringify(e.body ?? e).slice(0, 300)}`.trim();
  }
  return String(err);
}

/** 4xx other than 408/409/429 are permanent; network/5xx/429 are retryable. */
export function isRetryableHttp(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status ?? (String(e?.message || '').match(/\b([45]\d\d)\b/) || [])[1]);
  if (!Number.isFinite(status) || status === 0) return true;
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}
