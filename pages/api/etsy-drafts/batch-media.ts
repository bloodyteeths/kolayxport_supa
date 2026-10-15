// POST /api/etsy-drafts/batch-media — M7-E PhotoStudio (pro-gating §4.4). UI-owned route; it only IMPORTS the
// backend draft engine (`lib/etsy/draftService.ts`, BUILD_PLAN §1) and never writes Etsy: every item is staged
// into that listing's DB draft. Sending stays on "Send N changes" (listings / BulkGrid).
//
// Body  { shopId: string; items: { listingId: string; media: MediaOp[] /* ≤ 50 */ }[] /* ≤ 50 */ }
//        MediaOp = { kind: 'image'|'video', operation: 'upload'|'delete'|'reorder'|'update_alt',
//                    etsyMediaId?, sourceUrl?, rank?, altText? }   (whitelisted again by upsertDraftPatch)
// 200   { results: ({ listingId, ok: true, draftId, status, media: StagedMediaRow[] }
//                  | { listingId, ok: false, code, key?, params? })[] }   (one per item, in input order)
// 400   { error, code: 'BAD_REQUEST' }          malformed body / too many items
// 401   unauthenticated
// 402   { error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: 'bulkPhotoStudio', neutral }
// 404   { code: 'SHOP_NOT_FOUND', key: 'draftSync.shopNotFound' }   (shop not owned / not connected)
//
// Per item (never fails the batch): a listing whose draft is being sent → `DRAFT_SENDING`
// (`draftSync.draftSyncing`); a draft with a queued listing delete → `QUEUED_DELETE`
// (`draftSync.deleteNotExclusive`, founder rule: never stage onto / send a draft with a queued delete);
// otherwise whatever `upsertDraftPatch` throws (`draftErrorResponse`: code + `etsy.*` i18n key).
// Concurrency 5 (a new draft costs one live listing + inventory read through `getOrCreateDraft`).
//
// Server gate (pro-gating §1 "server first"): `bulkPhotoStudio` must be in the account's plan. Until the billing
// backend track ships `requireFeature` (tiers.md), the plan is derived exactly like the UI fallback
// (`entitlementFromSettings` over the same fields `/api/user/settings` returns), so UI and server agree.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { assertShopOwnership, toSerializable, upsertDraftPatch } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import { entitlementFromSettings } from '@/lib/billing/useEntitlement';
import { isNeutralBilling } from '@/lib/billing/billingState';

export const BATCH_MEDIA_MAX_ITEMS = 50;
export const BATCH_MEDIA_MAX_OPS = 50;
export const BATCH_MEDIA_CONCURRENCY = 5;
const FEATURE = 'bulkPhotoStudio' as const;

export type BatchMediaResult =
  | { listingId: string; ok: true; draftId: string; status: string; media: unknown[] }
  | { listingId: string; ok: false; code: string; key?: string; params?: Record<string, string | number> };

interface ParsedItem {
  listingId: string;
  media: Record<string, unknown>[];
}

/** Validates the body shape (the draft service re-validates every op). */
export function parseBatchMediaBody(body: unknown): { ok: true; shopId: string; items: ParsedItem[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be an object' };
  const b = body as Record<string, unknown>;
  const shopId = typeof b.shopId === 'string' ? b.shopId.trim() : typeof b.shopId === 'number' ? String(b.shopId) : '';
  if (!shopId || !/^\d{1,20}$/.test(shopId)) return { ok: false, error: 'shopId is required' };
  if (!Array.isArray(b.items) || b.items.length === 0) return { ok: false, error: 'items must be a non-empty array' };
  if (b.items.length > BATCH_MEDIA_MAX_ITEMS) return { ok: false, error: `At most ${BATCH_MEDIA_MAX_ITEMS} items per request` };
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const raw of b.items) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Each item must be an object' };
    const r = raw as Record<string, unknown>;
    const listingId = typeof r.listingId === 'string' || typeof r.listingId === 'number' ? String(r.listingId).trim() : '';
    if (!/^\d{1,20}$/.test(listingId)) return { ok: false, error: 'Each item needs a numeric listingId' };
    // One item per listing: two writes to one draft in the same request would race.
    if (seen.has(listingId)) return { ok: false, error: 'A listing may appear only once per request' };
    seen.add(listingId);
    if (!Array.isArray(r.media) || r.media.length === 0) return { ok: false, error: 'Each item needs a non-empty media array' };
    if (r.media.length > BATCH_MEDIA_MAX_OPS) return { ok: false, error: `At most ${BATCH_MEDIA_MAX_OPS} media operations per listing` };
    if (r.media.some((m) => !m || typeof m !== 'object' || Array.isArray(m))) return { ok: false, error: 'Each media operation must be an object' };
    items.push({ listingId, media: r.media as Record<string, unknown>[] });
  }
  return { ok: true, shopId, items };
}

/**
 * Server-side `bulkPhotoStudio` decision. `allowed` false → 402 featureLocked; `neutral` tells the UI to use the
 * Shopify-safe wording (no plans, no prices). Mirrors `/api/user/settings` (an active ShopifyShop or the
 * shopify_free provider is shopify_free) + `entitlementFromSettings`. Swap for tiers.md `requireFeature` later.
 */
