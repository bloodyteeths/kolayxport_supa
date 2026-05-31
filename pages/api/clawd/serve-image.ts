import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getAuthUser } from '@/lib/auth';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const imagePath = req.query.path;
  if (!imagePath || typeof imagePath !== 'string') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'path is required' });
  }

  const resolvedRoot = path.resolve(UPLOAD_ROOT);
  const absolutePath = path.resolve(resolvedRoot, imagePath);

  // Path traversal guard.
  if (absolutePath !== resolvedRoot && !absolutePath.startsWith(resolvedRoot + path.sep)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Ownership enforcement.
  // Canonical layout: ${UPLOAD_ROOT}/${userId}/...
  // Legacy layout (pre-hardening): files written directly under ${UPLOAD_ROOT}. To preserve
  // existing UI behaviour without leaking other tenants' files, only the file's owner may
  // read a legacy file, and the caller must opt in by passing ?userId= matching their session.
  const relativeFromRoot = path.relative(resolvedRoot, absolutePath);
  const segments = relativeFromRoot.split(path.sep).filter(Boolean);
  const firstSegment = segments[0];

  let ownedByCaller = false;
  if (firstSegment === user.id) {
    ownedByCaller = true;
  } else {
    const claimedUserId = req.query.userId;
    if (typeof claimedUserId === 'string' && claimedUserId === user.id) {
      // Legacy file directly under root, caller is the only one who can access it.
      ownedByCaller = true;
    }
  }

  if (!ownedByCaller) {
    // Use 404 (not 403) so we don't confirm existence to non-owners.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Image not found' });
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Image not found' });
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = EXT_TO_MIME[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Private cache only — content is per-user.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  fs.createReadStream(absolutePath).pipe(res);
}
