import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const imagePath = req.query.path as string;
  if (!imagePath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const absolutePath = path.resolve(UPLOAD_ROOT, imagePath);
  const resolvedRoot = path.resolve(UPLOAD_ROOT);
  if (!absolutePath.startsWith(resolvedRoot + path.sep)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = EXT_TO_MIME[ext] || 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(absolutePath).pipe(res);
}
