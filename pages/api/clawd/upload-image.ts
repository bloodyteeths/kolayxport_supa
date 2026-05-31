import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12MB — eBay max
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'];

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'https://kolayxport.com';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const envApiKey = process.env.CLAWD_API_KEY;
  let authenticated = false;
  let userId: string | null = null;

  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
    userId = (req.query.userId as string) || (req.query.user_id as string) || null;
  }

  if (!authenticated) {
    const user = await getAuthUser(req, res);
    if (user) {
      authenticated = true;
      userId = user.id;
    }
  }

  if (!authenticated || !userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const userDir = path.join(UPLOAD_ROOT, userId);
    fs.mkdirSync(userDir, { recursive: true });

    const form = new IncomingForm({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    const { files } = await new Promise<{ files: Record<string, any> }>((resolve, reject) => {
      form.parse(req, (err, _fields, files) => {
        if (err) reject(err);
        else resolve({ files });
      });
    });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: 'Dosya bulunamadi' });
    }

    if (!ALLOWED_TYPES.includes(file.mimetype || '')) {
      return res.status(400).json({ error: 'Desteklenmeyen format. JPEG, PNG, GIF, WebP veya TIFF kullanin.' });
    }

    const ext = path.extname(file.originalFilename || '.jpg') || '.jpg';
    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}-${hash}${ext}`;
    const destPath = path.join(userDir, filename);

    fs.copyFileSync(file.filepath, destPath);
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }

    const storagePath = `${userId}/${filename}`;
    const publicUrl = `${getBaseUrl()}/api/clawd/serve-image?path=${encodeURIComponent(storagePath)}`;

    logger.info('Image uploaded to local storage', { userId, storagePath });

    return res.status(200).json({
      url: publicUrl,
      path: storagePath,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Image upload error', error instanceof Error ? error : new Error(msg));
    return res.status(500).json({ error: 'Gorsel yuklenirken hata olustu' });
  }
}
