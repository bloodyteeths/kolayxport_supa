import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { GoogleGenAI } from '@google/genai';
import { isRetryableAiError, logUsage } from '@/lib/ai/gemini';
import { modelChain } from '@/lib/ai/models';
import sharp from 'sharp';
import crypto from 'crypto';
import { imageCredits } from '@/lib/billing/aiCredits';
import { isAiBudgetError, isNoCreditsError, refundCredits, spendCredits } from '@/lib/billing/aiCreditsServer';
import { isReadablePhotoUrl, loadImageForUser } from '@/lib/images/ownImage';
import { AI_MAX_REFERENCE_IMAGES } from '@/lib/ai/referenceImages';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb', // Reference images can be large
    },
  },
};

// Gemini image models (lib/ai/models): Nano Banana Pro first (benchmarked 2026-10-17: whole product in frame, most
// faithful colours), then older image models if it is unavailable. GEMINI_IMAGE_MODEL overrides the first.

// NOTE: Gemini API image output carries only an invisible SynthID watermark —
// there is no visible logo/strip (that sparkle mark is added by the consumer
// Gemini app, not the API). We therefore do NOT crop the image; the old blind
// 20px bottom crop silently changed the aspect ratio and cut product edges.

const SUPPORTED_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
/** Minimum output width for marketplace listing photos (Etsy recommends ≥ 2000px). */
const MIN_OUTPUT_WIDTH = 2000;
/** Longest side cap to keep payloads reasonable. */
const MAX_OUTPUT_SIDE = 3000;
const MAX_REFERENCE_IMAGES = AI_MAX_REFERENCE_IMAGES;
/** References above this size are shrunk (1600px JPEG) so several photos stay well inside the model's request limit. */
const REFERENCE_SHRINK_BYTES = 1.5 * 1024 * 1024;
/**
 * Native output size. '2K' already yields ≥ 2000px width at 4:3 (no upscaling);
 * '4K' is supported by the Gemini 3 image models but is slower/costlier and
 * would be downscaled to MAX_OUTPUT_SIDE anyway. Override via env.
 */
const IMAGE_SIZE = ['1K', '2K', '4K'].includes(process.env.GEMINI_IMAGE_SIZE || '') ? process.env.GEMINI_IMAGE_SIZE! : '2K';
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

type RefPart = { inlineData: { mimeType: string; data: string } };

/** Large photos are re-encoded to 1600px JPEG: the product stays recognisable and 8 references fit one request. */
async function shrinkReference(ref: RefPart): Promise<RefPart> {
  if (ref.inlineData.data.length * 0.75 <= REFERENCE_SHRINK_BYTES) return ref;
  try {
    const out = await sharp(Buffer.from(ref.inlineData.data, 'base64'))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { inlineData: { mimeType: 'image/jpeg', data: out.toString('base64') } };
  } catch {
    return ref;
  }
}

