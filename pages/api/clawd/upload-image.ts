import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

const BUCKET = 'listing-images';
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12MB — eBay max is 12MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
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
    const admin = supabaseAdmin();

    // Ensure bucket exists (create if not)
    const { data: buckets } = await admin.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === BUCKET);
    if (!bucketExists) {
      const { error: createErr } = await admin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: ALLOWED_TYPES,
      });
      if (createErr) {
        logger.error('Failed to create storage bucket', createErr as Error);
        return res.status(500).json({ error: 'Storage yapilandirilamadi' });
      }
    }

    // Parse multipart form
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

    // Read file and upload to Supabase Storage
    const fileBuffer = fs.readFileSync(file.filepath);
    const ext = path.extname(file.originalFilename || '.jpg') || '.jpg';
    const hash = crypto.randomBytes(8).toString('hex');
    const storagePath = `${userId}/${Date.now()}-${hash}${ext}`;

    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: false,
      });

    if (uploadErr) {
      logger.error('Storage upload failed', uploadErr as Error);
      return res.status(500).json({ error: 'Gorsel yuklenemedi: ' + uploadErr.message });
    }

    // Get public URL
    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // Clean up temp file
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }

    logger.info('Image uploaded to Supabase Storage', { userId, storagePath });

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
