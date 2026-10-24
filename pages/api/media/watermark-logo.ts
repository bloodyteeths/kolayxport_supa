// POST /api/media/watermark-logo { dataUrl } → { id, width, height } — stores a seller's watermark logo (PNG/JPEG/WebP).
// GET  /api/media/watermark-logo?id=…      → the logo PNG (owner only; used by the preview).
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { readWatermarkLogo, saveWatermarkLogo } from '@/lib/media/watermarkLogos';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } }; // 2 MB logo as base64

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'GET') {
    const png = await readWatermarkLogo(user.id, String(req.query.id ?? ''));
    if (!png) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(png);
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
  const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'PNG, JPEG or WebP only', code: 'logo_type' });
  try {
    return res.status(200).json(await saveWatermarkLogo(user.id, Buffer.from(m[2], 'base64')));
  } catch (e) {
    const code = (e as Error).message;
    return res.status(400).json({ error: 'Logo could not be read', code: code === 'logo_size' || code === 'logo_type' ? code : 'logo_unreadable' });
  }
}
