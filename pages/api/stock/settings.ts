import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError } from '@/lib/stock/api';
import { getStockSettings, sanitizeSettingsPatch, serializeSettings, updateStockSettings } from '@/lib/stock/settings';
import { enableStockSync, disableStockSync } from '@/lib/stock/seed';
import { goLive } from '@/lib/stock/goLive';
import { listChannelAccounts } from '@/lib/stock/candidates';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 300 };

/**
 * GET  /api/stock/settings -> { settings, channels, counts }
 * PUT  /api/stock/settings
 *   { ...patch }                                   edit options
 *   { enabled: true, manualQty?: {itemId: qty} }   seed + enable in DRY RUN (no marketplace writes)
 *   { enabled: false }                             turn off
 *   { dryRun: false, confirmToken, typedConfirm? } Go Live (token from POST /api/stock/preview?live=1)
 *   { dryRun: true }                               back to dry run
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET', 'PUT']);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const [settings, channels, items, needsReview, active, suggested] = await Promise.all([
        getStockSettings(userId, { fresh: true }),
        listChannelAccounts(userId),
        prisma.stockItem.count({ where: { userId } }),
        prisma.stockItem.count({ where: { userId, status: 'needs_review' } }),
        prisma.stockLink.count({ where: { userId, status: 'active' } }),
        prisma.stockLink.count({ where: { userId, status: 'suggested' } }),
      ]);
      const failedPushes = await prisma.stockPush.count({ where: { userId, status: 'failed', updatedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
      return res.status(200).json({ settings: serializeSettings(settings), channels, counts: { items, needsReview, activeLinks: active, suggestedLinks: suggested, failedPushes24h: failedPushes } });
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
    const actor = `user:${userId}`;

    if (body.dryRun === false) {
      const r = await goLive(userId, { confirmToken: body.confirmToken, typedConfirm: body.typedConfirm });
      if (!r.ok) return fail(res, r.error === 'not_enabled' ? 409 : 400, r.error);
      return res.status(200).json({ ok: true, snapshotId: r.snapshotId, links: r.links, settings: serializeSettings(await getStockSettings(userId, { fresh: true })) });
    }
    if (body.enabled === true) {
      const manualQty: Record<string, number> = {};
      if (body.manualQty && typeof body.manualQty === 'object') {
        for (const [k, v] of Object.entries(body.manualQty)) {
          const n = Math.trunc(Number(v));
          if (typeof k === 'string' && Number.isFinite(n) && n >= 0 && n <= 1_000_000) manualQty[k] = n;
        }
        const owned = await prisma.stockItem.findMany({ where: { userId, id: { in: Object.keys(manualQty) } }, select: { id: true } });
        const ok = new Set(owned.map((o) => o.id));
        for (const k of Object.keys(manualQty)) if (!ok.has(k)) delete manualQty[k];
      }
      const patch = sanitizeSettingsPatch(body);
      if (Object.keys(patch).length) await updateStockSettings(userId, patch);
      const r = await enableStockSync(userId, { manualQty, actor });
      return res.status(200).json({ ok: true, ...r, settings: serializeSettings(await getStockSettings(userId, { fresh: true })) });
    }
    if (body.enabled === false) {
      await disableStockSync(userId);
      return res.status(200).json({ ok: true, settings: serializeSettings(await getStockSettings(userId, { fresh: true })) });
    }
    if (body.dryRun === true) {
      await updateStockSettings(userId, { dryRun: true });
      await prisma.stockPush.updateMany({ where: { userId, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'back_to_dry_run' } });
      return res.status(200).json({ ok: true, settings: serializeSettings(await getStockSettings(userId, { fresh: true })) });
    }
    const patch = sanitizeSettingsPatch(body);
    if (!Object.keys(patch).length) return fail(res, 400, 'nothing_to_update');
    const row = await updateStockSettings(userId, patch);
    return res.status(200).json({ ok: true, settings: serializeSettings(row) });
  } catch (err) {
    return serverError(res, 'settings', err, userId);
  }
}
