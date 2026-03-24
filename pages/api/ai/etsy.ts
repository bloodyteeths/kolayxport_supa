import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Rate limiter – simple in-memory, max 30 req/min per user
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ortam değişkeni tanımlı değil.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    } as any,
  });
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function buildMarketContextPrompt(mc: any): string {
  if (!mc) return '';
  const tags = Array.isArray(mc.topTags) ? mc.topTags.slice(0, 20).map((t: any) => `${t.tag} (${t.pct}%)`).join(', ') : 'N/A';
  const keywords = Array.isArray(mc.topKeywords) ? mc.topKeywords.slice(0, 15).map((k: any) => `${k.keyword} (${k.pct}%)`).join(', ') : 'N/A';
  const priceRange = mc.priceStats ? `$${mc.priceStats.min} - $${mc.priceStats.max} (avg: $${mc.priceStats.avg})` : 'N/A';
  return `

MARKET RESEARCH DATA (real competitor analysis for "${mc.query || 'N/A'}"):
- Top competitor tags by frequency: ${tags}
- Top title keywords by frequency: ${keywords}
- Market price range: ${priceRange}

YOU MUST USE THIS DATA. Your keyword choices MUST be informed by this research:
- Pick keywords that appear in competitor titles (proven demand) but combine them in UNIQUE phrases
- Identify gaps — keywords competitors use that the current listing is missing
- Don't just copy the top keywords — find the sweet spot between high-demand and less competitive terms
- Use research to understand buyer language and search patterns for this niche`;
}

