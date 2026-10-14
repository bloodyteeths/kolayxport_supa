import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { stockAuth, fail, serverError, int, ownedItem, ownedLink } from '@/lib/stock/api';
import { confirmGroup, StockOwnershipError, assertMembersOwned, type LinkMemberInput } from '@/lib/stock/seed';
import { enqueuePushes, manualAdjust } from '@/lib/stock/engine';
import { directionForMaxChange, directionWhenLargerLowers, reasonForTargetEdit } from '@/lib/stock/math';
import { getAdapter } from '@/lib/stock/adapters';
import { normalizeSku } from '@/lib/stock/normalize';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 300 };

const MAX_GROUPS = 300;

function parseMember(m: any): LinkMemberInput | null {
  if (!m || typeof m !== 'object') return null;
  const channel = String(m.channel || '');
  if (!getAdapter(channel)) return null;
  const accountRef = String(m.accountRef || '').slice(0, 100);
  const externalId = String(m.externalId || '').slice(0, 200);
  if (!accountRef || !externalId) return null;
  return {
    channel,
    accountRef,
    externalId,
    variantRef: m.variantRef === undefined || m.variantRef === null ? '' : String(m.variantRef).slice(0, 100),
    variantValueKey: m.variantValueKey ? String(m.variantValueKey).slice(0, 100) : null,
    remoteSku: m.sku ?? m.remoteSku ? String(m.sku ?? m.remoteSku).slice(0, 200) : null,
    title: m.title ? String(m.title).slice(0, 300) : null,
    matchType: ['auto_exact', 'suggested_loose', 'manual'].includes(m.matchType) ? m.matchType : 'manual',
  };
}

