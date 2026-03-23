import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb', // Reference images can be large
    },
  },
};

// Gemini image generation model — 2.5 Flash with native image generation
const MODEL = 'gemini-2.5-flash-preview-image-generation';

// Crop bottom pixels to remove AI watermark/branding
const WATERMARK_CROP_PX = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ortam degiskeni tanimli degil' });
  }

  const { prompt, reference_image, reference_mime_type, aspect_ratio } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Build content parts
    const parts: any[] = [];

    // Add reference image if provided
    if (reference_image && reference_mime_type) {
      // Strip data URI prefix if present
      const base64Data = reference_image.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: reference_mime_type,
          data: base64Data,
        },
      });
    }

    // Enhance prompt for e-commerce product images
    const enhancedPrompt = reference_image
      ? `Using the reference image above as inspiration, create a professional e-commerce product photo: ${prompt.trim()}. Clean white background, high resolution, no text or watermarks on the image.`
      : `Create a professional e-commerce product photo: ${prompt.trim()}. Clean white background, high resolution, no text or watermarks on the image.`;

    parts.push({ text: enhancedPrompt });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        responseMimeType: 'image/png',
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
