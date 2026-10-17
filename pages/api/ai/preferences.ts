// GET /api/ai/preferences            → { preferences: { all: {...}, etsy: {...}, … } }
// PUT /api/ai/preferences  { marketplace, tone, include, avoid, brand, notes } → the saved row
// The seller's standing instructions for every AI feature (lib/ai/preferences). Session user only: the user id never
// comes from the request, so one seller can never read or change another's preferences.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { invalidateAiPreferences } from '@/lib/ai/gemini';
import { AI_PREF_MARKETPLACES, normalizePreference, type AiMarketplaceKey } from '@/lib/ai/preferences';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const rows = await prisma.aiPreference.findMany({ where: { userId: user.id } });
      const preferences: Record<string, unknown> = {};
      for (const r of rows) preferences[r.marketplace] = { ...normalizePreference(r), updatedAt: r.updatedAt };
      return res.status(200).json({ preferences });
    }

    if (req.method === 'PUT') {
      const marketplace = String(req.body?.marketplace || 'all') as AiMarketplaceKey;
      if (!AI_PREF_MARKETPLACES.includes(marketplace)) return res.status(400).json({ code: 'badMarketplace' });
      const v = normalizePreference(req.body);
      const empty = !v.tone && !v.include?.length && !v.avoid?.length && !v.brand && !v.notes;
      if (empty) {
        await prisma.aiPreference.deleteMany({ where: { userId: user.id, marketplace } });
        invalidateAiPreferences(user.id);
        return res.status(200).json({ preference: null });
      }
      const data = { tone: v.tone ?? null, include: v.include ?? [], avoid: v.avoid ?? [], brand: v.brand ?? null, notes: v.notes ?? null };
      const row = await prisma.aiPreference.upsert({
        where: { userId_marketplace: { userId: user.id, marketplace } },
        create: { userId: user.id, marketplace, ...data },
        update: data,
      });
      invalidateAiPreferences(user.id);
      return res.status(200).json({ preference: { ...normalizePreference(row), updatedAt: row.updatedAt } });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ code: 'methodNotAllowed' });
  } catch (err: any) {
    logger.error('AI preferences request failed', err, { userId: user.id });
    return res.status(500).json({ code: 'internal' });
  }
}
