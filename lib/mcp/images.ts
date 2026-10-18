// lib/mcp/images.ts — product photos for the seller's own AI (MCP). SERVER ONLY.
// generate: Nano Banana Pro from the seller's reference photos (charged like the app: AI kredisi, refunded on failure).
// host: stores the image where marketplaces can fetch it (eBay / Etsy / Shopify download photo URLs anonymously), as the
// editor's uploads do (pages/api/clawd/upload-image + signed /api/clawd/serve-image).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { isRetryableAiError, logUsage } from '@/lib/ai/gemini';
import { modelChain } from '@/lib/ai/models';
import { loadSources } from '@/lib/ai/videoSources';
import { signImagePath } from '@/lib/images/signedImageUrl';
import { imageCredits } from '@/lib/billing/aiCredits';
import { isAiBudgetError, isNoCreditsError, refundCredits, spendCredits } from '@/lib/billing/aiCreditsServer';
import { mcpBaseUrl } from './tokens';

const UPLOAD_ROOT = process.env.EBAY_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'ebay-images');
export const IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3', '16:9', '9:16'] as const;

export class ImageToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageToolError';
  }
}

/** Saves an image for the user and returns a public signed URL marketplaces can fetch. */
export async function hostImage(userId: string, buf: Buffer): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(dir, filename), buf);
  const storagePath = `${userId}/${filename}`;
  return `${mcpBaseUrl()}/api/clawd/serve-image?path=${encodeURIComponent(storagePath)}&sig=${signImagePath(storagePath)}`;
}

/** Listing photo from reference photos + an instruction; returns its hosted URL. Charges AI kredisi (refunded on failure). */
export async function generateProductImage(input: { userId: string; prompt: string; referenceUrls: string[]; aspectRatio?: string; whiteBackground?: boolean }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ImageToolError('AI images are not configured.');
  const refs = await loadSources(input.userId, input.referenceUrls.slice(0, 10));
  if (input.referenceUrls.length && !refs.length) throw new ImageToolError('None of the reference photos could be read (public https image links are needed).');
  const aspectRatio = (IMAGE_ASPECTS as readonly string[]).includes(input.aspectRatio ?? '') ? (input.aspectRatio as string) : '1:1';

  const ref = `img_${crypto.randomBytes(10).toString('hex')}`;
  try {
    await spendCredits(input.userId, imageCredits(), { feature: 'image', ref, note: 'mcp' });
  } catch (err) {
    if (isNoCreditsError(err)) {
      throw new ImageToolError(err.neutral ? "This month's AI image generation is used up; it renews at the start of next month." : `Not enough AI credits (an image needs ${err.need}, ${err.balance ?? 0} left). The seller can add credits in KolayXport → Settings → Billing.`);
    }
    if (isAiBudgetError(err)) throw new ImageToolError("Today's AI generation capacity is full. Try again tomorrow.");
    throw err;
  }

  let delivered = false;
  try {
    const text = [
      refs.length ? `Use the ${refs.length} reference photo${refs.length > 1 ? 's' : ''} above: keep exactly the same product (shape, colours, materials, details, any printed text) and change only what the instruction asks.` : '',
      `Create a professional, photorealistic e-commerce product photo: ${input.prompt.trim().slice(0, 2000)}.`,
      input.whiteBackground ? 'Clean pure white background, centred product, soft even studio light.' : 'A natural, styled setting that suits the product, soft realistic light.',
      `${aspectRatio} composition with the whole product in frame and a little margin on every side. No text, captions, logos, borders or watermarks added.`,
    ].filter(Boolean).join(' ');
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [...refs.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })), { text }];
    let data: string | null = null;
    let lastErr: unknown = null;
    for (const model of modelChain('image')) {
      const started = Date.now();
      try {
        const r = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }], config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio, imageSize: '2K' } } as any });
        const img = r.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
        void logUsage({ userId: input.userId, feature: 'mcp.image', model, ok: Boolean(img), usage: r.usageMetadata, ms: Date.now() - started, refine: refs.length > 0, images: img ? 1 : 0 });
        if (!img?.data) throw new ImageToolError('The image model returned no image (it may have refused the request). Try a different instruction.');
        data = img.data;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err instanceof ImageToolError) throw err;
        void logUsage({ userId: input.userId, feature: 'mcp.image', model, ok: false, ms: Date.now() - started, refine: false, error: err?.message });
        if (!isRetryableAiError(err)) throw err;
      }
    }
    if (!data) throw lastErr ?? new Error('No image model available');
    // Marketplace-ready: at least 2000 px wide (Etsy), at most 3000 px on the long side.
    const raw = Buffer.from(data, 'base64');
    const meta = await sharp(raw).metadata();
    const w = meta.width ?? 1024;
    const h = meta.height ?? 1024;
    const scale = Math.min(Math.max(1, 2000 / w), 3000 / Math.max(w, h));
    const out = await sharp(raw).resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'lanczos3' }).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
    const url = await hostImage(input.userId, out);
    delivered = true;
    return { url, aspectRatio, creditsUsed: imageCredits() };
  } finally {
    if (!delivered) await refundCredits(input.userId, ref).catch(() => undefined);
  }
}
