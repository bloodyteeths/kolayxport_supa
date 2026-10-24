// POST /api/media/watermark { imageUrl, spec } → the watermarked image bytes (same format and size).
// imageUrl is any photo the editors show: our own staged/uploaded photos (read from disk, owner-checked) or a public
// https marketplace photo (SSRF-guarded) — lib/images/ownImage.ts. Nothing is stored or sent to a marketplace here: the
// browser stages the result through the channel's normal photo path, so the original stays until the seller sends.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { loadImageForUser } from '@/lib/images/ownImage';
import { applyWatermark, markSignature } from '@/lib/media/watermark';
import { normalizeWatermarkSpec } from '@/lib/media/watermarkSpec';
import { readWatermarkLogo } from '@/lib/media/watermarkLogos';
import { DISK_PAUSE_RATIO, uploadDiskUse } from '@/lib/media/watermarkRetention';
import { logger } from '@/lib/logger';
import { archiveOriginal, findOriginal, normalizeOrigin, readOriginalFile, updateMark } from '@/lib/media/watermarkOriginals';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const spec = normalizeWatermarkSpec(body.spec);
  // Disk guard: above 90 % new watermark jobs pause (previews still render; sending is never affected).
  if (body.preview !== true) {
    const use = await uploadDiskUse();
    if (use !== null && use > DISK_PAUSE_RATIO) {
      logger.event('system', 'error', 'Disk above 90%: watermark jobs paused', { use }, { operation: 'watermark.disk_pause', userId: user.id });
      return res.status(507).json({ error: 'Storage is full', code: 'disk_full' });
    }
  }
  if (!spec) return res.status(400).json({ error: 'Invalid watermark', code: 'invalid_spec' });
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  // origin = the listing + photo slot. A slot watermarked before is re-watermarked from its stored original (never
  // stacked on the watermarked photo); the first time, the original is stored (unless this is only a preview).
  const origin = normalizeOrigin(body.origin);
  const preview = body.preview === true;
  const stored = origin ? await findOriginal(user.id, origin) : null;
  const storedBytes = stored ? await readOriginalFile(user.id, stored.fileKey) : null;
  const img = storedBytes ? { data: storedBytes.toString('base64'), mimeType: stored!.contentType } : await loadImageForUser(user.id, imageUrl);
  if (!img) return res.status(422).json({ error: 'Photo could not be read', code: 'image_unreadable' });
  const logo = spec.kind === 'logo' && spec.logoId ? await readWatermarkLogo(user.id, spec.logoId) : null;
  if (spec.kind === 'logo' && !logo) return res.status(422).json({ error: 'Logo not found', code: 'logo_missing' });
  try {
    const source = Buffer.from(img.data, 'base64');
    const out = await applyWatermark(source, spec, logo);
    if (origin && !preview) {
      // Fingerprint of the photo we place: "Filigranı kaldır" later replaces only that photo.
      const markHash = await markSignature(source, out.data, out.box);
      const row = storedBytes && stored ? await updateMark(stored.id, spec, markHash) : await archiveOriginal(user.id, origin, source, img.mimeType, spec, markHash);
      res.setHeader('X-Watermark-Original', row.id);
    }
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(out.data);
  } catch {
    return res.status(422).json({ error: 'Photo could not be watermarked', code: 'image_unreadable' });
  }
}
