import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';
import { logger } from '@/lib/logger';

async function getAuthAndClient(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return { error: 'Unauthorized', status: 401 };

  const wixSite = await prisma.wixSite.findFirst({
    where: { userId: user.id, isActive: true },
  });

  const cred = await prisma.credential.findUnique({ where: { userId: user.id } });
  const credential = wixSite
    ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: cred?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
    : cred;

  if (!credential?.wixInstanceId || !credential?.wixSiteId) {
    return { error: 'Wix credentials not configured', status: 400 };
  }

  const onTokenRefresh = async (creds: any) => {
    try {
      if (wixSite) {
        await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
      }
      await prisma.credential.update({ where: { userId: user.id }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
    } catch (e) {
      logger.warn('[WIX MESSAGES] Failed to persist refreshed tokens');
    }
  };

  const client = createWixClient(credential, onTokenRefresh);
  return { userId: user.id, client };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const action = req.query.action as string;

  try {
    const auth = await getAuthAndClient(req, res);
    if ('error' in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { client } = auth;

    // ── LIST CONVERSATIONS ──────────────────────────────
    if (action === 'list' && req.method === 'GET') {
      const limit = parseInt(req.query.limit as string) || 20;
      const data = await client.listConversations({ limit });
      return res.status(200).json(data);
    }

    // ── GET MESSAGES FOR CONVERSATION ────────────────────
    if (action === 'messages' && req.method === 'GET') {
      const conversationId = req.query.conversationId as string;
      if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });
      const limit = parseInt(req.query.limit as string) || 50;
      const data = await client.getConversationMessages(conversationId, { limit });
      return res.status(200).json(data);
    }

    // ── SEND REPLY ──────────────────────────────────────
    if (action === 'reply' && req.method === 'POST') {
      const { conversationId, text } = req.body;
      if (!conversationId || !text) return res.status(400).json({ error: 'conversationId and text are required' });
      const data = await client.sendMessage(conversationId, { text });
      return res.status(200).json(data);
    }


    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error: any) {
    logger.error('[WIX MESSAGES] Error', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
