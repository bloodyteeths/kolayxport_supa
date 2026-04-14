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

  if (isAnswered && q.answers?.length > 0) {
    const answer = q.answers[0];
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
    customerName: q.customerFirstName || 'Müşteri',
    subject: q.productName || '',
    lastMessageText: q.text || '',
    lastMessageDate: q.creationDate ? new Date(q.creationDate).toISOString() : new Date().toISOString(),
    productInfo: q.productMainId ? {
      id: q.productMainId,
      title: q.productName || '',
      imageUrl: q.productImageUrl,
    } : undefined,
    unreadCount: isAnswered ? 0 : 1,
    messages,
  };
}

function normalizeWixConversation(conv: any): UnifiedConversation {
  const lastMessage = conv.latestMessage || {};
  const participant = conv.participants?.find((p: any) => p.type === 'CONTACT') || {};

  // A conversation is unanswered if the last message was from the customer
  const lastDirection = lastMessage.direction || lastMessage.sender?.role;
  const isUnanswered = lastDirection === 'CUSTOMER_TO_BUSINESS' || lastDirection === 'VISITOR';

  return {
    id: conv.id,
    platform: 'wix',
    status: isUnanswered ? 'unanswered' : 'answered',
    customerName: participant.name || conv.displayName || 'Customer',
    subject: conv.displayName || '',
    lastMessageText: lastMessage.text || lastMessage.preview || '',
    lastMessageDate: lastMessage.date || conv.lastActivityDate || new Date().toISOString(),
    unreadCount: conv.unreadCount || 0,
    messages: [], // populated only when viewing thread
  };
}

function normalizeWixMessage(msg: any): UnifiedMessage {
  const isSeller = msg.direction === 'BUSINESS_TO_CUSTOMER' || msg.sender?.role === 'BUSINESS';
  return {
    id: msg.id || msg.sequence?.toString() || '',
    sender: isSeller ? 'seller' : 'customer',
    text: msg.text || msg.content?.text || '',
    date: msg.date || msg.createdDate || new Date().toISOString(),
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

    // ── COUNTS (lightweight, for badge) ─────────────────
    if (action === 'counts') {
      const counts: MessageCountsResponse = { wix: 0, trendyol: 0, total: 0 };

      const promises: Promise<void>[] = [];

      if (hasTrendyol) {
        promises.push(
          (async () => {
            try {
              const client = createTrendyolClient(credential!);
              const data = await client.getQuestions({ status: 'WAITING_FOR_ANSWER', size: 1 });
              counts.trendyol = data.totalElements || 0;
            } catch (e) {
              logger.warn('[MESSAGES] Trendyol count failed');
            }
          })()
        );
      }

      if (hasWix) {
        promises.push(
          (async () => {
            try {
              const wixCred = wixSite
                ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
                : credential;
              const client = createWixClient(wixCred!, async (creds) => {
                try {
                  if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
                  await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
                } catch {}
              });
              const data = await client.listConversations({ limit: 50 });
              const conversations = data.conversations || [];
              counts.wix = conversations.filter((c: any) => {
                const dir = c.latestMessage?.direction || c.latestMessage?.sender?.role;
                return dir === 'CUSTOMER_TO_BUSINESS' || dir === 'VISITOR';
              }).length;
            } catch (e) {
              logger.warn('[MESSAGES] Wix count failed');
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
      const promises: Promise<void>[] = [];

      if (hasTrendyol && (platform === 'all' || platform === 'trendyol')) {
        promises.push(
          (async () => {
            try {
              const client = createTrendyolClient(credential!);
              const trendyolStatus = status === 'unanswered' ? 'WAITING_FOR_ANSWER' : status === 'answered' ? 'ANSWERED' : undefined;
              const data = await client.getQuestions({ status: trendyolStatus, page, size });
              const normalized = (data.content || []).map(normalizeTrendyolQuestion);
              allConversations.push(...normalized);
            } catch (e) {
              logger.warn('[MESSAGES] Trendyol list failed');
            }
          })()
        );
      }

      if (hasWix && (platform === 'all' || platform === 'wix')) {
        promises.push(
          (async () => {
            try {
              const wixCred = wixSite
                ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
                : credential;
              const client = createWixClient(wixCred!, async (creds) => {
                try {
                  if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
                  await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
                } catch {}
              });
              const data = await client.listConversations({ limit: size });
              const normalized = (data.conversations || []).map(normalizeWixConversation);
              allConversations.push(...normalized);
            } catch (e) {
              logger.warn('[MESSAGES] Wix list failed');
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

      const response: MessagesListResponse = {
        conversations: allConversations,
        totalCount: allConversations.length,
        unansweredCount,
        page,
        pageSize: size,
      };

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
        // Trendyol questions are already fully loaded in list, return as-is
        const client = createTrendyolClient(credential!);
        const data = await client.getQuestions({ size: 50 });
        const question = (data.content || []).find((q: any) => String(q.id) === conversationId);
        if (!question) return res.status(404).json({ error: 'Question not found' });
        return res.status(200).json(normalizeTrendyolQuestion(question));
      }

      if (platform === 'wix') {
        const wixCred = wixSite
          ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
          : credential;
        const client = createWixClient(wixCred!, async (creds) => {
          try {
            if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
            await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
          } catch {}
        });

        const msgData = await client.getConversationMessages(conversationId, { limit: 100 });
        const messages = (msgData.messages || []).map(normalizeWixMessage);

        // Also mark as read
        try { await client.markAsRead(conversationId); } catch {}

        return res.status(200).json({
          id: conversationId,
          platform: 'wix',
          messages: messages.reverse(), // oldest first
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
        const client = createTrendyolClient(credential!);
        const data = await client.answerQuestion(questionId, text);
        return res.status(200).json(data);
      }

      if (platform === 'wix') {
        if (!conversationId) return res.status(400).json({ error: 'conversationId is required for Wix' });
        const wixCred = wixSite
          ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
          : credential;
        const client = createWixClient(wixCred!, async (creds) => {
          try {
            if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
            await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
          } catch {}
        });
        const data = await client.sendMessage(conversationId, { text });
        return res.status(200).json(data);
      }

      return res.status(400).json({ error: 'Invalid platform' });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error: any) {
    logger.error('[MESSAGES] Error', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