async function handleSuggestTags(body: any) {
  const { title, description, tags_current, category } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist. Your job is to suggest research-backed, high-converting Etsy tags.

PRODUCT RELEVANCE (MOST IMPORTANT RULE):
- Every single tag MUST be directly relevant to THIS SPECIFIC PRODUCT described in the title and description.
- Read the title carefully — if it says "baby girl dress", every tag must relate to baby/toddler girl dresses/clothing.
- NEVER suggest tags for unrelated product categories, themes, or niches.
- If market research data mentions unrelated competitor keywords, IGNORE THEM — only use keywords relevant to this product.
- Ask yourself for EACH tag: "Would a buyer searching this tag expect to find THIS exact product?" If no, discard it.

ETSY TAG STRATEGY (2026 — XWalk system):
- Tags are indexed TOGETHER with the title. Tags should EXPAND search reach, not repeat title words.
- Each tag can be up to 20 characters. Use all 13 slots — every empty slot is a missed search opportunity.
- Multi-word long-tail tags outperform single words (e.g., "gift for new mom" > "gift").
- Tags should match what BUYERS actually type in search, not seller jargon.

KEYWORD SELECTION:
- NEVER repeat words that are already in the title — title and tags work as a combined keyword set.
- Include a strategic mix of tags DIRECTLY RELATED to this product:
  * Product-specific terms (what it IS — material, style, type)
  * Occasion/use-case tags (when/why buyers need it — birthday, holiday, photo shoot)
  * Recipient tags (who it's for — baby, toddler, infant, newborn)
  * Style/aesthetic tags (how it looks — boho, vintage, rustic, modern)
- Use market research data to pick PROVEN keywords, but ONLY ones relevant to this product.
- Regional spelling variations if relevant (jewelry/jewellery, color/colour).

HARD LIMITS:
- MAXIMUM 20 CHARACTERS per tag. Tags over 20 chars will be REJECTED.
- Count characters carefully. Shorten if needed (e.g., "personalized wooden sign" → "custom wooden sign").

WHAT NOT TO DO:
- NO single-word tags (waste of a slot)
- NO repeating ANY word from the title
- NO generic tags like "gift" or "handmade" alone — always combine into long-tail phrases
- NO duplicate meaning across tags (e.g., "mom gift" and "gift for mom" cover the same search)
- NO tags longer than 20 characters
- NO tags for unrelated products, themes, or niches — STAY ON TOPIC

Suggest exactly 13 tags, each MAXIMUM 20 characters. Do NOT repeat any current tags.
Return JSON: { "suggestions": ["tag1", "tag2", ...] }

Title: ${title}
Description: ${description || 'N/A'}
Current tags: ${Array.isArray(tags_current) ? tags_current.join(', ') : tags_current || 'None'}
Category: ${category || 'N/A'}${buildMarketContextPrompt(body.market_context)}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  // Post-process: enforce Etsy's 20-char tag limit
  const suggestions = (parsed.suggestions || []).map((tag: string) => {
    let t = tag.trim().toLowerCase();
    if (t.length > 20) {
      // Try to cut at last space before 20 chars
      const cut = t.substring(0, 20).lastIndexOf(' ');
      t = cut > 10 ? t.substring(0, cut).trim() : t.substring(0, 20).trim();
    }
    return t;
  }).filter((t: string) => t.length > 0 && t.length <= 20);

  return { status: 200, data: { suggestions } };
}

async function handleOptimizeTitle(body: any) {
  const { title, description, tags, category } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist. Your job is to craft a research-backed, high-converting Etsy listing title.

ETSY SEARCH ALGORITHM (2026 — XWalk system):
- Titles are the #1 ranking factor. Etsy's AI matches buyer queries against listing titles.
- First 40 characters are shown in search results — this MUST contain the primary product identity.
- Etsy indexes title + tags TOGETHER. Words in the title should NOT be repeated in tags and vice versa.
- Listing quality score (CTR, conversion, reviews) is a major ranking factor — titles must appeal to BUYERS, not just search engines.

KEYWORD STRATEGY (CRITICAL):
- Keywords MUST come from market research data (provided below), NOT from generic guessing.
- Analyze competitor keywords to find PROVEN high-demand terms.
- Combine researched keywords into UNIQUE natural phrases — don't just stack individual keywords.
- Each comma-separated phrase should be a natural long-tail search term a buyer would actually type.
  GOOD: "Personalized Baby Name Sign, Nursery Wall Decor, New Mom Gift"
  BAD: "Personalized Baby Name Sign Nursery Wall Decor Gift Custom Wood" (keyword stacking)
- NO word should appear more than ONCE in the entire title (exception: very common words like "for").
- Find the balance: use high-demand keywords from research BUT also include less competitive terms for differentiation.
- Include relevant: product type, material, style/aesthetic, occasion, recipient.

FORMATTING RULES:
- Title Case: Capitalize First Letter of Each Word, except small words (for, of, the, and, with, to, in, on, a, an).
- Use ONLY commas to separate phrases. No dashes, pipes, slashes, colons, or other special characters.
- Length: 100-140 characters. Every character counts — no wasted space.

WHAT NOT TO DO:
- NO keyword stuffing or stacking random words without forming readable phrases.
- NO repeating the same word multiple times.
- NO generic filler words that don't help search (e.g., "Beautiful", "Amazing", "Best").
- NO duplicating words that are already in the listing's tags.

Optimize this title. Use the market research data to select proven keywords.
Return JSON: { "optimized_title": "...", "explanation": "Brief explanation of keyword choices and strategy" }

Current title: ${title}
Description: ${description || 'N/A'}
Current tags (DO NOT repeat these words in title): ${Array.isArray(tags) ? tags.join(', ') : tags || 'None'}
Category: ${category || 'N/A'}${buildMarketContextPrompt(body.market_context)}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  // Post-process: enforce formatting rules
  // Gemini sometimes returns title as array of words instead of string
  const rawTitle = parsed.optimized_title;
  let optimizedTitle = '';
  if (typeof rawTitle === 'string') {
    optimizedTitle = rawTitle.trim();
  } else if (Array.isArray(rawTitle)) {
    // Join with spaces — String(array) would join with commas producing garbage
    optimizedTitle = rawTitle.filter((w: any) => typeof w === 'string' && w.trim().length > 1).join(' ').trim();
  } else if (rawTitle && typeof rawTitle === 'object' && rawTitle.text) {
    optimizedTitle = String(rawTitle.text).trim();
  }

  if (optimizedTitle) {
    // Replace standalone dashes, pipes, slashes, colons used as separators with commas
    // Use explicit unicode escapes to avoid charset issues in production builds
    optimizedTitle = optimizedTitle.replace(/\s+[-\u2013\u2014|/:\\]\s+/g, ', ');
    // Clean up double commas and trailing commas
    optimizedTitle = optimizedTitle.replace(/,\s*,/g, ',').replace(/,\s*$/, '');

    // Remove duplicate words (keep first occurrence, skip small words)
    const smallWords = new Set(['for', 'of', 'the', 'and', 'with', 'to', 'in', 'on', 'a', 'an', 'by', 'or', 'at']);
    const seenWords = new Set<string>();
    optimizedTitle = optimizedTitle
      .split(' ')
      .filter((word) => {
        const clean = word.toLowerCase().replace(/[,]/g, '');
        if (!clean || smallWords.has(clean)) return true; // always keep small words
        if (seenWords.has(clean)) return false; // remove duplicate
        seenWords.add(clean);
        return true;
      })
      .join(' ');

    // Clean up any double spaces or orphaned commas from dedup
    optimizedTitle = optimizedTitle.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();

    // Enforce Title Case
    optimizedTitle = optimizedTitle
      .split(' ')
      .map((word, i) => {
        const lower = word.toLowerCase();
        if (i === 0 || !smallWords.has(lower.replace(/,/g, ''))) {
          return lower.charAt(0).toUpperCase() + lower.slice(1).toLowerCase();
        }
        return lower;
      })
      .join(' ');

    // Trim to 140 chars at last comma boundary
    if (optimizedTitle.length > 140) {
      const cut = optimizedTitle.substring(0, 140).lastIndexOf(',');
      optimizedTitle = (cut > 60 ? optimizedTitle.substring(0, cut) : optimizedTitle.substring(0, 140)).replace(/,\s*$/, '').trim();
    }

    // Sanity check: reject garbled output (mostly single-character words)
    const words = optimizedTitle.split(/[\s,]+/).filter(Boolean);
    const singleCharWords = words.filter((w) => w.length <= 1 && !smallWords.has(w.toLowerCase()));
    if (words.length > 3 && singleCharWords.length > words.length * 0.4) {
      console.error('[AI Etsy] Title sanity check failed — garbled output:', optimizedTitle, '| raw:', rawTitle);
      optimizedTitle = '';
    }
  }

  if (!optimizedTitle) {
    return { status: 400, data: { error: 'AI bozuk baslik uretti — lutfen tekrar deneyin.' } };
  }

  return {
    status: 200,
    data: {
      optimized_title: optimizedTitle,
      explanation: parsed.explanation,
    },
  };
}

async function handleGenerateDescription(body: any) {
  const { title, tags, materials, category, existing_description } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const improvePart = existing_description
    ? `\nAn existing description is provided – improve it while keeping the seller's voice:\n${existing_description}`
    : '';

  const prompt = `You are a top Etsy copywriting and SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

CRITICAL: PRODUCT RELEVANCE
- Read the title carefully and write a description ONLY about THIS SPECIFIC PRODUCT.
- Every sentence must describe, sell, or provide information about this exact product.
- Do NOT add generic filler paragraphs that could apply to any product.
- Do NOT invent product features, materials, or dimensions not mentioned in the title/tags/materials.

STRUCTURE (follow this order):
1. **Hook paragraph** (first 160 chars): Compelling, keyword-rich opening that describes what the product IS and who it's for. This appears in Google and Etsy previews.
2. **Product details**: What it's made of, how it looks, size/dimensions if known. Only mention details you can infer from the title and materials provided.
3. **Why buy this**: What makes it special — unique selling points, quality, handmade aspects.
4. **Perfect for**: Occasions and recipients (gift ideas, use cases) relevant to this product type.
5. **Customization/ordering info**: Only if the title suggests personalization. Otherwise skip this section.

WRITING STYLE:
- Write in English. Use natural, warm, conversational language — like a skilled seller talking to a buyer.
- Short paragraphs (2-3 sentences max). Use \\n\\n between paragraphs for mobile readability.
- Include relevant keywords from the title and tags naturally — not forced.
- Be specific and honest — don't oversell or make claims you can't support from the product info given.
- Total length: 600-1200 characters. Concise but complete.

WHAT NOT TO DO:
- NO ALL CAPS, excessive exclamation marks, or spammy formatting.
- NO generic filler like "This is the perfect gift for anyone!" without context.
- NO inventing specific measurements, materials, or features not in the provided info.
- NO repeating the same selling point multiple times.
- NO emoji unless the product is clearly targeting a casual/fun audience.

Write an SEO-optimized, buyer-friendly Etsy listing description.
If an existing description is given, improve it while keeping the seller's voice and any specific product details they've included.
Return a JSON object: { "description": "..." }

Title: ${title}
Tags: ${Array.isArray(tags) ? tags.join(', ') : tags || 'N/A'}
Materials: ${Array.isArray(materials) ? materials.join(', ') : materials || 'N/A'}
Category: ${category || 'N/A'}${improvePart}${buildMarketContextPrompt(body.market_context)}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  const description = (parsed.description || '').trim();
  if (!description) {
    return { status: 400, data: { error: 'AI aciklama olusturamadi — tekrar deneyin.' } };
  }

  return { status: 200, data: { description } };
}

async function handleGenerateAltText(body: any) {
  const { title, description, image_url } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

ETSY IMAGE ALT TEXT BEST PRACTICES (2026):
- Etsy now uses alt text as a ranking signal in both Etsy search and Google Image search.
- Maximum 250 characters — use as much of this space as possible.
- Describe the product visually: color, material, size, style, and context/setting.
- Include the primary product keyword naturally in the first few words.
- Write for both accessibility (screen readers) and SEO — describe what a buyer would SEE.
- Include occasion/use-case context when relevant (e.g., "on a nursery shelf", "worn as a necklace").
- Do NOT keyword-stuff or use commas to list unrelated keywords — Etsy's AI detects and penalizes this.
- Do NOT start with "Image of" or "Photo of" — go straight to describing the product.
- Regional spelling should match the target marketplace.

Generate SEO-optimized alt text for this Etsy product image.
Return a JSON object: { "alt_text": "..." }

Product title: ${title}
Description: ${description || 'N/A'}
Image URL: ${image_url || 'N/A'}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { alt_text: parsed.alt_text } };
}

async function handleMarketAnalysis(body: any) {
  const { query, totalResults, priceStats, topTags, topKeywords, shopCount,
          avgFavorites, avgViews, topShops } = body;

  if (!query) {
    return { status: 400, data: { error: 'query alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `Sen Etsy pazar araştırma ve strateji uzmanısın. Mart 2026 itibarıyla Etsy'nin arama algoritması, trendleri ve satıcı stratejileri hakkında derin bilgiye sahipsin.

ÖNEMLİ DİL KURALI: Etsy alıcıları İngilizce arama yaptığı için tüm Etsy anahtar kelimeleri, tagleri, arama terimleri, niş terimleri ve başlık önerileri MUTLAKA İNGİLİZCE olmalıdır. Sadece analiz metni, açıklamalar ve yorumlar Türkçe olmalıdır. tag_recommendations dizisi tamamen İngilizce Etsy tagleri içermelidir. niche_positioning ve title_recommendations içindeki anahtar kelimeler/örnekler İngilizce olmalıdır.

Bir satıcı "${query}" anahtar kelimesi ile pazar araştırması yaptı. İşte toplanan veriler:

PAZAR VERİLERİ:
- Toplam sonuç: ${totalResults || 'N/A'}
- Benzersiz mağaza sayısı: ${shopCount || 'N/A'}
- Fiyat istatistikleri: Min: $${priceStats?.min || 'N/A'}, Ort: $${priceStats?.avg || 'N/A'}, Medyan: $${priceStats?.median || 'N/A'}, Max: $${priceStats?.max || 'N/A'}
- Ortalama favori: ${avgFavorites || 'N/A'}
- Ortalama görüntülenme: ${avgViews || 'N/A'}
- En çok kullanılan etiketler: ${Array.isArray(topTags) ? topTags.slice(0, 20).map((t: any) => `${t.tag} (%${t.pct})`).join(', ') : 'N/A'}
- En çok kullanılan başlık kelimeleri: ${Array.isArray(topKeywords) ? topKeywords.slice(0, 15).map((k: any) => `${k.keyword} (%${k.pct})`).join(', ') : 'N/A'}
- En iyi mağazalar: ${Array.isArray(topShops) ? topShops.slice(0, 5).map((s: any) => `${s.shop_name} (${s.num_sales} satış, ${s.review_average}★)`).join(', ') : 'N/A'}

Analiz metnini Türkçe, tüm anahtar kelime/tag/başlık önerilerini İngilizce olarak JSON formatında döndür:
{
  "opportunity_score": 0-100 arası puan,
  "opportunity_level": "Yüksek" | "Orta" | "Düşük",
  "market_summary": "2-3 cümlelik pazar özeti (Türkçe)",
  "pricing_strategy": "Önerilen fiyatlandırma stratejisi (Türkçe, 3-4 cümle)",
  "tag_recommendations": ["english tag 1", "english tag 2", ...] (en fazla 10, MUTLAKA İNGİLİZCE Etsy tagleri),
  "title_recommendations": "Başlık optimizasyonu önerileri (Türkçe açıklama, İngilizce keyword örnekleri)",
  "niche_positioning": "Niş pozisyonlama stratejisi (Türkçe açıklama, İngilizce niş terimleri, ör: 'boho flower girl dresses')",
  "seasonal_advice": "Mevsimsel tavsiyeler (Türkçe, 2-3 cümle)",
  "competition_analysis": "Rekabet analizi (Türkçe, 3-4 cümle)",
  "action_items": ["yapılacak1", "yapılacak2", ...] (en fazla 7 madde, Türkçe ama keyword örnekleri İngilizce)
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { analysis: parsed } };
}

async function handleBulkOptimize(body: any) {
  const { listings } = body;

  if (!Array.isArray(listings) || listings.length === 0) {
    return { status: 400, data: { error: 'listings alanı boş olamaz.' } };
  }

  if (listings.length > 20) {
    return { status: 400, data: { error: 'Tek seferde en fazla 20 liste gönderilebilir.' } };
  }

  const model = getGeminiModel();
  const listingSummaries = listings.map((l: any, i: number) => {
    return `Listing ${i + 1} (ID: ${l.listing_id}):
  Title: ${l.title}
  Description: ${(l.description || '').slice(0, 200)}
  Tags: ${Array.isArray(l.tags) ? l.tags.join(', ') : l.tags || 'N/A'}
  Category: ${l.category || 'N/A'}`;
  }).join('\n\n');

  const prompt = `You are a top Etsy SEO specialist. Optimize listings using research-backed keyword strategy.

ETSY SEO RULES (2026 — XWalk system):
TITLES:
- 100-140 chars. Front-load primary product identity in first 40 chars.
- Title Case (Capitalize Each Word, except: for, of, the, and, with, to, in, on, a, an).
- Commas ONLY as separators. No dashes, pipes, slashes, colons.
- Each comma-separated phrase must be a natural long-tail search term buyers would type.
- NO keyword stacking (random words without forming readable phrases).
- NO word repetition — each word appears at most once.
- NO generic filler ("Beautiful", "Amazing", "Best Quality").

TAGS:
- All 13 slots used. Each tag up to 20 chars. Multi-word long-tail only.
- Tags MUST NOT repeat any word from the title — title + tags form one combined keyword set.
- NO duplicate-meaning tags covering the same search intent.

DESCRIPTIONS:
- First 160 chars = meta preview (Google + Etsy). Make it compelling and keyword-rich.
- Natural buyer-friendly language. Short paragraphs for mobile.

For each listing, title words and tag words should have ZERO overlap.

Return JSON: { "optimizations": [ { "listing_id": ..., "title": "...", "tags": ["..."], "description": "..." }, ... ] }

${listingSummaries}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { optimized: parsed.optimizations || parsed.optimized } };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST metodu desteklenmektedir.' });
  }

  // --- Auth: session-based via Supabase ---
  let userId: string | null = null;

  try {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ error: 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.' });
    }
    userId = user.id;
  } catch {
    return res.status(401).json({ error: 'Kimlik doğrulama başarısız.' });
  }

  // --- Rate limit ---
  if (!checkRateLimit(userId)) {
    return res.status(429).json({
      error: 'Çok fazla istek gönderdiniz. Lütfen bir dakika bekleyip tekrar deneyin.',
    });
  }

  // --- Route by action ---
  const { action, ...body } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'action alanı zorunludur.' });
  }

  try {
    let result: { status: number; data: any };

    switch (action) {
      case 'suggest_tags':
        result = await handleSuggestTags(body);
        break;
      case 'optimize_title':
        result = await handleOptimizeTitle(body);
        break;
      case 'generate_description':
        result = await handleGenerateDescription(body);
        break;
      case 'generate_alt_text':
        result = await handleGenerateAltText(body);
        break;
      case 'bulk_optimize':
        result = await handleBulkOptimize(body);
        break;
      case 'market_analysis':
        result = await handleMarketAnalysis(body);
        break;
      default:
        return res.status(400).json({
          error: `Geçersiz action: "${action}". Desteklenen eylemler: suggest_tags, optimize_title, generate_description, generate_alt_text, bulk_optimize, market_analysis`,
        });
    }

    return res.status(result.status).json(result.data);
  } catch (err: any) {
    console.error('[AI Etsy] Gemini hatası:', err);

    if (err.message?.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: err.message });
    }

    return res.status(500).json({
      error: 'AI isteği işlenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
    });
  }
}
