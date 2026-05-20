import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb', // Reference images can be large
    },
  },
};

// Gemini image generation model — Nano Banana 2 (best quality-to-speed, up to 4K)
const MODEL = 'gemini-3.1-flash-image-preview';

// Crop bottom pixels to remove AI watermark/branding
const WATERMARK_CROP_PX = 20;

/** Block SSRF: reject non-https or internal/private IPs */
function isUnsafeUrl(url: string): boolean {
  if (!url.startsWith('https://')) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('0.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ortam degiskeni tanimli degil' });
  }

  const { prompt, reference_image, reference_mime_type, reference_image_url, aspect_ratio } = req.body;

  // Validate reference_image_url against SSRF
  if (reference_image_url && isUnsafeUrl(reference_image_url)) {
    return res.status(400).json({ error: 'Invalid reference_image_url: must be a public https URL' });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Build content parts
    const parts: any[] = [];

    // Add reference image — either from base64 or URL
    if (reference_image && reference_mime_type) {
      // Strip data URI prefix if present
      const base64Data = reference_image.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: reference_mime_type,
          data: base64Data,
        },
      });
    } else if (reference_image_url) {
      // Fetch image from URL (e.g. existing Etsy listing image)
      try {
        const imgRes = await fetch(reference_image_url);
        if (!imgRes.ok) throw new Error(`Failed to fetch reference image: ${imgRes.status}`);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType: contentType,
            data: imgBuffer.toString('base64'),
          },
        });
      } catch (fetchErr: any) {
        console.warn('Failed to fetch reference image URL, proceeding without reference:', fetchErr.message);
      }
    }

    // Enhance prompt for e-commerce product images
    const hasReference = parts.some((p) => p.inlineData);
    const enhancedPrompt = hasReference
      ? `Using the reference image above as inspiration, create a professional e-commerce product photo: ${prompt.trim()}. Clean white background, high resolution, no text or watermarks on the image.`
      : `Create a professional e-commerce product photo: ${prompt.trim()}. Clean white background, high resolution, no text or watermarks on the image.`;

    parts.push({ text: enhancedPrompt });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    // Extract image from response
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      return res.status(500).json({ error: 'AI gorsel olusturamadi — bos yanit' });
    }

    const responseParts = candidates[0].content?.parts;
    if (!responseParts) {
      return res.status(500).json({ error: 'AI gorsel olusturamadi — icerik yok' });
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
      return res.status(500).json({
        error: 'AI gorsel olusturamadi',
        text: textResponse || 'Gorsel uretimi basarisiz oldu',
      });
    }

    // Post-process: crop bottom to remove AI watermark, resize for marketplace use
    // Etsy recommends 2000x2000px, eBay recommends 1600x1600px — use 2000px for both
    try {
      const imgBuffer = Buffer.from(imageData, 'base64');
      const metadata = await sharp(imgBuffer).metadata();
      const origW = metadata.width || 1024;
      const origH = metadata.height || 1024;

      let processed = sharp(imgBuffer);

      // Crop bottom watermark area (Gemini adds a small branding strip)
      if (origH > WATERMARK_CROP_PX * 2) {
        processed = processed.extract({
          left: 0,
          top: 0,
          width: origW,
          height: origH - WATERMARK_CROP_PX,
        });
      }

      // Resize to marketplace-optimal dimensions (2000px longest side)
      processed = processed.resize(2000, 2000, {
        fit: 'inside',
        withoutEnlargement: false,
      });

      // Output as high-quality JPEG (smaller file size, widely supported)
      const outputBuffer = await processed.jpeg({ quality: 93 }).toBuffer();
      imageData = outputBuffer.toString('base64');
      imageMimeType = 'image/jpeg';
    } catch (processErr) {
      console.warn('Image post-processing failed, returning raw:', processErr);
    }

    return res.status(200).json({
      image_base64: imageData,
      mime_type: imageMimeType,
      text: textResponse,
    });
  } catch (err: any) {
    console.error('Image generation error:', err);

    // Handle safety filter blocks
    if (err.message?.includes('SAFETY') || err.message?.includes('blocked')) {
      return res.status(400).json({
        error: 'Gorsel guvenlik filtresi nedeniyle uretilemedi. Farkli bir prompt deneyin.',
      });
    }

    return res.status(500).json({
      error: err.message || 'Gorsel olusturma hatasi',
    });
  }
}
