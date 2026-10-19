// /api/admin/partners — list (GET), create (POST) and update (PATCH) referral partners. Admin only.
// docs/gtm/referral-spec.md §4. On create with `createPromo: true`, a Stripe promotion code is made on coupon
// STRIPE_PARTNER_COUPON_ID (the discount itself lives on that Stripe coupon, set up by the founder) and its id stored.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { normalizeRefCode } from '@/lib/partners/cookies';

const TYPES = new Set(['fb_admin', 'tg_admin', 'x_voice', 'youtube', 'musavir', 'other']);
const STATUSES = new Set(['active', 'paused', 'terminated']);

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const rate = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : undefined);
const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

/** The partner's own KolayXport login (partner dashboard). undefined = not given, null = clear, string = user id. */
async function resolveUserId(v: unknown, partnerId?: string): Promise<{ ok: true; userId: string | null | undefined } | { ok: false; error: string }> {
  if (v === undefined) return { ok: true, userId: undefined };
  if (v === null || v === '') return { ok: true, userId: null };
  if (typeof v !== 'string') return { ok: false, error: 'userEmail must be a string' };
  const user = await prisma.user.findUnique({ where: { email: v.trim().toLowerCase() }, select: { id: true, role: true } });
  if (!user) return { ok: false, error: 'no KolayXport account with that e-mail' };
  const taken = await prisma.partner.findUnique({ where: { userId: user.id }, select: { id: true } });
  return taken && taken.id !== partnerId ? { ok: false, error: 'that account is already linked to a partner' } : { ok: true, userId: user.id };
}

const SELECT = {
  id: true, code: true, name: true, type: true, email: true, status: true, rate: true, tierRate: true, tierThreshold: true,
  months: true, stripePromotionCode: true, promoCodeText: true, notes: true, userId: true, stripeRecipientId: true, createdAt: true,
} as const;

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const partners = await prisma.partner.findMany({ select: SELECT, orderBy: { createdAt: 'desc' } });
    return res.status(200).json({ partners });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  if (req.method === 'POST') {
    const code = normalizeRefCode(body.code);
    const name = str(body.name);
    const type = str(body.type, 20);
    if (!code || code.length > 20) return res.status(400).json({ error: 'code must be 3–20 chars: A–Z, 0–9, -' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!type || !TYPES.has(type)) return res.status(400).json({ error: `type must be one of ${[...TYPES].join(', ')}` });
    if (await prisma.partner.findUnique({ where: { code }, select: { id: true } })) return res.status(409).json({ error: 'code already exists' });

    const link = await resolveUserId(body.userEmail);
    if (!link.ok) return res.status(400).json({ error: link.error });

    let stripePromotionCode: string | null = null;
    const promoCodeText = normalizeRefCode(body.promoCodeText) ?? code;
    if (body.createPromo === true) {
      const coupon = process.env.STRIPE_PARTNER_COUPON_ID;
      if (!coupon) return res.status(400).json({ error: 'STRIPE_PARTNER_COUPON_ID is not set; create the coupon first or retry without createPromo' });
      try {
        const promo = await stripe.promotionCodes.create({ coupon, code: promoCodeText, metadata: { partner_code: code } } as never);
        stripePromotionCode = (promo as { id: string }).id;
      } catch (e) {
        logger.warn('Partner promo code not created', { code, error: e instanceof Error ? e.message : String(e) });
        return res.status(502).json({ error: `Stripe: ${e instanceof Error ? e.message : 'promotion code failed'}` });
      }
    }

    const partner = await prisma.partner.create({
      data: {
        code,
        name,
        type,
        email: str(body.email)?.toLowerCase() ?? null,
        rate: rate(body.rate) ?? 0.3,
        tierRate: rate(body.tierRate) ?? 0.35,
        tierThreshold: int(body.tierThreshold, 1, 1000) ?? 10,
        months: int(body.months, 1, 120) ?? 12,
        stripePromotionCode,
        promoCodeText: stripePromotionCode ? promoCodeText : null,
        notes: str(body.notes, 2000) ?? null,
        userId: link.userId ?? null,
      },
      select: SELECT,
    });
    return res.status(201).json({ partner });
  }

  if (req.method === 'PATCH') {
    const id = str(body.id, 64);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const status = str(body.status, 20);
    if (status && !STATUSES.has(status)) return res.status(400).json({ error: `status must be one of ${[...STATUSES].join(', ')}` });
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (str(body.name)) data.name = str(body.name);
    if (body.email !== undefined) data.email = str(body.email)?.toLowerCase() ?? null;
    if (body.notes !== undefined) data.notes = str(body.notes, 2000) ?? null;
    if (rate(body.rate) !== undefined) data.rate = rate(body.rate);
    if (rate(body.tierRate) !== undefined) data.tierRate = rate(body.tierRate);
    if (int(body.tierThreshold, 1, 1000) !== undefined) data.tierThreshold = int(body.tierThreshold, 1, 1000);
    if (int(body.months, 1, 120) !== undefined) data.months = int(body.months, 1, 120);
    if (body.userEmail !== undefined) {
      const link = await resolveUserId(body.userEmail, id);
      if (!link.ok) return res.status(400).json({ error: link.error });
      data.userId = link.userId;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' });
    const existing = await prisma.partner.findUnique({ where: { id }, select: { id: true, stripePromotionCode: true } });
    if (!existing) return res.status(404).json({ error: 'not found' });
    const partner = await prisma.partner.update({ where: { id }, data, select: SELECT });
    // A paused / terminated partner's promo code stops working at checkout too.
    if (status && existing.stripePromotionCode) {
      try {
        await stripe.promotionCodes.update(existing.stripePromotionCode, { active: status === 'active' });
      } catch (e) {
        logger.warn('Partner promo code not toggled', { id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return res.status(200).json({ partner });
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
});