function inlineReference(data: unknown, mimeType: unknown): RefPart | null {
  if (typeof data !== 'string' || !data) return null;
  const m = typeof mimeType === 'string' && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  const base64 = data.replace(/^data:image\/[\w.+-]+;base64,/, '');
  if (base64.length > MAX_REFERENCE_BYTES * 1.4) return null;
  return { inlineData: { mimeType: m, data: base64 } };
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated', code: 'unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI is not configured', code: 'ai_not_configured' });
  }

  const {
    prompt, reference_image, reference_mime_type, reference_image_url, aspect_ratio,
    reference_images, reference_image_urls, marketplace, white_background,
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required', code: 'missing_prompt' });
  }

  // Legacy single reference URL: our own photo URL (relative too) or a public https one.
  if (reference_image_url && (typeof reference_image_url !== 'string' || !isReadablePhotoUrl(reference_image_url))) {
    return res.status(400).json({ error: 'Invalid reference image URL', code: 'invalid_reference_image' });
  }

  const isEtsy = marketplace === 'etsy';
  // Etsy thumbnails are 4:3; other callers (eBay) historically got square images.
  const aspectRatio = typeof aspect_ratio === 'string' && SUPPORTED_ASPECT_RATIOS.includes(aspect_ratio)
    ? aspect_ratio
    : isEtsy ? '4:3' : '1:1';
  // Plain white background only for main product shots. Default stays on for
  // legacy (non-Etsy) callers; Etsy callers opt in explicitly.
  const whiteBackground = typeof white_background === 'boolean' ? white_background : !isEtsy;

  // AI kredisi: charged before the call, refunded in `finally` unless an image is delivered.
  const creditRef = `img_${crypto.randomBytes(10).toString('hex')}`;
  try {
    await spendCredits(user.id, imageCredits(), { feature: 'image', ref: creditRef, note: typeof marketplace === 'string' ? marketplace : undefined });
  } catch (err) {
    if (isNoCreditsError(err)) return res.status(402).json(err.body());
    if (isAiBudgetError(err)) return res.status(503).json(err.body());
    console.error('AI credits spend failed:', err);
    return res.status(500).json({ error: 'AI image generation failed', code: 'ai_image_failed' });
  }
  let delivered = false;

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Reference images (up to MAX_REFERENCE_IMAGES): inline uploads first, then URLs
    // (e.g. the listing's existing photos, or the previous AI result for a follow-up).
    const parts: any[] = [];
    const inlineRefs: RefPart[] = [];
    const legacyInline = inlineReference(reference_image, reference_mime_type);
    if (legacyInline) inlineRefs.push(legacyInline);
    if (Array.isArray(reference_images)) {
      for (const r of reference_images) {
        const ref = r && typeof r === 'object' ? inlineReference(r.data, r.mime_type ?? r.mimeType) : null;
        if (ref) inlineRefs.push(ref);
      }
    }
    const urls: string[] = [];
    if (typeof reference_image_url === 'string' && reference_image_url) urls.push(reference_image_url);
    if (Array.isArray(reference_image_urls)) {
      for (const u of reference_image_urls) if (typeof u === 'string' && u && !urls.includes(u)) urls.push(u);
    }
    const urlSlots = Math.max(0, MAX_REFERENCE_IMAGES - inlineRefs.length);
    // Staged / uploaded photos come as our own relative URLs: read from disk for this seller (lib/images/ownImage).
    const urlRefs = (await Promise.all(urls.slice(0, urlSlots).map(async (u): Promise<RefPart | null> => {
      const img = await loadImageForUser(user.id, u);
      return img && img.data.length <= MAX_REFERENCE_BYTES * 1.4 ? { inlineData: { mimeType: img.mimeType, data: img.data } } : null;
    }))).filter((r): r is RefPart => !!r);
    parts.push(...(await Promise.all([...inlineRefs.slice(0, MAX_REFERENCE_IMAGES), ...urlRefs].map(shrinkReference))));

    const refCount = parts.length;
    const style = whiteBackground
      ? 'Clean pure white background, centered product, soft even studio lighting.'
      : 'Natural, styled setting that suits the product, soft realistic lighting.';
    const enhancedPrompt = [
      refCount > 1
        ? `Use the ${refCount} reference images above: keep the exact same product (shape, colours, materials, details, any printed text) and change only what the instructions ask.`
        : refCount === 1
          ? 'Use the reference image above: keep the exact same product (shape, colours, materials, details, any printed text) and change only what the instructions ask.'
          : '',
      `Create a professional e-commerce product photo: ${prompt.trim().slice(0, 2000)}.`,
      style,
      `${aspectRatio} composition with the product fully in frame and a little margin on every side.`,
      'Photorealistic, high resolution. No text, captions, logos, borders or watermarks on the image.',
    ].filter(Boolean).join(' ');

    parts.push({ text: enhancedPrompt });

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
    let lastErr: unknown = null;
    for (const model of modelChain('image')) {
      const started = Date.now();
      try {
        response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            responseModalities: ['IMAGE', 'TEXT'],
            imageConfig: { aspectRatio, imageSize: IMAGE_SIZE },
          },
        });
        void logUsage({ userId: user.id, feature: 'image.generate', model, ok: true, usage: response.usageMetadata, ms: Date.now() - started, refine: refCount > 0, images: 1 });
        break;
      } catch (err) {
        lastErr = err;
        void logUsage({ userId: user.id, feature: 'image.generate', model, ok: false, ms: Date.now() - started, refine: refCount > 0, error: (err as Error)?.message });
        if (!isRetryableAiError(err)) throw err;
      }
    }
    if (!response) throw lastErr ?? new Error('No image model available');

    // Extract image from response
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      return res.status(502).json({ error: 'AI image generation failed', code: 'ai_image_failed' });
    }

    const responseParts = candidates[0].content?.parts;
    if (!responseParts) {
      return res.status(502).json({ error: 'AI image generation failed', code: 'ai_image_failed' });
    }

    let imageData: string | null = null;
    let imageMimeType: string | null = null;
    let textResponse: string | null = null;

    for (const part of responseParts) {
      if (part.inlineData) {
        imageData = part.inlineData.data ?? null;
        imageMimeType = part.inlineData.mimeType || 'image/png';
      }
      if (part.text) {
        textResponse = part.text;
      }
    }

    if (!imageData) {
      console.warn('Image generation returned no image. Model text:', (textResponse || '').slice(0, 300));
      return res.status(502).json({ error: 'AI image generation failed', code: 'ai_image_failed' });
    }

    // Post-process: no cropping (see note at top). Ensure the long-edge is
    // marketplace-ready: width ≥ 2000px (Etsy), longest side ≤ 3000px.
    try {
      const imgBuffer = Buffer.from(imageData, 'base64');
      const metadata = await sharp(imgBuffer).metadata();
      const origW = metadata.width || 1024;
      const origH = metadata.height || 1024;
      let targetW = origW;
      if (targetW < MIN_OUTPUT_WIDTH) targetW = MIN_OUTPUT_WIDTH;
      const scale = targetW / origW;
      if (Math.max(origW, origH) * scale > MAX_OUTPUT_SIDE) targetW = Math.round(MAX_OUTPUT_SIDE / Math.max(origW, origH) * origW);
      const targetH = Math.round(origH * (targetW / origW));

      const outputBuffer = await sharp(imgBuffer)
        .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
        .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
        .toBuffer();
      imageData = outputBuffer.toString('base64');
      imageMimeType = 'image/jpeg';
    } catch (processErr) {
      console.warn('Image post-processing failed, returning raw:', processErr);
    }

    delivered = true;
    return res.status(200).json({
      image_base64: imageData,
      mime_type: imageMimeType,
      text: textResponse,
      aspect_ratio: aspectRatio,
    });
  } catch (err: any) {
    console.error('Image generation error:', err);

    // Handle safety filter blocks
    if (err?.message?.includes('SAFETY') || err?.message?.includes('blocked')) {
      return res.status(400).json({ error: 'Image blocked by safety filter', code: 'ai_image_blocked' });
    }

    return res.status(500).json({ error: 'AI image generation failed', code: 'ai_image_failed' });
  } finally {
    if (!delivered) void refundCredits(user.id, creditRef).catch((e) => console.error('AI credits refund failed:', e));
  }
}
