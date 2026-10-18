/**
 * Hepsiburada order/claim webhooks (`createOrder`, `createPackages`, `orderCancel`, `intransit`, `deliver`,
 * `awaitingAction`, …). HB pushes to `<base>/<event>` with Basic credentials agreed at onboarding
 * (HEPSIBURADA_WEBHOOK_USER / HEPSIBURADA_WEBHOOK_PASSWORD). The payload is not trusted for data: we only use it to
 * find the merchant and run that user's normal order sync (idempotent), so retries and duplicates are harmless.
 * Answers 204 at once (HB wants a reply within ~5 s). Polling (hepsiburada-orders job) remains the source of truth.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

const lastKick = new Map<string, number>();
const DEBOUNCE_MS = 30_000;

function authorized(req: NextApiRequest): boolean {
  const user = process.env.HEPSIBURADA_WEBHOOK_USER;
  const pass = process.env.HEPSIBURADA_WEBHOOK_PASSWORD;
  if (!user || !pass) return false;
  const header = String(req.headers.authorization || '');
  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function merchantIdOf(body: any): string | null {
  const candidates = [body?.merchantId, body?.MerchantId, body?.merchantID, body?.items?.[0]?.merchantId, body?.lineItems?.[0]?.merchantId, body?.Items?.[0]?.MerchantId];
  const v = candidates.find((x) => typeof x === 'string' && x.trim());
  return v ? String(v).trim() : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'PUT') return res.status(405).end();
  if (!authorized(req)) return res.status(401).end();

  const event = Array.isArray(req.query.event) ? req.query.event.join('/') : String(req.query.event || '');
  const merchantId = merchantIdOf(req.body);
  res.status(204).end();

  if (!merchantId) {
    logger.warn('[HEPSIBURADA WEBHOOK] no merchantId in payload', { event });
    return;
  }
  const now = Date.now();
  if ((lastKick.get(merchantId) ?? 0) > now - DEBOUNCE_MS) return;
  lastKick.set(merchantId, now);

  try {
    const cred = await prisma.credential.findFirst({ where: { hepsiburadaMerchantId: merchantId }, select: { userId: true } });
    if (!cred) return;
    const { syncHepsiburadaRecentOrdersForUser } = await import('@/lib/hepsiburada/orderSync');
    await syncHepsiburadaRecentOrdersForUser(cred.userId);
  } catch (err: any) {
    logger.warn('[HEPSIBURADA WEBHOOK] sync after event failed', { event, merchantId, error: err?.message });
  }
}
