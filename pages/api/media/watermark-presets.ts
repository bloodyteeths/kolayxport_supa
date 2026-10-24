// /api/media/watermark-presets — a seller's saved watermarks ("Mağaza logosu sağ alt %40"), shared by every channel.
//   GET                       → { presets: [{ id, name, spec }] }
//   POST { name, spec }       → creates or replaces the preset of that name → { preset }
//   DELETE ?id=…              → deletes it
// Stored in EditorTemplate with marketplace 'watermark' (steps = [spec]); no schema change.
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { normalizeWatermarkSpec, type WatermarkSpec } from '@/lib/media/watermarkSpec';

const KIND = 'watermark';
const MAX_PRESETS = 20;

type Row = { id: string; name: string; steps: unknown };
const toPreset = (r: Row): { id: string; name: string; spec: WatermarkSpec } | null => {
  const spec = normalizeWatermarkSpec(Array.isArray(r.steps) ? r.steps[0] : null);
  return spec ? { id: r.id, name: r.name, spec } : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const userId = user.id;
  if (req.method === 'GET') {
    const rows = await prisma.editorTemplate.findMany({ where: { userId, marketplace: KIND }, orderBy: { updatedAt: 'desc' } });
    return res.status(200).json({ presets: rows.map(toPreset).filter(Boolean) });
  }
  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const spec = normalizeWatermarkSpec(body.spec);
    if (!name || !spec) return res.status(400).json({ error: 'Invalid preset', code: 'invalid' });
    const steps = [spec] as unknown as Prisma.InputJsonValue;
    const existing = await prisma.editorTemplate.findUnique({ where: { userId_marketplace_name: { userId, marketplace: KIND, name } } });
    if (!existing && (await prisma.editorTemplate.count({ where: { userId, marketplace: KIND } })) >= MAX_PRESETS) {
      return res.status(400).json({ error: 'Too many presets', code: 'limit' });
    }
    const row = existing
      ? await prisma.editorTemplate.update({ where: { id: existing.id }, data: { steps } })
      : await prisma.editorTemplate.create({ data: { userId, marketplace: KIND, name, steps } });
    return res.status(200).json({ preset: toPreset(row) });
  }
  if (req.method === 'DELETE') {
    await prisma.editorTemplate.deleteMany({ where: { id: String(req.query.id ?? ''), userId, marketplace: KIND } });
    return res.status(204).end();
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
