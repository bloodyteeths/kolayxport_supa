import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.query.action as string;

  try {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' } as any,
    });

    // ================================================================
    // OPTIMIZE TITLE
    // ================================================================
    if (action === 'optimize_title') {
      const { title, brand, categoryName, competitorTitles } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const prompt = `Sen bir Trendyol SEO uzmanısın. Bu ürün başlığını optimize et.

Mevcut başlık: "${title}"
Marka: ${brand || 'Belirtilmemiş'}
Kategori: ${categoryName || 'Belirtilmemiş'}
${competitorTitles?.length ? `Rakip başlıklar: ${competitorTitles.slice(0, 5).join('; ')}` : ''}

Kurallar:
- Türkçe olmalı
- 80-150 karakter arası
- Marka adı başta
- Ana ürün adı + önemli özellikler (renk, boyut, malzeme)
- Arama optimizasyonu için popüler terimleri kullan
- Gereksiz tekrar ve dolgu kelimelerinden kaçın
- Başlık doğal okunmalı

JSON döndür: {"optimizedTitle": "...", "tips": ["öneri1", "öneri2"]}`;

      const response = await model.generateContent(prompt);
      let raw = response.response.text().trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();

      try {
        const parsed = JSON.parse(raw);
        return res.status(200).json(parsed);
      } catch {
        return res.status(200).json({ optimizedTitle: raw, tips: [] });
      }
    }

    // ================================================================
    // OPTIMIZE DESCRIPTION
    // ================================================================
    if (action === 'optimize_description') {
      const { title, description, brand, categoryName, attributes } = req.body;

      const prompt = `Sen bir Trendyol ürün açıklaması uzmanısın. Bu ürün için SEO-optimize bir açıklama yaz.

Ürün: "${title}"
Marka: ${brand || 'Belirtilmemiş'}
Kategori: ${categoryName || 'Belirtilmemiş'}
Mevcut açıklama: ${description ? `"${description.substring(0, 500)}"` : 'Yok'}
Özellikler: ${attributes ? JSON.stringify(attributes.slice(0, 10)) : 'Yok'}

Kurallar:
- Türkçe olmalı
- 300-800 karakter arası
- İlk cümlede ürünün ana faydası
- Temel özellikleri bullet point olarak listele
- Arama terimlerini doğal olarak dahil et
- Samimi ama profesyonel ton
- Gereksiz tekrarlardan kaçın

JSON döndür: {"description": "...", "wordCount": number}`;

      const response = await model.generateContent(prompt);
      let raw = response.response.text().trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();

      try {
        const parsed = JSON.parse(raw);
        return res.status(200).json(parsed);
      } catch {
        return res.status(200).json({ description: raw, wordCount: 0 });
      }
    }

    // ================================================================
    // SUGGEST ATTRIBUTES
    // ================================================================
    if (action === 'suggest_attributes') {
      const { title, categoryAttributes } = req.body;
      if (!title || !categoryAttributes) {
        return res.status(400).json({ error: 'title and categoryAttributes are required' });
      }

      const prompt = `Sen bir Trendyol ürün uzmanısın. Bu ürün için kategori özelliklerini öner.

Ürün: "${title}"

Mevcut kategori özellikleri (attributeId, name, allowedValues):
${JSON.stringify(categoryAttributes.slice(0, 15), null, 2)}

Her özellik için en uygun değeri seç. Sadece verilen allowedValues'dan seç. Emin olmadığın özellikleri atla.

JSON döndür: [{"attributeId": number, "attributeValueId": number, "reason": "neden bu değer"}]`;

      const response = await model.generateContent(prompt);
      let raw = response.response.text().trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();

      try {
        const parsed = JSON.parse(raw);
        return res.status(200).json({ suggestions: Array.isArray(parsed) ? parsed : [] });
      } catch {
        return res.status(200).json({ suggestions: [] });
      }
    }

    // ================================================================
    // ANALYZE LISTING HEALTH
    // ================================================================
    if (action === 'analyze_listing') {
      const { product } = req.body;
      if (!product) {
        return res.status(400).json({ error: 'product is required' });
      }

      const modelText = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `Sen bir Trendyol listing optimizasyon uzmanısın. Bu ürün listesini analiz et ve iyileştirme önerileri ver.

Ürün: ${JSON.stringify({
        title: product.title,
        description: product.description?.substring(0, 300),
        brand: product.brandName,
        category: product.categoryName,
        listPrice: product.listPrice,
        salePrice: product.salePrice,
        imageCount: product.imageCount,
        attributes: product.attributes,
        approved: product.approved,
        rejected: product.rejected,
        rejectReasons: product.rejectReasons,
      })}

Analiz et:
1. Başlık kalitesi (80-150 karakter, marka dahil, anahtar kelimeler)
2. Açıklama kalitesi (300+ karakter, özellik listesi)
3. Görsel sayısı (5+ ideal)
4. Fiyat stratejisi (indirim var mı)
5. Özellik doluluk oranı
6. Reddedilme nedenlerini çöz

Türkçe yanıt ver. Kısa ve aksiyon odaklı.`;

      const response = await modelText.generateContent(prompt);
      return res.status(200).json({ analysis: response.response.text() });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error: any) {
    logger.error('Trendyol AI API error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