/**
 * POST /api/stock/links { action, ... }
 *   confirm      { groups: [{ sku, title?, imageUrl?, members: [...], seedQty?, needsReview? }] }
 *   link         { stockItemId | sku, member }            (account ownership validated)
 *   accept       { linkId }                               (a 'suggested' link -> active)
 *   unlink       { linkId }
 *   pause/resume { linkId }
 *   adopt_remote { observationId }                        (one-tap adopt of a marketplace increase)
 *   set_units    { linkId, value 1..1000 }
 *   set_buffer   { linkId, value 0..100000 }
 *   set_max      { linkId, value | null }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['POST']);
  if (!userId) return;
  const body = (req.body || {}) as Record<string, any>;
  const actor = `user:${userId}`;
  try {
    switch (body.action) {
      case 'confirm': {
        const groups = Array.isArray(body.groups) ? body.groups.slice(0, MAX_GROUPS) : [];
        if (!groups.length) return fail(res, 400, 'no_groups');
        const results: any[] = [];
        for (const g of groups) {
          const members = (Array.isArray(g?.members) ? g.members : []).map(parseMember).filter(Boolean) as LinkMemberInput[];
          if (!normalizeSku(g?.sku) || !members.length) {
            results.push({ sku: g?.sku ?? null, error: 'invalid_group' });
            continue;
          }
          const seedQty = g.seedQty === null || g.seedQty === undefined ? null : int(g.seedQty, 0, 1_000_000);
          try {
            results.push({ sku: g.sku, ...(await confirmGroup(userId, { sku: g.sku, title: g.title, imageUrl: g.imageUrl, members, seedQty, needsReview: !!g.needsReview }, actor)) });
          } catch (err) {
            results.push({ sku: g.sku, error: err instanceof StockOwnershipError ? 'account_not_owned' : 'failed' });
          }
        }
        return res.status(200).json({ results });
      }
      case 'link': {
        const member = parseMember(body.member);
        if (!member) return fail(res, 400, 'invalid_member');
        let sku = body.sku as string | undefined;
        if (body.stockItemId) {
          const item = await ownedItem(userId, body.stockItemId);
          if (!item) return fail(res, 404, 'not_found');
          sku = item.displaySku;
        }
        if (!normalizeSku(sku)) return fail(res, 400, 'invalid_sku');
        try {
          const r = await confirmGroup(userId, { sku: sku!, title: member.title, members: [{ ...member, matchType: 'manual' }] }, actor);
          return res.status(200).json(r);
        } catch (err) {
          if (err instanceof StockOwnershipError) return fail(res, 403, 'account_not_owned');
          throw err;
        }
      }
      case 'accept': {
        const link = await ownedLink(userId, body.linkId);
        if (!link) return fail(res, 404, 'not_found');
        try {
          await assertMembersOwned(userId, [{ channel: link.channel, accountRef: link.accountRef, externalId: link.externalId }]);
        } catch {
          return fail(res, 403, 'account_not_owned');
        }
        const supports = !!getAdapter(link.channel)?.supportsWrite;
        await prisma.stockLink.update({ where: { id: link.id }, data: { status: supports ? 'active' : 'unsupported', confirmedAt: new Date(), lastSeenRemoteQty: null, lastSeenRemoteTs: null } });
        await enqueuePushes(link.stockItemId, 'manual', { onlyLinkIds: [link.id] });
        return res.status(200).json({ ok: true });
      }
      case 'unlink': {
        const link = await ownedLink(userId, body.linkId);
        if (!link) return fail(res, 404, 'not_found');
        await prisma.stockPush.updateMany({ where: { linkId: link.id, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'unlinked' } });
        await prisma.stockLink.delete({ where: { id: link.id } });
        return res.status(200).json({ ok: true });
      }
      case 'pause':
      case 'resume': {
        const link = await ownedLink(userId, body.linkId);
        if (!link) return fail(res, 404, 'not_found');
        if (body.action === 'pause') {
          await prisma.stockLink.update({ where: { id: link.id }, data: { status: 'paused', statusReason: 'user' } });
          await prisma.stockPush.updateMany({ where: { linkId: link.id, status: 'pending' }, data: { status: 'superseded', pendingKey: null, lastError: 'paused' } });
        } else {
          try {
            await assertMembersOwned(userId, [{ channel: link.channel, accountRef: link.accountRef, externalId: link.externalId }]);
          } catch {
            return fail(res, 403, 'account_not_owned');
          }
          // Re-baseline: whatever the marketplace shows now is not a "drop".
          await prisma.stockLink.update({ where: { id: link.id }, data: { status: 'active', statusReason: null, lastSeenRemoteQty: null, lastSeenRemoteTs: null, unattributedDrop: 0, unattributedDropSince: null } });
          await enqueuePushes(link.stockItemId, 'manual', { onlyLinkIds: [link.id] });
        }
        return res.status(200).json({ ok: true });
      }
      case 'adopt_remote': {
        if (typeof body.observationId !== 'string') return fail(res, 400, 'invalid_observation');
        const obs = await prisma.stockObservation.findFirst({ where: { id: body.observationId, userId, kind: 'increase_alert' } });
        if (!obs || obs.delta === null || obs.delta <= 0) return fail(res, 404, 'not_found');
        const link = await ownedLink(userId, obs.linkId);
        if (!link) return fail(res, 404, 'not_found');
        const out = await manualAdjust({
          userId,
          stockItemId: link.stockItemId,
          delta: obs.delta * Math.max(1, link.unitsPerSale),
          actor,
          note: 'adopt_remote',
          idempotencyKey: `adopt:${obs.id}`,
          linkId: link.id,
          channel: link.channel,
        });
        return res.status(200).json({ ok: true, status: out.status, onHand: out.onHandAfter ?? null });
      }
      case 'set_units':
      case 'set_buffer':
      case 'set_max': {
        const link = await ownedLink(userId, body.linkId);
        if (!link) return fail(res, 404, 'not_found');
        const data: Record<string, unknown> = {};
        if (body.action === 'set_units') {
          const v = int(body.value, 1, 1000);
          if (v === null) return fail(res, 400, 'invalid_value');
          data.unitsPerSale = v;
        } else if (body.action === 'set_buffer') {
          const v = int(body.value, 0, 100000);
          if (v === null) return fail(res, 400, 'invalid_value');
          data.buffer = v;
        } else {
          const v = body.value === null || body.value === '' ? null : int(body.value, 0, 1_000_000);
          if (v === null && body.value !== null && body.value !== '') return fail(res, 400, 'invalid_value');
          data.maxListedQty = v;
        }
        await prisma.stockLink.update({ where: { id: link.id }, data });
        // Only an edit that can raise the target may raise the remote ('adjust');
        // one that can only lower it pushes lower-only ('reconcile').
        const direction =
          body.action === 'set_units'
            ? directionWhenLargerLowers(link.unitsPerSale, data.unitsPerSale as number)
            : body.action === 'set_buffer'
              ? directionWhenLargerLowers(link.buffer, data.buffer as number)
              : directionForMaxChange(link.maxListedQty, data.maxListedQty as number | null);
        const reason = reasonForTargetEdit(direction);
        if (reason) await enqueuePushes(link.stockItemId, reason, { onlyLinkIds: [link.id] });
        return res.status(200).json({ ok: true });
      }
      default:
        return fail(res, 400, 'invalid_action');
    }
  } catch (err) {
    return serverError(res, 'links', err, userId);
  }
}
