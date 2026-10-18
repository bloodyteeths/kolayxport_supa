// POST /api/messages/draft-reply — messages spec §6.3 (group G2). "Draft with AI" for the inbox composer.
//
// Request  { platform: 'wix' | 'trendyol' | 'hepsiburada', id: string }   (id = Wix conversationId | Trendyol questionId | Hepsiburada issue number)
// 200      { reply: string, missing: ('tracking'|'order'|'stock'|'delivery'|'size'|'policy')[] }
// 400 { code: 'badRequest' | 'credentials' }   401 { code: 'unauthorized' }   405 { code: 'methodNotAllowed' }
// 404 { code: 'notFound' }   409 { code: 'alreadyAnswered' | 'notAnswerable' }   429 { code: 'rateLimited' }
// 422 { code: 'badDraft' }   502 { code: 'unavailable' | 'aiUnavailable' }   503 { code: 'aiNotConfigured' }
//
// The server builds the context itself (never trusts client text), validates Gemini's output, and never
// writes to a marketplace. Logs carry ids, codes and lengths only — never message text (PII).

import { getAiModel, refineFromBody, type AiRefine } from '@/lib/ai/gemini';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createWixClient } from '@/lib/integrations/wixClient';
import { createTrendyolClient } from '@/lib/integrations/trendyolApiClient';
import { isWixEnabled, isTrendyolEnabled, isHepsiburadaEnabled } from '@/lib/config';
import { createHepsiburadaClient } from '@/lib/hepsiburada/client';
import { logger } from '@/lib/logger';
import {
  buildHepsiburadaDraftContext,
  buildTrendyolDraftContext,
  buildWixDraftContext,
  draftFromContext,
  DraftSourceError,
  takeDraftRateLimit,
  type DraftContext,
  type DraftDb,
  type DraftPlatform,
  type DraftReplyErrorCode,
} from '@/lib/messages/draftReply';

const SOURCE_STATUS: Record<DraftSourceError['code'], number> = { notFound: 404, alreadyAnswered: 409, notAnswerable: 409, unavailable: 502 };

function fail(res: NextApiResponse, status: number, code: DraftReplyErrorCode) {
  return res.status(status).json({ code });
}

/** Shared AI client (lib/ai): the seller's preferences for this marketplace, follow-up ("make it shorter"), usage log. */
async function geminiGenerate(prompt: string, ctx: { userId: string; platform: DraftPlatform; refine: AiRefine | null }): Promise<string> {
  // AI preferences have no Hepsiburada key yet (lib/ai/preferences.ts): its drafts use the seller's "all" preferences.
  const marketplace = ctx.platform === 'hepsiburada' ? 'all' : ctx.platform;
  const response = await getAiModel({ feature: `messages.draft_reply.${ctx.platform}`, userId: ctx.userId, marketplace, refine: ctx.refine, temperature: 0.4 }).generateContent(prompt);
  return response.response.text();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'methodNotAllowed');
  }

  try {
    const user = await getAuthUser(req, res);
    if (!user) return fail(res, 401, 'unauthorized');

    const platform = req.body?.platform;
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if ((platform !== 'wix' && platform !== 'trendyol' && platform !== 'hepsiburada') || !id || id.length > 200) return fail(res, 400, 'badRequest');

    if (!takeDraftRateLimit(user.id)) return fail(res, 429, 'rateLimited');
    if (!process.env.GEMINI_API_KEY) return fail(res, 503, 'aiNotConfigured');

    const userId = user.id;
    const db = prisma as unknown as DraftDb;
    const credential = await prisma.credential.findUnique({ where: { userId } });
    let ctx: DraftContext;

    try {
      if (platform === 'trendyol') {
        // Same three fields createTrendyolClient requires; a missing key/secret is a setup problem (400), not an outage.
        if (!isTrendyolEnabled(userId) || !credential?.trendyolSupplierId || !credential.trendyolApiKey || !credential.trendyolApiSecret) {
          return fail(res, 400, 'credentials');
        }
        ctx = await buildTrendyolDraftContext({
          userId, questionId: id, trendyol: createTrendyolClient(credential), db, shopName: null,
        });
      } else if (platform === 'hepsiburada') {
        const hb = isHepsiburadaEnabled(userId) ? createHepsiburadaClient(credential) : null;
        if (!hb) return fail(res, 400, 'credentials');
        ctx = await buildHepsiburadaDraftContext({ userId, issueNumber: id, hepsiburada: hb, db, shopName: null });
      } else {
        const wixSite = await prisma.wixSite.findFirst({ where: { userId, isActive: true } });
        const wixCred = wixSite
          ? { wixAccessToken: wixSite.accessToken, wixSiteId: wixSite.siteId, wixInstanceId: wixSite.instanceId || credential?.wixInstanceId || wixSite.siteId, wixTokenExpiresAt: wixSite.tokenExpiresAt }
          : credential;
        if (!isWixEnabled(userId) || !wixCred?.wixInstanceId || !wixCred?.wixSiteId) return fail(res, 400, 'credentials');
        const wix = createWixClient(wixCred, async (creds) => {
          try {
            if (wixSite) await prisma.wixSite.update({ where: { id: wixSite.id }, data: { accessToken: creds.accessToken, tokenExpiresAt: creds.tokenExpiresAt } });
            if (credential) await prisma.credential.update({ where: { userId }, data: { wixAccessToken: creds.accessToken, wixTokenExpiresAt: creds.tokenExpiresAt } });
          } catch (error: any) {
            logger.warn('[DRAFT_REPLY] Wix token refresh persist failed', { error: error?.message });
          }
        });
        ctx = await buildWixDraftContext({ userId, conversationId: id, wix, db, shopName: wixSite?.siteName ?? null });
      }
    } catch (e) {
      if (e instanceof DraftSourceError) {
        logger.warn('[DRAFT_REPLY] context failed', { platform, code: e.code });
        return fail(res, SOURCE_STATUS[e.code], e.code);
      }
      throw e;
    }

    // TODO(billing track, tiers.md D10 / §2b): AI-credit metering. Reserve 1 credit before this call and
    // refund it in `finally` on a non-200 outcome, once lib/billing exposes the meter. Until then only the
    // in-memory 20/min limit applies.
    const outcome = await draftFromContext(ctx, (prompt) => geminiGenerate(prompt, { userId: user.id, platform, refine: refineFromBody(req.body) }));
    if (outcome.status !== 200) {
      logger.warn('[DRAFT_REPLY] draft rejected', { platform, code: outcome.body.code, reason: outcome.reason });
      return res.status(outcome.status).json(outcome.body);
    }
    logger.info('[DRAFT_REPLY] drafted', {
      platform, replyLength: outcome.body.reply.length, missing: outcome.body.missing,
      threadLength: ctx.thread.length, hasProduct: !!ctx.product, orderCount: ctx.orders?.length ?? null,
    });
    return res.status(200).json(outcome.body);
  } catch (error: any) {
    // Name/status only — never the raw Error (its message may echo customer text).
    logger.error('[DRAFT_REPLY] Error', undefined, { errorName: error?.name, status: error?.status });
    return fail(res, 502, 'unavailable');
  }
}
