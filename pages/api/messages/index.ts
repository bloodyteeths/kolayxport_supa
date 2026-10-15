// pages/api/messages/index.ts — messages §6.1. One route for the legacy page (flag off) and the new inbox.
// Normalizers live in lib/messages/normalize.ts; Wix enrichment + read state in lib/messages/inboxCache.ts
// (in-memory until BR-4's `InboxThread` table lands, see the guard there).
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';
import { createTrendyolClient } from '@/lib/integrations/trendyolApiClient';
import { isWixEnabled, isTrendyolEnabled } from '@/lib/config';
import { logger } from '@/lib/logger';
import { createInboxStore, enrichWixContacts } from '@/lib/messages/inboxCache';
import { decodeCursor, encodeCursor, nextTrendyolPage, type InboxCursor } from '@/lib/messages/cursor';
import {
  classifyPlatformError,
  classifyReplyError,
  compareConversations,
  joinLocalOrders,
  matchesFilter,
  normalizeTrendyolQuestion,
  normalizeWixMessage,
  normalizeWixOrder,
  normalizeWixThread,
  newestWixMessage,
  parseListFilter,
  replyErrorStatus,
  sortOrdersNewestFirst,
  trendyolStatusForFilter,
  validateReplyText,
  type LocalOrderRow,
} from '@/lib/messages/normalize';
import {
  LIST_SIZE_DEFAULT,
  LIST_SIZE_MAX,
  ORDER_CONTEXT_LIMIT,
  TRENDYOL_ANSWER_MAX,
  TRENDYOL_ANSWER_MIN,
  TRENDYOL_STATUS,
  WIX_REPLY_MAX,
} from '@/lib/messages/limits';
import type {
  InboxListResponse,
  MessageCountsResponse,
  MessagePlatform,
  PlatformError,
  ProductContext,
  UnifiedConversation,
} from '@/types/messages';

/** Process-wide store (DB once BR-4 is deployed, memory until then). Exported for tests. */
export const inboxStore = createInboxStore(prisma, logger);

const PLATFORMS: readonly MessagePlatform[] = ['wix', 'trendyol'];

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

