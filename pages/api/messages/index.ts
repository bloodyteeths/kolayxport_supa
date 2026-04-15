import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';
import { createTrendyolClient } from '@/lib/integrations/trendyolApiClient';
import { isWixEnabled, isTrendyolEnabled } from '@/lib/config';
import { logger } from '@/lib/logger';
import type { UnifiedConversation, UnifiedMessage, MessagesListResponse, MessageCountsResponse } from '@/types/messages';

// ─── Normalizers ────────────────────────────────────────

function normalizeTrendyolQuestion(q: any): UnifiedConversation {
  const isAnswered = q.status === 'ANSWERED';
  const messages: UnifiedMessage[] = [
    {
      id: `${q.id}-q`,
      sender: 'customer',
      text: q.text || '',
      date: q.creationDate ? new Date(q.creationDate).toISOString() : new Date().toISOString(),
    },
  ];

  // Trendyol Q&A API returns answer as singular object (q.answer), not array
  const answer = q.answer || q.answers?.[0];
  if (isAnswered && answer) {
    messages.push({
      id: `${q.id}-a`,
      sender: 'seller',
      text: answer.text || '',
      date: answer.creationDate ? new Date(answer.creationDate).toISOString() : new Date().toISOString(),
    });
  }

  return {
    id: String(q.id),
    platform: 'trendyol',
    status: isAnswered ? 'answered' : 'unanswered',
    customerName: q.customerFirstName || q.userName || 'Müşteri',
    subject: q.productName || '',
    lastMessageText: q.text || '',
    lastMessageDate: q.creationDate ? new Date(q.creationDate).toISOString() : new Date().toISOString(),
    productInfo: q.productMainId ? {
      id: q.productMainId,
      title: q.productName || '',
      imageUrl: q.imageUrl,
      webUrl: q.webUrl,
    } : undefined,
    unreadCount: isAnswered ? 0 : 1,
    messages,
  };
}

function normalizeWixConversation(conv: any): UnifiedConversation {
  const lastMessage = conv.latestMessage || conv.lastMessage || {};

  // A conversation is unanswered if the last message was from the customer
  const lastDirection = lastMessage.direction || lastMessage.sender?.role;
  const isUnanswered = lastDirection === 'PARTICIPANT_TO_BUSINESS' || lastDirection === 'CUSTOMER_TO_BUSINESS' || lastDirection === 'VISITOR';

  // _contactName is injected by our listConversations workaround
  const customerName = conv._contactName || conv.participantDisplayData?.name || conv.displayName || 'Customer';

  return {
    id: conv.id,
    platform: 'wix',
    status: isUnanswered ? 'unanswered' : 'answered',
    customerName,
    contactId: conv._contactId,
    subject: customerName,
    lastMessageText: lastMessage.content?.previewText || lastMessage.content?.basic?.items?.[0]?.text || lastMessage.text || lastMessage.preview || lastMessage.content?.text || '',
    lastMessageDate: lastMessage.createdDate || lastMessage.date || conv.lastActivityDate || conv.createdDate || new Date().toISOString(),
    unreadCount: conv.unreadCount || 0,
    messages: [],
  };
}

function normalizeWixMessage(msg: any): UnifiedMessage {
  const isSeller = msg.direction === 'BUSINESS_TO_PARTICIPANT' || msg.direction === 'BUSINESS_TO_CUSTOMER' || msg.sender?.role === 'BUSINESS';
  const text = msg.content?.previewText
    || msg.content?.basic?.items?.[0]?.text
    || msg.content?.text
    || msg.text
    || '';
  return {
    id: msg.id || msg.sequence?.toString() || '',
    sender: isSeller ? 'seller' : 'customer',
    text,
    date: msg.createdDate || msg.date || new Date().toISOString(),
  };
}

