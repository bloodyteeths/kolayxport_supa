import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { getAuthUser } from '@/lib/auth';
import { createDraftMediaFile, toSerializable, upsertDraftPatch } from '@/lib/etsy/draftService';

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
    const shopId = first(fields.shop_id as string | string[] | undefined);
    const listingId = first(fields.listing_id as string | string[] | undefined);
    const kind = first(fields.kind as string | string[] | undefined) || 'image';
    const operation = first(fields.operation as string | string[] | undefined) || 'upload';
    const rankRaw = first(fields.rank as string | string[] | undefined);
    const altText = first(fields.alt_text as string | string[] | undefined);
    const payloadRaw = first(fields.payload as string | string[] | undefined);
    if (!shopId || !listingId) return res.status(400).json({ error: 'shop_id and listing_id are required' });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'file is required' });

    const draft = await upsertDraftPatch({ userId: user.id, shopId, listingId, fields: {} });
    if (!draft) return res.status(500).json({ error: 'Draft could not be created' });
    const media = await createDraftMediaFile({
      userId: user.id,
      draftId: draft.id,
      listingId,
      kind,
      operation,
      tempPath: file.filepath,
      filename: file.originalFilename || `${kind}-upload`,
      contentType: file.mimetype || undefined,
      rank: rankRaw ? Number(rankRaw) : undefined,
      altText: altText || undefined,
      payload: payloadRaw ? JSON.parse(payloadRaw) : undefined,
    });

    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(200).json({ draftId: draft.id, media: toSerializable(media) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Media staging failed' });
  }
}