export async function bulkPhotoStudioAccess(userId: string, now: Date = new Date()): Promise<{ allowed: boolean; neutral: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionPlan: true, subscriptionStatus: true, billingInterval: true, billingProvider: true, trialExpiresAt: true },
  });
  if (!user) return { allowed: false, neutral: true };
  const activeShopify = await prisma.shopifyShop.count({ where: { userId, isActive: true } });
  const shopify = user.billingProvider === 'shopify_free' || activeShopify > 0;
  const ent = entitlementFromSettings({
    subscriptionPlan: shopify ? 'shopify_free' : user.subscriptionPlan,
    subscriptionStatus: shopify ? 'active' : user.subscriptionStatus,
    billingInterval: user.billingInterval,
    billingProvider: shopify ? 'shopify_free' : user.billingProvider,
    trialExpiresAt: user.trialExpiresAt ? new Date(user.trialExpiresAt).toISOString() : null,
  }, now);
  if (!ent) return { allowed: false, neutral: true };
  return { allowed: ent.features[FEATURE] === true, neutral: isNeutralBilling(ent) };
}

/** Pre-check per listing: a draft being sent, or one with a queued listing delete, is not staged onto. */
async function blockedListings(userId: string, shopId: string, listingIds: string[]): Promise<Map<string, 'DRAFT_SENDING' | 'QUEUED_DELETE'>> {
  const drafts = await prisma.etsyListingDraft.findMany({
    where: {
      userId,
      etsyShopId: shopId,
      etsyListingId: { in: listingIds.map((id) => BigInt(id)) },
      status: { in: ['draft', 'failed', 'conflict', 'syncing'] },
    },
    select: { etsyListingId: true, status: true, queuedActions: true },
  });
  const out = new Map<string, 'DRAFT_SENDING' | 'QUEUED_DELETE'>();
  for (const d of drafts) {
    const id = String(d.etsyListingId);
    if (d.status === 'syncing') { out.set(id, 'DRAFT_SENDING'); continue; }
    const actions = Array.isArray(d.queuedActions) ? (d.queuedActions as Array<Record<string, unknown>>) : [];
    if (actions.some((a) => a && a.type === 'delete' && !a.completedAt) && !out.has(id)) out.set(id, 'QUEUED_DELETE');
  }
  return out;
}

const BLOCK_KEY: Record<'DRAFT_SENDING' | 'QUEUED_DELETE', string> = {
  DRAFT_SENDING: 'draftSync.draftSyncing',
  QUEUED_DELETE: 'draftSync.deleteNotExclusive',
};

function serializeMedia(media: unknown): unknown[] {
  if (!Array.isArray(media)) return [];
  return (toSerializable(media) as Array<Record<string, unknown>>).map((m) => ({
    id: m.id,
    kind: m.kind,
    operation: m.operation,
    etsyMediaId: m.etsyMediaId ?? null,
    rank: m.rank ?? null,
    altText: m.altText ?? null,
    sourceUrl: m.sourceUrl ?? null,
    filename: m.filename ?? null,
    contentType: m.contentType ?? null,
    // The preview route only needs to know a local file exists; the path itself never leaves the server.
    localPath: m.localPath ? 'staged' : null,
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = parseBatchMediaBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: 'BAD_REQUEST' });
  const { shopId, items } = parsed;

  try {
    const access = await bulkPhotoStudioAccess(user.id);
    if (!access.allowed) {
      return res.status(402).json({ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature: FEATURE, neutral: access.neutral });
    }
    await assertShopOwnership(user.id, shopId);
    const blocked = await blockedListings(user.id, shopId, items.map((i) => i.listingId));

    const results: BatchMediaResult[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        const item = items[idx];
        const block = blocked.get(item.listingId);
        if (block) {
          results[idx] = { listingId: item.listingId, ok: false, code: block, key: BLOCK_KEY[block] };
          continue;
        }
        try {
          const draft = await upsertDraftPatch({ userId: user.id, shopId, listingId: item.listingId, media: item.media });
          if (!draft) {
            results[idx] = { listingId: item.listingId, ok: false, code: 'DRAFT_NOT_FOUND', key: 'draftSync.draftNotFound' };
            continue;
          }
          const d = draft as unknown as { id: string; status: string; media?: unknown };
          results[idx] = { listingId: item.listingId, ok: true, draftId: String(d.id), status: String(d.status), media: serializeMedia(d.media) };
        } catch (err) {
          const { body } = draftErrorResponse(err, 'Media staging failed');
          results[idx] = {
            listingId: item.listingId,
            ok: false,
            code: typeof body.code === 'string' ? body.code : 'STAGE_FAILED',
            ...(typeof body.key === 'string' ? { key: body.key } : {}),
            ...(body.params ? { params: body.params as Record<string, string | number> } : {}),
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_MEDIA_CONCURRENCY, items.length) }, worker));
    return res.status(200).json({ results });
  } catch (err) {
    const { status, body } = draftErrorResponse(err, 'Batch media staging failed');
    // Never leak an unexpected server message to the client.
    return res.status(status).json(status >= 500 ? { error: 'Batch media staging failed', code: 'SERVER_ERROR' } : body);
  }
}