// ─── Handler ────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const credential = await prisma.credential.findUnique({ where: { userId: user.id } });
    const wixSite = await prisma.wixSite.findFirst({ where: { userId: user.id, isActive: true } });

    const hasWix = isWixEnabled(user.id) && (wixSite || credential?.wixInstanceId);
    const hasTrendyol = isTrendyolEnabled(user.id) && credential?.trendyolSupplierId;

    const userId = user.id;

    // Helper to build Wix client safely
    function buildWixClient() {
      const wixCred = wixSite
        ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
        : credential;
      if (!wixCred?.wixInstanceId || !wixCred?.wixSiteId) return null;
      return createWixClient(wixCred, async (creds) => {
        try {
          if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
          if (credential) await prisma.credential.update({ where: { userId }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
        } catch {}
      });
    }

    // ── COUNTS (lightweight, for badge) ─────────────────
    if (action === 'counts') {
      const counts: MessageCountsResponse = { wix: 0, trendyol: 0, total: 0 };

      const promises: Promise<void>[] = [];

      if (hasTrendyol && credential) {
        promises.push(
          (async () => {
            try {
              const client = createTrendyolClient(credential);
              const data = await client.getQuestions({ status: 'WAITING_FOR_ANSWER', size: 1 });
              counts.trendyol = data.totalElements || 0;
            } catch (e: any) {
              logger.warn(`[MESSAGES] Trendyol count failed: ${e?.message || e}`);
            }
          })()
        );
      }

      if (hasWix) {
        promises.push(
          (async () => {
            try {
              const client = buildWixClient();
              if (!client) return;
              const data = await client.listConversations({ limit: 50 });
              const conversations = data.conversations || [];
              counts.wix = conversations.filter((c: any) => {
                const dir = c.latestMessage?.direction || c.latestMessage?.sender?.role;
                return dir === 'PARTICIPANT_TO_BUSINESS' || dir === 'CUSTOMER_TO_BUSINESS' || dir === 'VISITOR';
              }).length;
            } catch (e: any) {
              logger.warn(`[MESSAGES] Wix count failed: ${e?.message || e}`);
              // Silently skip — counts badge shouldn't show errors
            }
          })()
        );
      }

      await Promise.allSettled(promises);
      counts.total = counts.wix + counts.trendyol;
      return res.status(200).json(counts);
    }

    // ── LIST CONVERSATIONS ──────────────────────────────
    if (action === 'list' && req.method === 'GET') {
      const platform = req.query.platform as string || 'all';
      const status = req.query.status as string || 'all';
      const page = parseInt(req.query.page as string) || 0;
      const size = parseInt(req.query.size as string) || 20;

      let allConversations: UnifiedConversation[] = [];
      const errors: string[] = [];
      const enabledPlatforms: string[] = [];
      const promises: Promise<void>[] = [];

      if (hasTrendyol && credential && (platform === 'all' || platform === 'trendyol')) {
        enabledPlatforms.push('trendyol');
        promises.push(
          (async () => {
            try {
              const client = createTrendyolClient(credential);
              const trendyolStatus = status === 'unanswered' ? 'WAITING_FOR_ANSWER' : status === 'answered' ? 'ANSWERED' : undefined;
              const data = await client.getQuestions({ status: trendyolStatus, page, size });
              const normalized = (data.content || []).map(normalizeTrendyolQuestion);
              allConversations.push(...normalized);
            } catch (e: any) {
              const msg = e?.message || (e?.body ? JSON.stringify(e.body) : String(e));
              logger.warn(`[MESSAGES] Trendyol list failed: ${msg}`);
              errors.push(`Trendyol: ${e?.status || ''} ${e?.body?.errors?.[0]?.message || e?.body?.rawError || msg}`.trim());
            }
          })()
        );
      }

      if (hasWix && (platform === 'all' || platform === 'wix')) {
        enabledPlatforms.push('wix');
        promises.push(
          (async () => {
            try {
              const client = buildWixClient();
              if (!client) { errors.push('Wix: credentials incomplete'); return; }
              const data = await client.listConversations({ limit: size });
              const normalized = (data.conversations || []).map(normalizeWixConversation);
              allConversations.push(...normalized);
            } catch (e: any) {
              const msg = e?.message || String(e);
              logger.warn(`[MESSAGES] Wix list failed: ${msg}`);
              const is403 = msg.includes('403');
              errors.push(is403
                ? 'Wix: Inbox permission missing — update app version in Wix Dev Center and reinstall'
                : `Wix: ${msg}`);
            }
          })()
        );
      }

      await Promise.allSettled(promises);

      // Filter by status if platform=all (individual platform calls already filter)
      if (status !== 'all' && platform === 'all') {
        allConversations = allConversations.filter(c => c.status === status);
      }

      // Sort by date descending
      allConversations.sort((a, b) => new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime());

      const unansweredCount = allConversations.filter(c => c.status === 'unanswered').length;

      const response: MessagesListResponse & { errors?: string[]; enabledPlatforms?: string[] } = {
        conversations: allConversations,
        totalCount: allConversations.length,
        unansweredCount,
        page,
        pageSize: size,
      };

      // Include diagnostic info so frontend can show why it's empty
      if (allConversations.length === 0) {
        response.enabledPlatforms = enabledPlatforms;
        if (errors.length > 0) response.errors = errors;
      }

      return res.status(200).json(response);
    }

    // ── GET THREAD ──────────────────────────────────────
    if (action === 'thread' && req.method === 'GET') {
      const platform = req.query.platform as string;
      const conversationId = req.query.conversationId as string;
      if (!platform || !conversationId) {
        return res.status(400).json({ error: 'platform and conversationId are required' });
      }

      if (platform === 'trendyol') {
        if (!credential?.trendyolSupplierId) return res.status(400).json({ error: 'Trendyol credentials not configured' });
        const client = createTrendyolClient(credential);
        const data = await client.getQuestions({ size: 50 });
        const question = (data.content || []).find((q: any) => String(q.id) === conversationId);
        if (!question) return res.status(404).json({ error: 'Question not found' });
        return res.status(200).json(normalizeTrendyolQuestion(question));
      }

      if (platform === 'wix') {
        const client = buildWixClient();
        if (!client) return res.status(400).json({ error: 'Wix credentials not configured' });

        const msgData = await client.getConversationMessages(conversationId, { limit: 100 });
        logger.info('[MESSAGES] Wix thread raw', { conversationId, msgCount: msgData?.messages?.length, keys: Object.keys(msgData || {}) });
        const messages = (msgData.messages || []).map(normalizeWixMessage);

        return res.status(200).json({
          id: conversationId,
          platform: 'wix',
          messages: messages.reverse(),
        });
      }

      return res.status(400).json({ error: 'Invalid platform' });
    }

    // ── REPLY ───────────────────────────────────────────
    if (action === 'reply' && req.method === 'POST') {
      const { platform, conversationId, questionId, text } = req.body;
      if (!platform || !text) {
        return res.status(400).json({ error: 'platform and text are required' });
      }

      if (platform === 'trendyol') {
        if (!questionId) return res.status(400).json({ error: 'questionId is required for Trendyol' });
        if (!credential?.trendyolSupplierId) return res.status(400).json({ error: 'Trendyol credentials not configured' });
        const client = createTrendyolClient(credential);
        const data = await client.answerQuestion(questionId, text);
        return res.status(200).json(data);
      }

      if (platform === 'wix') {
        if (!conversationId) return res.status(400).json({ error: 'conversationId is required for Wix' });
        const client = buildWixClient();
        if (!client) return res.status(400).json({ error: 'Wix credentials not configured' });
        const data = await client.sendMessage(conversationId, { text });
        return res.status(200).json(data);
      }

      return res.status(400).json({ error: 'Invalid platform' });
    }

    // ── ORDER CONTEXT (Wix: customer's recent orders) ──
    if (action === 'orderContext' && req.method === 'GET') {
      const contactId = req.query.contactId as string;
      if (!contactId) return res.status(400).json({ error: 'contactId is required' });

      const client = buildWixClient();
      if (!client) return res.status(400).json({ error: 'Wix credentials not configured' });

      try {
        const data = await client.searchOrders({ contactId, limit: 5 });
        const orders = (data.orders || []).map((order: any) => ({
          orderNumber: order.number || order._id,
          status: order.status || order.fulfillmentStatus || 'UNKNOWN',
          createdDate: order._createdDate || order.createdDate || '',
          items: (order.lineItems || []).map((item: any) => ({
            name: item.name || item.productName?.original || '',
            imageUrl: item.image?.url || item.mediaItem?.url,
            price: item.price?.formattedAmount || item.priceData?.price?.toString() || '0',
            quantity: item.quantity || 1,
          })),
          total: order.priceSummary?.total?.formattedAmount || order.totals?.total?.toString() || '0',
          currency: order.currency || order.priceSummary?.total?.currency || 'USD',
        }));
        return res.status(200).json({ orders });
      } catch (e: any) {
        logger.warn(`[MESSAGES] Order context failed: ${e?.message || e}`);
        return res.status(200).json({ orders: [] });
      }
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error: any) {
    logger.error('[MESSAGES] Error', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