function errDetail(e: any): string {
  return String(e?.body?.errors?.[0]?.message || e?.body?.rawError || e?.message || (e?.body ? JSON.stringify(e.body) : e) || '');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = str(req.query.action);

  try {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const credential = await prisma.credential.findUnique({ where: { userId: user.id } });
    const wixSite = await prisma.wixSite.findFirst({ where: { userId: user.id, isActive: true } });

    const hasWix = !!(isWixEnabled(user.id) && (wixSite || credential?.wixInstanceId));
    const hasTrendyol = !!(isTrendyolEnabled(user.id) && credential?.trendyolSupplierId);

    const userId = user.id;

    // Helper to build Wix client safely
    function buildWixClient() {
      const wixCred = wixSite
        ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: (wixSite as any).instanceId || credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
        : credential;
      if (!wixCred?.wixInstanceId || !wixCred?.wixSiteId) return null;
      return createWixClient(wixCred, async (creds) => {
        try {
          if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
          if (credential) await prisma.credential.update({ where: { userId }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
        } catch (error: any) {
          logger.warn('Wix token refresh failed', { error: error?.message });
        }
      });
    }

    // ── COUNTS (badge: needs-reply totals) ──────────────
    if (action === 'counts') {
      const counts: MessageCountsResponse = { wix: 0, trendyol: 0, total: 0 };
      const promises: Promise<void>[] = [];

      if (hasTrendyol && credential) {
        promises.push((async () => {
          try {
            const client = createTrendyolClient(credential);
            // Same set as the Needs reply view: waiting questions + rejected answers (§5.2). Rejected is best effort.
            const [waiting, rejected] = await Promise.allSettled([
              client.getQuestions({ status: TRENDYOL_STATUS.waiting, size: 1 }),
              client.getQuestions({ status: TRENDYOL_STATUS.rejected, size: 1 }),
            ]);
            if (waiting.status === 'rejected') throw waiting.reason;
            counts.trendyol = (waiting.value?.totalElements || 0)
              + (rejected.status === 'fulfilled' ? rejected.value?.totalElements || 0 : 0);
            if (rejected.status === 'rejected') logger.warn(`[MESSAGES] Trendyol rejected count failed: ${rejected.reason?.message || rejected.reason}`);
          } catch (e: any) {
            logger.warn(`[MESSAGES] Trendyol count failed: ${e?.message || e}`);
          }
        })());
      }

      // Wix: read the inbox cache (filled by `list`), never the Wix API on a badge poll (§9).
      if (hasWix) {
        promises.push((async () => {
          try {
            counts.wix = await inboxStore.countNeedsReply(userId, 'wix');
          } catch (e: any) {
            logger.warn(`[MESSAGES] Wix count failed: ${e?.message || e}`);
          }
        })());
      }

      await Promise.allSettled(promises);
      counts.total = counts.wix + counts.trendyol;
      return res.status(200).json(counts);
    }

    // ── LIST CONVERSATIONS ──────────────────────────────
    if (action === 'list' && req.method === 'GET') {
      const platform = str(req.query.platform) || 'all';
      const filter = parseListFilter(str(req.query.view) || undefined, str(req.query.status) || undefined);
      const size = Math.min(LIST_SIZE_MAX, Math.max(1, parseInt(str(req.query.size), 10) || LIST_SIZE_DEFAULT));

      let cursor: InboxCursor;
      if (str(req.query.cursor)) {
        const decoded = decodeCursor(str(req.query.cursor));
        if (!decoded) return res.status(400).json({ error: 'Invalid cursor', code: 'badCursor' });
        cursor = decoded;
      } else {
        // Legacy `page` (Trendyol page number) still works; Wix starts at its first contacts page.
        cursor = { t: Math.max(0, parseInt(str(req.query.page), 10) || 0), w: '' };
      }

      const wantTrendyol = hasTrendyol && !!credential && (platform === 'all' || platform === 'trendyol');
      const wantWix = hasWix && (platform === 'all' || platform === 'wix');

      const conversations: UnifiedConversation[] = [];
      const errors: string[] = [];
      const platformErrors: PlatformError[] = [];
      const enabledPlatforms: MessagePlatform[] = [];
      const next: InboxCursor = { t: null, w: null };
      const promises: Promise<void>[] = [];

      if (wantTrendyol) {
        enabledPlatforms.push('trendyol');
        const page = cursor.t;
        if (page !== null) {
          promises.push((async () => {
            try {
              const client = createTrendyolClient(credential!);
              const data = await client.getQuestions({ status: trendyolStatusForFilter(filter), page, size });
              const content: any[] = [...(data.content || [])];
              next.t = nextTrendyolPage(page, data.totalPages, (data.content || []).length, size);

              // Needs-reply views also list rejected answers (they need a new answer). First page only, best effort.
              if (page === 0 && (filter === 'needs_reply' || filter === 'unread' || filter === 'unanswered')) {
                try {
                  const rejected = await client.getQuestions({ status: TRENDYOL_STATUS.rejected, page: 0, size });
                  content.push(...(rejected.content || []));
                } catch (e: any) {
                  logger.warn(`[MESSAGES] Trendyol rejected list failed: ${e?.status || ''} ${e?.message || ''}`.trim());
                }
              }

              const seen = new Set<string>();
              const unique = content.filter((q) => { const id = String(q?.id ?? ''); if (!id || seen.has(id)) return false; seen.add(id); return true; });
              const readRows = await inboxStore.findByExternalIds(userId, 'trendyol', unique.map((q) => String(q.id)));
              const lastSeen = new Map(readRows.map((r) => [r.externalId, r.lastSeenAt]));
              conversations.push(...unique.map((q) => normalizeTrendyolQuestion(q, lastSeen.get(String(q.id)) ?? null)));
            } catch (e: any) {
              const msg = errDetail(e);
              logger.warn(`[MESSAGES] Trendyol list failed: ${e?.status || ''} ${msg}`.trim());
              const detail = `Trendyol: ${e?.status || ''} ${msg}`.trim();
              const code = classifyPlatformError(e);
              errors.push(detail);
              platformErrors.push({ platform: 'trendyol', code, detail });
              // Transient failure: keep this page in the cursor so "Load more" retries it instead of
              // treating Trendyol as exhausted. Auth/permission errors end pagination (retrying can't help).
              if (code === 'rateLimited' || code === 'unavailable') next.t = page;
            }
          })());
        }
      }

      if (wantWix) {
        enabledPlatforms.push('wix');
        const wixCursor = cursor.w;
        if (wixCursor !== null) {
          promises.push((async () => {
            try {
              const client = buildWixClient();
              if (!client) {
                const detail = 'Wix: credentials incomplete';
                errors.push(detail);
                platformErrors.push({ platform: 'wix', code: 'credentials', detail });
                return;
              }
              const contactsData = await client.queryContacts({ limit: size, cursor: wixCursor || undefined });
              const contacts: any[] = contactsData?.contacts || [];
              const nextW = contactsData?.pagingMetadata?.cursors?.next;
              next.w = typeof nextW === 'string' && nextW && contactsData?.pagingMetadata?.hasNext !== false ? nextW : null;

              const { rows, failures, failureCode } = await enrichWixContacts({ client, store: inboxStore, userId, contacts });
              conversations.push(...rows.map(({ row, contact }) => normalizeWixThread(row, contact)));
              if (failures > 0 && failureCode) {
                // Non-fatal: some contacts were skipped (or shown from a stale cache row). Surfacing it keeps
                // the platform's previous rows listed on the client and shows the retry banner.
                const detail = `Wix: ${failures} of ${contacts.length} conversations could not be loaded`;
                logger.warn(`[MESSAGES] ${detail}`, { code: failureCode });
                errors.push(detail);
                platformErrors.push({ platform: 'wix', code: failureCode, detail, partial: true });
              }
            } catch (e: any) {
              const msg = e?.message || String(e);
              logger.warn(`[MESSAGES] Wix list failed: ${msg}`);
              const code = classifyPlatformError(e);
              // Developer detail only (logs / tooltip); the UI shows i18n copy keyed by `code`.
              const detail = code === 'permission'
                ? 'Wix: Inbox permission missing (403) — app version lacks Inbox scope; reinstall required'
                : `Wix: ${msg}`;
              errors.push(detail);
              platformErrors.push({ platform: 'wix', code, detail });
              // Transient failure: retry the same Wix page on "Load more" (see Trendyol above).
              if (code === 'rateLimited' || code === 'unavailable') next.w = wixCursor;
            }
          })());
        }
      }

      await Promise.allSettled(promises);

      const list = conversations.filter((c) => matchesFilter(c, filter)).sort(compareConversations);

      // Per-platform errors are always returned (not only when the list is empty), so a
      // failing platform is visible even while the other one still shows conversations.
      const response: InboxListResponse = {
        conversations: list,
        totalCount: list.length,
        unansweredCount: list.filter((c) => c.needsReply).length,
        page: cursor.t ?? 0,
        pageSize: size,
        nextCursor: encodeCursor(next),
        enabledPlatforms,
        errors,
        platformErrors,
        fetchedAt: new Date().toISOString(),
        readStateStore: inboxStore.kind,
      };

      return res.status(200).json(response);
    }

    // ── GET THREAD ──────────────────────────────────────
    if (action === 'thread' && req.method === 'GET') {
      const platform = str(req.query.platform);
      const conversationId = str(req.query.conversationId);
      if (!platform || !conversationId) {
        return res.status(400).json({ error: 'platform and conversationId are required' });
      }

      if (platform === 'trendyol') {
        if (!credential?.trendyolSupplierId) return res.status(400).json({ error: 'Trendyol credentials not configured' });
        const client = createTrendyolClient(credential);
        const data = await client.getQuestions({ size: 50 });
        const question = (data.content || []).find((q: any) => String(q.id) === conversationId);
        if (!question) return res.status(404).json({ error: 'Question not found' });
        const [row] = await inboxStore.findByExternalIds(userId, 'trendyol', [conversationId]);
        return res.status(200).json(normalizeTrendyolQuestion(question, row?.lastSeenAt ?? null));
      }

      if (platform === 'wix') {
        const client = buildWixClient();
        if (!client) return res.status(400).json({ error: 'Wix credentials not configured' });

        const msgData = await client.getConversationMessages(conversationId);
        const raw: any[] = msgData?.messages || [];
        const messages = raw.map(normalizeWixMessage);

        // Keep the cache row in step with what the seller just saw (never creates a partial row).
        const newest = newestWixMessage(raw);
        if (newest.count > 0) {
          await inboxStore.updateExisting(userId, 'wix', conversationId, {
            lastMessageAt: newest.at ? new Date(newest.at) : null,
            lastMessageText: newest.text,
            lastFromCustomer: newest.fromCustomer,
            needsReply: newest.fromCustomer === true,
            messageCount: newest.count,
          });
        }

        return res.status(200).json({
          id: conversationId,
          platform: 'wix',
          // The API returns newest first; the thread renders oldest first.
          messages: messages.reverse(),
        });
      }

      return res.status(400).json({ error: 'Invalid platform' });
    }

    // ── REPLY ───────────────────────────────────────────
    if (action === 'reply' && req.method === 'POST') {
      const { platform, conversationId, questionId } = req.body || {};
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      if (!platform || !text.trim()) {
        return res.status(400).json({ error: 'platform and text are required' });
      }
      if (platform !== 'trendyol' && platform !== 'wix') return res.status(400).json({ error: 'Invalid platform' });

      const invalid = validateReplyText(platform, text) || (platform === 'wix' && text.length > WIX_REPLY_MAX ? 'tooLong' : null);
      if (invalid) {
        return res.status(400).json({
          error: invalid === 'tooShort' ? 'Answer is too short' : 'Answer is too long',
          code: invalid,
          min: platform === 'trendyol' ? TRENDYOL_ANSWER_MIN : 1,
          max: platform === 'trendyol' ? TRENDYOL_ANSWER_MAX : WIX_REPLY_MAX,
        });
      }

      const now = new Date();
      try {
        if (platform === 'trendyol') {
          if (!questionId) return res.status(400).json({ error: 'questionId is required for Trendyol' });
          if (!credential?.trendyolSupplierId) return res.status(400).json({ error: 'Trendyol credentials not configured', code: 'auth' });
          const client = createTrendyolClient(credential);
          const data = await client.answerQuestion(String(questionId), text);
          await inboxStore.upsert(userId, 'trendyol', String(questionId), {
            needsReply: false, lastFromCustomer: false, lastMessageAt: now, lastSeenAt: now,
          }).catch(() => undefined);
          return res.status(200).json(data);
        }

        if (!conversationId) return res.status(400).json({ error: 'conversationId is required for Wix' });
        const client = buildWixClient();
        if (!client) return res.status(400).json({ error: 'Wix credentials not configured', code: 'auth' });
        const data = await client.sendMessage(String(conversationId), { text });
        await inboxStore.upsert(userId, 'wix', String(conversationId), {
          needsReply: false, lastFromCustomer: false, lastMessageAt: now, lastSeenAt: now, lastMessageText: text,
        }).catch(() => undefined);
        return res.status(200).json(data);
      } catch (e: any) {
        const code = classifyReplyError(e);
        // No message text in logs (PII).
        logger.warn(`[MESSAGES] ${platform} reply failed`, { code, status: e?.status });
        return res.status(replyErrorStatus(code)).json({ error: errDetail(e) || 'Reply failed', code });
      }
    }

    // ── MARK SEEN (read state) ──────────────────────────
    if (action === 'markSeen' && req.method === 'POST') {
      const { platform, id } = req.body || {};
      const seen = req.body?.seen !== false;
      if (!PLATFORMS.includes(platform) || typeof id !== 'string' || !id) {
        return res.status(400).json({ error: 'platform and id are required' });
      }
      await inboxStore.upsert(userId, platform, id, { lastSeenAt: seen ? new Date() : null });
      return res.status(204).end();
    }

    // ── PRODUCT CONTEXT (Trendyol, local DB only) ───────
    if (action === 'productContext' && req.method === 'GET') {
      const productMainId = str(req.query.productMainId);
      if (!productMainId) return res.status(400).json({ error: 'productMainId is required' });
      const p = await prisma.trendyolProduct.findFirst({
        where: { userId, productMainId },
        select: { title: true, barcode: true, salePrice: true, currencyType: true, quantity: true, onSale: true, thumbnailUrl: true },
      });
      const body: ProductContext = p
        ? {
          productMainId,
          inCatalog: true,
          title: p.title,
          barcode: p.barcode,
          salePrice: p.salePrice == null ? null : Number(p.salePrice),
          currency: p.currencyType,
          quantity: p.quantity ?? null,
          onSale: p.onSale,
          thumbnailUrl: p.thumbnailUrl ?? null,
        }
        : { productMainId, inCatalog: false };
      return res.status(200).json(body);
    }

    // ── ORDER CONTEXT (Wix: customer's recent orders) ──
    if (action === 'orderContext' && req.method === 'GET') {
      const contactId = str(req.query.contactId);
      if (!contactId) return res.status(400).json({ error: 'contactId is required' });

      const client = buildWixClient();
      if (!client) return res.status(400).json({ error: 'Wix credentials not configured', code: 'credentials' });

      let orders;
      try {
        const data = await client.searchOrders({ contactId, limit: ORDER_CONTEXT_LIMIT });
        orders = sortOrdersNewestFirst((data.orders || []).map(normalizeWixOrder));
      } catch (e: any) {
        const code = classifyPlatformError(e);
        logger.warn(`[MESSAGES] Order context failed: ${e?.message || e}`, { code });
        // D9: an error is not "no orders".
        return res.status(502).json({ error: 'Could not load Wix orders', code });
      }

      // Local join (kxOrderId, tracking, ship-by). VERIFY: Wix order.number === Order.orderNumber (lib/mappers/wix.ts).
      const numbers = orders.map((o) => o.orderNumber).filter(Boolean);
      if (numbers.length > 0) {
        try {
          const local = await prisma.order.findMany({
            where: { userId, marketplace: 'Wix', orderNumber: { in: numbers } },
            select: { id: true, orderNumber: true, trackingNumber: true, shipByAt: true, items: { select: { shipBy: true } } },
          });
          orders = joinLocalOrders(orders, local as LocalOrderRow[]);
        } catch (e: any) {
          logger.warn(`[MESSAGES] Order context local join failed: ${e?.message || e}`);
        }
        await inboxStore.updateByContact(userId, 'wix', contactId, { lastOrderNumber: orders[0].orderNumber }).catch(() => undefined);
      }

      return res.status(200).json({ orders });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error: any) {
    logger.error('[MESSAGES] Error', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
