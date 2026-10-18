import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import { getAuthUserOrApiKey } from '@/lib/auth';
import { upsertDraftPatch, createDraftMediaFile, dropOtherVideoRows, getOrCreateDraft, toSerializable } from '@/lib/ebay/draftService';
import { EBAY_VIDEO_MAX_BYTES, EBAY_VIDEO_TYPES } from '@/lib/ebay/mediaApi';
import { logger } from '@/lib/logger';
import { ebayDraftErrorResponse, isEbayDraftError } from '@/lib/ebay/draftErrors';

export const config = {
  api: {
    bodyParser: false,
  },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  // eBay takes videos up to 150 MB (Media API createVideo `size` max 157,286,400 bytes).
  const form = formidable({ maxFileSize: EBAY_VIDEO_MAX_BYTES, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUserOrApiKey(req, res);
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
    if (kind === 'video') {
      // eBay listing video: MP4 / MOV (Seller Center), at most 150 MB, one per listing.
      if (!(EBAY_VIDEO_TYPES as readonly string[]).includes(String(file.mimetype || ''))) {
        try { fs.unlinkSync(file.filepath); } catch {}
        return res.status(415).json({ error: 'Use an MP4 or MOV video', code: 'VIDEO_TYPE', key: 'draftSync.videoType' });
      }
    }
    // `isNew=1`: a new listing not staged yet (local SKU) — create its draft without reading eBay.
    const isNew = first(fields.isNew as string | string[] | undefined) === '1';

    // Ensure draft exists for this SKU
    const draft = isNew
      ? await getOrCreateDraft({ userId: user.id, sku, isNew: true })
      : await upsertDraftPatch({ userId: user.id, sku, inventoryFields: {} });
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
    // One video per listing: a new staged video replaces any earlier staged video change.
    if (kind === 'video' && operation === 'upload') await dropOtherVideoRows(draft.id, media.id);

    return res.status(200).json({ success: true, draftId: draft.id, media: toSerializable(media) });
  } catch (err: any) {
    if (err?.httpCode === 413) {
      return res.status(413).json({ error: 'File is larger than 150 MB', code: 'VIDEO_TOO_LARGE', key: 'draftSync.videoTooLarge' });
    }
    if (!isEbayDraftError(err)) logger.error('eBay media staging failed', err, { userId: user.id });
    const { status, body } = ebayDraftErrorResponse(err, 'Media staging failed');
    return res.status(status).json(body);
  }
}
