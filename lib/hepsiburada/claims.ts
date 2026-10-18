/**
 * Hepsiburada claims (iade / talep) — normalisation + open-claims fan-out.
 *
 * HB lists claims per status (`GET /claims/merchantId/{id}/status/{status}`) and mixes casing in the payload
 * (documented camelCase plus live PascalCase extras such as `AwaitingActionExpireDate`, `Deliveries`, `Reports`),
 * so every read goes through `normalizeHbClaim`. Pure except `listOpenHepsiburadaClaims`.
 */
import type { HepsiburadaClient } from './client';
import type { Claim } from './generated/claim-list';

/** Statuses the seller has to act on (or watch). */
export const HB_OPEN_CLAIM_STATUSES = ['NewRequest', 'AwaitingAction', 'AwaitingPreApproval', 'InDispute'] as const;
export type HbOpenClaimStatus = (typeof HB_OPEN_CLAIM_STATUSES)[number];

/** Statuses that can be answered with accept / reject. */
const ACTIONABLE = new Set(['newrequest', 'awaitingaction']);

export interface HbClaimDelivery {
  status: string | null;
  direction: string | null;
  trackingNumber: string | null;
  cargoCompany: string | null;
  packageNumber: string | null;
  createdAt: string | null;
}

export interface HbClaim {
  number: string;
  id: string | null;
  status: string;
  /** NewRequest / AwaitingAction: accept or reject is possible. */
  actionable: boolean;
  type: string | null;
  reason: string | null;
  explanation: string | null;
  customerName: string | null;
  orderNumber: string | null;
  lineItemId: string | null;
  sku: string | null;
  merchantSku: string | null;
  quantity: number;
  amount: number | null;
  currency: string;
  refundAmount: number | null;
  claimDate: string | null;
  orderDate: string | null;
  /** When the seller's window to act closes (AwaitingAction or pre-approval). */
  actionDeadline: string | null;
  images: string[];
  deliveries: HbClaimDelivery[];
}

function pick<T = unknown>(o: Record<string, any>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k] as T;
    const alt = k.charAt(0) === k.charAt(0).toUpperCase() ? k.charAt(0).toLowerCase() + k.slice(1) : k.charAt(0).toUpperCase() + k.slice(1);
    if (o[alt] !== undefined && o[alt] !== null && o[alt] !== '') return o[alt] as T;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** ISO for HB timestamps; zone-less values are Turkey time (UTC+3). */
function iso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}+03:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function normalizeHbClaim(raw: Claim | Record<string, any>): HbClaim {
  const c = (raw ?? {}) as Record<string, any>;
  const status = str(pick(c, 'status')) ?? '';
  const reports: any[] = Array.isArray(pick(c, 'Reports')) ? (pick(c, 'Reports') as any[]) : [];
  const deliveries: any[] = Array.isArray(pick(c, 'Deliveries')) ? (pick(c, 'Deliveries') as any[]) : [];
  return {
    number: str(pick(c, 'number')) ?? str(pick(c, 'id')) ?? '',
    id: str(pick(c, 'id')),
    status,
    actionable: ACTIONABLE.has(status.toLowerCase()),
    type: str(pick(c, 'claimType')),
    reason: str(pick(c, 'Reason')),
    explanation: str(pick(c, 'explanation')),
    customerName: str(pick(c, 'customerName')),
    orderNumber: str(pick(c, 'orderNumber')),
    lineItemId: str(pick(c, 'lineItemId')),
    sku: str(pick(c, 'sku')),
    merchantSku: str(pick(c, 'MerchantSku')),
    quantity: num(pick(c, 'quantity')) ?? 1,
    amount: num(pick(c, 'totalPriceAmount')) ?? num(pick(c, 'priceAmount')),
    currency: str(pick(c, 'priceCurrency')) ?? 'TRY',
    refundAmount: num(pick(c, 'refundAmount')),
    claimDate: iso(pick(c, 'claimDate')),
    orderDate: iso(pick(c, 'orderDate')),
    actionDeadline: iso(pick(c, 'AwaitingActionExpireDate')) ?? iso(pick(c, 'awaitingPreApprovalExpireDate')),
    images: reports.map((r) => str(pick(r ?? {}, 'ImageUrl'))).filter((u): u is string => !!u),
    deliveries: deliveries.map((d) => {
      const o = (d ?? {}) as Record<string, any>;
      const cargo = (pick<Record<string, any>>(o, 'CargoCompany') ?? {}) as Record<string, any>;
      return {
        status: str(pick(o, 'Status')),
        direction: str(pick(o, 'Direction')),
        trackingNumber: str(pick(o, 'TrackingNumber')),
        cargoCompany: str(pick(cargo, 'Name')) ?? str(pick(cargo, 'Alias')),
        packageNumber: str(pick(o, 'PackageNumber')),
        createdAt: iso(pick(o, 'CreatedDate')),
      };
    }),
  };
}

/** Deadline first (soonest), then newest claim. Unknown dates last. */
export function compareClaims(a: HbClaim, b: HbClaim): number {
  const da = a.actionDeadline ? Date.parse(a.actionDeadline) : Infinity;
  const db = b.actionDeadline ? Date.parse(b.actionDeadline) : Infinity;
  if (da !== db) return da - db;
  const ca = a.claimDate ? Date.parse(a.claimDate) : 0;
  const cb = b.claimDate ? Date.parse(b.claimDate) : 0;
  return cb - ca;
}

/** Merge per-status pages, dropping duplicates (a claim may move status between calls). */
export function mergeClaims(lists: ReadonlyArray<ReadonlyArray<Claim | Record<string, any>>>): HbClaim[] {
  const byNumber = new Map<string, HbClaim>();
  for (const list of lists) {
    for (const raw of list || []) {
      const c = normalizeHbClaim(raw);
      if (c.number && !byNumber.has(c.number)) byNumber.set(c.number, c);
    }
  }
  return [...byNumber.values()].sort(compareClaims);
}

export interface OpenClaimsResult {
  claims: HbClaim[];
  /** Statuses whose call failed (the rest are still returned). */
  failedStatuses: string[];
}

/** Every open claim (first 100 per status). A failing status is reported, not fatal, unless all fail. */
export async function listOpenHepsiburadaClaims(client: Pick<HepsiburadaClient, 'listClaimsByStatus'>): Promise<OpenClaimsResult> {
  const results = await Promise.allSettled(
    HB_OPEN_CLAIM_STATUSES.map((s) => client.listClaimsByStatus(s, { offset: 0, limit: 100 })),
  );
  const lists: Array<Array<Claim | Record<string, any>>> = [];
  const failedStatuses: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const v: any = r.value;
      lists.push(Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.Items) ? v.Items : []);
    } else {
      failedStatuses.push(HB_OPEN_CLAIM_STATUSES[i]);
    }
  });
  if (failedStatuses.length === HB_OPEN_CLAIM_STATUSES.length) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { claims: mergeClaims(lists), failedStatuses };
}
