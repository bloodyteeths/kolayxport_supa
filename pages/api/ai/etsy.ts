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
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    } as any,
  });
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSuggestTags(body: any) {
  const { title, description, tags_current, category } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

ETSY SEO BEST PRACTICES (2026):
- Etsy uses a hybrid AI + keyword matching search (XWalk system). Tags are still critically important.
- Each tag can be up to 20 characters. Use all 13 tag slots.
- Multi-word long-tail tags perform better than single-word tags (e.g., "personalized gift mom" > "gift").
- Tags should match what BUYERS type in the Etsy search bar, not what sellers think.
- Include a mix of: specific product terms, occasion/use-case tags, style/aesthetic tags, and recipient tags.
- Avoid repeating words already in the title — Etsy indexes title and tags together.
- Regional spelling matters: include both "jewelry" and "jewellery" variations if relevant.
- Trending seasonal tags get boosted in search during relevant periods.
- Etsy now weighs listing quality score (conversion rate, reviews) alongside keyword relevance.

Suggest exactly 13 Etsy search tags for this listing. Do NOT repeat any current tags.
Return JSON: { "suggestions": ["tag1", "tag2", ...] }

Title: ${title}
Description: ${description || 'N/A'}
Current tags: ${Array.isArray(tags_current) ? tags_current.join(', ') : tags_current || 'None'}
Category: ${category || 'N/A'}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { suggestions: parsed.suggestions } };
}

async function handleOptimizeTitle(body: any) {
  const { title, description, tags, category } = body;

  if (!title) {
    return { status: 400, data: { error: 'title alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

ETSY TITLE OPTIMIZATION BEST PRACTICES (2026):
- Etsy uses a hybrid AI + keyword matching search (XWalk system). Titles are the MOST important ranking factor.
- Keep under 140 characters but USE most of the space — longer, keyword-rich titles rank better.
- Front-load the most important, high-search-volume keywords in the first 40 characters (shown in search results).
- Use natural, readable phrasing — Etsy's AI penalizes keyword stuffing and unnatural word salads.
- Include long-tail keyword phrases that match buyer search intent (e.g., "personalized gift for mom" not just "gift").
- Separate keyword phrases with natural connectors: commas, pipes (|), dashes, or "for".
- Include: product type, material, style/aesthetic, occasion/use-case, and recipient where relevant.
- Do NOT repeat words already covered by tags — Etsy indexes title and tags together.
- Regional spelling matters: prefer the marketplace's primary language/spelling.
- Etsy now weighs listing quality score (conversion, reviews) so titles must also be buyer-appealing, not just keyword-dense.

Optimize the following Etsy listing title for maximum search visibility and click-through rate.
Return a JSON object: { "optimized_title": "...", "explanation": "..." }

Current title: ${title}
Description: ${description || 'N/A'}
Tags: ${Array.isArray(tags) ? tags.join(', ') : tags || 'N/A'}
Category: ${category || 'N/A'}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return {
    status: 200,
    data: {
      optimized_title: parsed.optimized_title,
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

ETSY DESCRIPTION BEST PRACTICES (2026):
- Etsy's XWalk AI system now indexes descriptions for search ranking — keyword placement matters.
- The first 160 characters appear as the meta description in Google results and Etsy's listing preview. Make them compelling and keyword-rich.
- Use natural, conversational language — Etsy's AI rewards authentic seller voice over generic copy.
- Structure with short paragraphs (2-3 sentences), use line breaks for scannability on mobile.
- Include relevant keywords naturally in the first 2 paragraphs — this is where search weight is highest.
- Mention: materials, dimensions/sizing, care instructions, what makes it unique, and who it's for.
- Address common buyer questions preemptively (shipping time, customization options, gift wrapping).
- Include occasion/use-case keywords (birthday gift, wedding favor, home decor, nursery) for discovery.
- If the product is personalized/customizable, clearly explain HOW to provide customization details.
- Etsy now factors listing quality score (conversion rate) — descriptions that reduce buyer uncertainty improve rankings.
- Do NOT use ALL CAPS, excessive punctuation, or spammy formatting.

Write an SEO-optimized, buyer-friendly Etsy listing description.
If an existing description is given, improve it while keeping the seller's voice.
Return a JSON object: { "description": "..." }

Title: ${title}
Tags: ${Array.isArray(tags) ? tags.join(', ') : tags || 'N/A'}
Materials: ${Array.isArray(materials) ? materials.join(', ') : materials || 'N/A'}
Category: ${category || 'N/A'}${improvePart}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { description: parsed.description } };
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

  const prompt = `You are a top Etsy SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

ETSY SEO BEST PRACTICES (2026):
- Etsy uses a hybrid AI + keyword matching search (XWalk system). Tags, titles, and descriptions all contribute to ranking.
- TITLES: Front-load high-volume keywords in the first 40 chars. Use up to 140 chars. Natural, readable phrasing — no keyword stuffing.
- TAGS: Each tag up to 20 characters, use all 13 slots. Multi-word long-tail tags outperform single words. Don't repeat title words in tags.
- DESCRIPTIONS: First 160 chars = meta preview. Include keywords naturally in first 2 paragraphs. Short paragraphs, mobile-friendly.
- Include a mix of: product type, material, style, occasion, recipient, and trending seasonal terms.
- Etsy now weighs listing quality score (conversion rate, reviews) alongside keyword relevance.
- Regional spelling variations matter (jewelry/jewellery).
- Write for BUYERS, not search engines — natural language that converts.

Optimize the following listings for maximum search visibility and conversion.
For each listing provide:
- An improved title (max 140 chars, front-loaded keywords)
- 13 SEO tags (multi-word long-tail, no title word repetition)
- An improved description (first 160 chars compelling, keyword-rich)
Return a JSON object: { "optimizations": [ { "listing_id": ..., "title": "...", "tags": ["..."], "description": "..." }, ... ] }

${listingSummaries}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(text);

  return { status: 200, data: { optimizations: parsed.optimizations } };
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
      default:
        return res.status(400).json({
          error: `Geçersiz action: "${action}". Desteklenen eylemler: suggest_tags, optimize_title, generate_description, generate_alt_text, bulk_optimize`,
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
