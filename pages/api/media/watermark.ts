// POST /api/media/watermark { imageUrl, spec } → the watermarked image bytes (same format and size).
// imageUrl is any photo the editors show: our own staged/uploaded photos (read from disk, owner-checked) or a public
// https marketplace photo (SSRF-guarded) — lib/images/ownImage.ts. Nothing is stored or sent to a marketplace here: the
// browser stages the result through the channel's normal photo path, so the original stays until the seller sends.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { loadImageForUser } from '@/lib/images/ownImage';
import { applyWatermark } from '@/lib/media/watermark';
import { normalizeWatermarkSpec } from '@/lib/media/watermarkSpec';
import { readWatermarkLogo } from '@/lib/media/watermarkLogos';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const spec = normalizeWatermarkSpec(body.spec);
  if (!spec) return res.status(400).json({ error: 'Invalid watermark', code: 'invalid_spec' });
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const img = await loadImageForUser(user.id, imageUrl);
  if (!img) return res.status(422).json({ error: 'Photo could not be read', code: 'image_unreadable' });
  const logo = spec.kind === 'logo' && spec.logoId ? await readWatermarkLogo(user.id, spec.logoId) : null;
  if (spec.kind === 'logo' && !logo) return res.status(422).json({ error: 'Logo not found', code: 'logo_missing' });
  try {
    const out = await applyWatermark(Buffer.from(img.data, 'base64'), spec, logo);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(out.data);
  } catch {
    return res.status(422).json({ error: 'Photo could not be watermarked', code: 'image_unreadable' });
  }
}
