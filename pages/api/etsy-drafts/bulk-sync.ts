import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { syncDraft } from '@/lib/etsy/draftService';
import { BULK_CALLS_PER_DRAFT, EtsyPriority, canSpend, withEtsyBudget } from '@/lib/etsy/rateBudget';
import { isEtsyDraftError } from '@/lib/etsy/draftErrors';

// Parallel bulk send (2026-10-24). Our app key's measured Etsy limits: 150 req/s and 100,000/day, shared by
// every customer (lib/etsy/rateBudget.ts). Each draft send is ~3 Etsy calls. Safety comes from the budget, not
// from a sleep:
//  - every call runs at P4 Bulk with the draft's shop, so the global token bucket (100/s) and Etsy's live
//    x-remaining headers apply, bulk stops while the app has used ≥ 75% of the day, and one shop can't spend
//    more than BULK_SHOP_DAILY_CAP bulk calls a day;
//  - BULK_CONCURRENCY drafts in flight (≈ 25–30 req/s for one shop);
//  - a draft the shop's budget can't cover today is not sent and not failed: it is scheduled for the next daily
//    window (scheduledSendAt) and the scheduled-send job picks it up.
const BULK_CONCURRENCY = 8;

type DraftResult = {
  draftId: string;
  status: string;
  reason?: string;
  count?: number;
  error?: string;
  code?: string;
  key?: string;
  warnings?: any[];
};

const MAX_BULK_DRAFTS = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (draftIds.length === 0) return res.status(400).json({ error: 'draftIds is required' });
  if (draftIds.length > MAX_BULK_DRAFTS) return res.status(400).json({ error: `At most ${MAX_BULK_DRAFTS} drafts per bulk sync` });
  // Explicit opt-in to overwrite listings that changed on Etsy (default false:
  // such drafts come back as 'conflict' and are left untouched).
  const force = req.body?.force === true;

  const ids = draftIds.map(String);
  const shops = new Map((await prisma.etsyListingDraft.findMany({ where: { id: { in: ids }, userId: user.id }, select: { id: true, etsyShopId: true } }))
    .map((d) => [d.id, d.etsyShopId ? String(d.etsyShopId) : undefined]));
  const out: Array<DraftResult | undefined> = new Array(ids.length);
  const deferred: Array<{ draftId: string; retryAfterMs: number }> = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < ids.length; i = next++) {
      const draftId = ids[i];
      const shopId = shops.get(draftId);
      const gate = canSpend(shopId || '', EtsyPriority.Bulk, BULK_CALLS_PER_DRAFT);
      if (!gate.ok) {
        deferred.push({ draftId, retryAfterMs: gate.retryAfterMs ?? 3_600_000 });
        out[i] = { draftId, status: 'deferred', reason: gate.reason || 'budget' };
        continue;
      }
      try {
        out[i] = (await withEtsyBudget({ shopId, userId: user.id, priority: EtsyPriority.Bulk },
          () => syncDraft(draftId, user.id, { force, priority: EtsyPriority.Bulk }))) as DraftResult;
      } catch (err: any) {
        out[i] = {
          draftId,
          status: 'failed',
          error: err?.message || 'Sync failed',
          ...(isEtsyDraftError(err) ? { code: err.code, key: err.key } : {}),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, ids.length) }, worker));
  const results = out.filter(Boolean) as DraftResult[];

  // Over today's budget: schedule for the next daily window instead of failing (lib/drafts/scheduledSend).
  let deferredUntil: string | null = null;
  if (deferred.length) {
    const at = new Date(Date.now() + Math.max(...deferred.map((d) => d.retryAfterMs)) + 5 * 60_000);
    deferredUntil = at.toISOString();
    await prisma.etsyListingDraft.updateMany({ where: { id: { in: deferred.map((d) => d.draftId) }, userId: user.id }, data: { scheduledSendAt: at } });
  }

  const success = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed');
  const conflicts = results.filter((r) => r.status === 'conflict');
  // Drafts with nothing left to send were cancelled without calling Etsy: neither sent nor failed.
  const empty = results.filter((r) => r.status === 'skipped' && r.reason === 'empty');

  return res.status(200).json({
    results,
    success,
    failed: failed.length,
    conflicts: conflicts.length,
    skipped: empty.length,
    // Not sent today because the shop's daily Etsy budget is used up; scheduled for deferredUntil.
    deferred: deferred.length,
    deferredUntil,
    emptyDrafts: empty.map((r) => r.draftId),
    // Surface partial failures so the UI can tell the user *which* drafts to
    // retry instead of showing a single generic error.
    failedDrafts: failed.map((r) => ({ draftId: r.draftId, error: r.error || 'Sync failed' })),
    conflictDrafts: conflicts.map((r) => ({ draftId: r.draftId, error: r.error, code: r.code })),
    partialDrafts: results.filter((r) => r.status === 'success' && r.warnings?.length).map((r) => ({ draftId: r.draftId, warnings: r.warnings })),
  });
}
