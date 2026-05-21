import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { getAuthUser } from '@/lib/auth';
import { upsertDraftPatch, createDraftMediaFile, toSerializable } from '@/lib/ebay/draftService';
import { logger } from '@/lib/logger';

export const config = {
  api: {
    bodyParser: false,
  },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ maxFileSize: 120 * 1024 * 1024, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { fields, files } = await parseForm(req);
    const sku = first(fields.sku as string | string[] | undefined);
    const kind = first(fields.kind as string | string[] | undefined) || 'image';
    const operation = first(fields.operation as string | string[] | undefined) || 'upload';
    const rankRaw = first(fields.rank as string | string[] | undefined);
    const payloadRaw = first(fields.payload as string | string[] | undefined);

    if (!sku) return res.status(400).json({ error: 'sku is required' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'file is required' });

    // Ensure draft exists for this SKU
    const draft = await upsertDraftPatch({ userId: user.id, sku, inventoryFields: {} });
    if (!draft) return res.status(500).json({ error: 'Draft could not be created' });

    // Use draftService to copy file to permanent location and create media record
    const media = await createDraftMediaFile({
      userId: user.id,
      draftId: draft.id,
      sku,
      kind,
      operation,
      tempPath: file.filepath,
      filename: file.originalFilename || `${kind}-upload`,
      contentType: file.mimetype || undefined,
      rank: rankRaw ? Number(rankRaw) : undefined,
      payload: payloadRaw ? JSON.parse(payloadRaw) : undefined,
    });

    // Clean up formidable temp file
    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({ success: true, draftId: draft.id, media: toSerializable(media) });
  } catch (err: any) {
    logger.error('eBay media staging failed', err, { userId: user.id });
    return res.status(500).json({ error: err.message || 'Media staging failed' });
  }
}
