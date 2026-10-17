import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  normalizeTitle, checkTitle, normalizeTags, tagKey, coerceAiString, coerceAiStringArray, looksGarbled,
  TITLE_MIN, TITLE_MAX, TAG_MAX_LEN, TAG_MAX_COUNT, type TitleCheck, type AiErrorCode,
} from '../../../lib/etsy/seoRules';
import { GEMINI_TEXT_MODEL } from '@/lib/ai/models';

// Allow up to 60s for AI responses (Vercel default is 10s)
export const config = { maxDuration: 60 };

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
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_TEXT_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
    } as any,
  });
}

// ---------------------------------------------------------------------------
// Helpers: error codes + safe JSON parsing
// ---------------------------------------------------------------------------

/** Error response with a stable `code` the client translates via i18n. */
function fail(status: number, code: AiErrorCode, error: string) {
  return { status, data: { error, code } };
}

/** Parse Gemini JSON output; tolerates ```json fences. Returns null on failure. */
function parseAiJson(text: string): any | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function listForPrompt(v: unknown): string {
  const arr = coerceAiStringArray(v);
  return arr.length ? arr.join(', ') : '';
}

/** Free-form user instructions are passed to the model, bounded and de-fanged. */
function sanitizeInstructions(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

const ENGLISH_RULE = 'All listing content you output (titles, tags, descriptions, keywords) MUST be in US English, even if the user instructions are written in another language.';

const TITLE_RULES = `TITLE RULES:
- ${TITLE_MIN}-${TITLE_MAX} characters. Front-load the primary product identity in the first 40 characters.
- Title Case (Capitalize Each Word, except small words: for, of, the, and, with, to, in, on, a, an).
- Commas are the ONLY separator. No dashes, pipes, slashes, colons, or other symbols between phrases.
- Each comma-separated phrase must be a natural long-tail search term a buyer would type.
- NO keyword stacking (strings of words without readable phrases).
- NO word may appear more than once (small words excepted).
- NO generic filler ("Beautiful", "Amazing", "Best Quality").`;

const TAG_RULES = `TAG RULES:
- Exactly ${TAG_MAX_COUNT} tags. Each tag MAXIMUM ${TAG_MAX_LEN} characters including spaces — count carefully; longer tags are discarded.
- Multi-word long-tail phrases buyers actually search (no single words).
- A tag must NOT contain ANY word that appears in the title — title + tags form one combined keyword set.
- NO near-duplicates (e.g. "mom gift" and "gift for mom", or singular/plural variants).
- Lowercase, letters/numbers/spaces only.`;

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function buildMarketContextPrompt(mc: any): string {
  if (!mc) return '';
  const tags = Array.isArray(mc.topTags) ? mc.topTags.slice(0, 20).map((t: any) => `${t.tag} (${t.pct}%)`).join(', ') : 'N/A';
  const keywords = Array.isArray(mc.topKeywords) ? mc.topKeywords.slice(0, 15).map((k: any) => `${k.keyword} (${k.pct}%)`).join(', ') : 'N/A';
  // R0: median only (the legacy `avg` slot carries the median; no means are sent).
  const priceRange = mc.priceStats ? `$${mc.priceStats.min} - $${mc.priceStats.max} (median: $${mc.priceStats.median ?? mc.priceStats.avg})` : 'N/A';
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
  const { description, category } = body;
  const title = coerceAiString(body.title);

  if (!title) {
    return fail(400, 'missing_title', 'title alanı zorunludur.');
  }

  // mode 'replace' = the caller will REPLACE all tags with the result, so the
  // strong current tags are candidates to keep. mode 'add' (default) = the
  // result is merged with the current tags, so don't repeat them.
  const mode: 'add' | 'replace' = body.mode === 'replace' ? 'replace' : 'add';
  const currentTags = coerceAiStringArray(body.tags_current);
  const currentList = currentTags.length ? currentTags.join(', ') : 'None';

  const currentTagInstruction = mode === 'replace'
    ? `The result will REPLACE all current tags. Keep any current tag that already follows every rule above and is strongly relevant; replace the weak, too-long, duplicate, or title-overlapping ones. Return the full final set of ${TAG_MAX_COUNT} tags.`
    : `The result will be ADDED to the current tags. Do NOT repeat or paraphrase any current tag.`;

  const model = getGeminiModel();
  const prompt = `You are a top Etsy SEO specialist. Your job is to suggest research-backed, high-converting Etsy tags.
${ENGLISH_RULE}

PRODUCT RELEVANCE (MOST IMPORTANT RULE):
- Every single tag MUST be directly relevant to THIS SPECIFIC PRODUCT described in the title and description.
- NEVER suggest tags for unrelated product categories, themes, or niches.
- If market research data mentions unrelated competitor keywords, IGNORE THEM.
- Ask yourself for EACH tag: "Would a buyer searching this tag expect to find THIS exact product?" If no, discard it.

ETSY TAG STRATEGY:
- Tags are indexed TOGETHER with the title. Tags should EXPAND search reach, not repeat title words.
- Use all ${TAG_MAX_COUNT} slots — every empty slot is a missed search opportunity.
- Strategic mix: product-specific terms, occasion/use-case, recipient, style/aesthetic.
- Use market research data to pick PROVEN keywords, but ONLY ones relevant to this product.

${TAG_RULES}

${currentTagInstruction}
Return JSON: { "suggestions": ["tag1", "tag2", ...] }

Title: ${title}
Description: ${coerceAiString(description).slice(0, 1500) || 'N/A'}
Current tags: ${currentList}
Category: ${coerceAiString(category) || 'N/A'}${buildMarketContextPrompt(body.market_context)}`;

  const result = await model.generateContent(prompt);
  const parsed = parseAiJson(result.response.text());
  const rawList = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed.suggestions ?? parsed.tags)
    : parsed; // model may return a bare array
  const { tags: normalized, dropped } = normalizeTags(rawList, { title, dropTitleOverlap: true });

  // In add mode, drop suggestions that duplicate an existing tag
  let suggestions = normalized;
  if (mode === 'add' && currentTags.length) {
    const existingKeys = new Set(currentTags.map((t) => tagKey(t) || t.toLowerCase()));
    suggestions = normalized.filter((t) => !existingKeys.has(tagKey(t) || t));
  }

  if (suggestions.length === 0) {
    console.error('[AI Etsy] suggest_tags produced no valid tags. dropped:', dropped.length);
    return fail(502, 'ai_tags_failed', 'AI geçerli etiket üretemedi.');
  }

  return { status: 200, data: { suggestions, dropped_count: dropped.length } };
}

function buildTitlePrompt(body: any, title: string, feedback?: string) {
  const tags = coerceAiStringArray(body.tags);
  return `You are a top Etsy SEO specialist. Your job is to craft a research-backed, high-converting Etsy listing title.
${ENGLISH_RULE}

ETSY SEARCH:
- Titles are the #1 ranking factor. The first 40 characters are shown in search results.
- Etsy indexes title + tags TOGETHER. Avoid words already used in the listing's tags.
- Titles must appeal to BUYERS (CTR, conversion), not just search engines.

KEYWORD STRATEGY:
- Keywords MUST come from the market research data below when provided, not generic guessing.
- Combine researched keywords into UNIQUE natural phrases.
  GOOD: "Personalized Baby Name Sign, Nursery Wall Decor, New Mom Gift"
  BAD: "Personalized Baby Name Sign Nursery Wall Decor Gift Custom Wood" (keyword stacking)
- Include relevant: product type, material, style/aesthetic, occasion, recipient.

${TITLE_RULES}
${feedback ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${feedback}\nFix these problems in the new title.\n` : ''}
Return JSON: { "optimized_title": "...", "explanation": "Brief explanation of keyword choices (in Turkish)" }

Current title: ${title}
Description: ${coerceAiString(body.description).slice(0, 1500) || 'N/A'}
Current tags (avoid these words in the title): ${tags.length ? tags.join(', ') : 'None'}
Category: ${coerceAiString(body.category) || 'N/A'}${buildMarketContextPrompt(body.market_context)}`;
}

function describeTitleIssues(check: TitleCheck): string {
  const parts: string[] = [];
  if (check.issues.includes('too_short')) parts.push(`it is ${check.length} characters, must be ${TITLE_MIN}-${TITLE_MAX}`);
  if (check.issues.includes('too_long')) parts.push(`it is ${check.length} characters, must be at most ${TITLE_MAX}`);
  if (check.issues.includes('repeated_words')) parts.push(`these words are repeated: ${check.repeatedWords.join(', ')}`);
  if (check.issues.includes('keyword_stacking')) parts.push('it stacks keywords without comma-separated readable phrases');
  return parts.join('; ');
}

/** Score a title candidate: lower = better. */
function titlePenalty(check: TitleCheck): number {
  let p = 0;
  if (check.issues.includes('too_long')) p += 3 + (check.length - TITLE_MAX) / 10;
  if (check.issues.includes('too_short')) p += 2 + (TITLE_MIN - check.length) / 20;
  if (check.issues.includes('repeated_words')) p += 2 * check.repeatedWords.length;
  if (check.issues.includes('keyword_stacking')) p += 3;
  return p;
}

/** If over TITLE_MAX, cut at the last comma boundary that fits (never mid-phrase). */
function fitTitleLength(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  const phrases = title.split(/\s*,\s*/);
  let out = '';
  for (const p of phrases) {
    const next = out ? `${out}, ${p}` : p;
    if (next.length > TITLE_MAX) break;
    out = next;
  }
  return out || title;
}

async function generateTitleCandidate(model: any, body: any, title: string, feedback?: string) {
  const result = await model.generateContent(buildTitlePrompt(body, title, feedback));
  const parsed = parseAiJson(result.response.text());
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed.optimized_title ?? parsed.title)
    : parsed;
  let candidate = normalizeTitle(raw);
  if (!candidate || looksGarbled(candidate)) {
    console.error('[AI Etsy] Title sanity check failed — garbled output:', String(raw).slice(0, 200));
    return null;
  }
  candidate = fitTitleLength(candidate);
  const explanation = parsed && typeof parsed === 'object' ? coerceAiString(parsed.explanation) : '';
  return { title: candidate, explanation, check: checkTitle(candidate) };
}

async function handleOptimizeTitle(body: any) {
  const title = coerceAiString(body.title);

  if (!title) {
    return fail(400, 'missing_title', 'title alanı zorunludur.');
  }

  const model = getGeminiModel();
  let best = await generateTitleCandidate(model, body, title);

  // Retry once with concrete feedback when the result breaks a hard rule.
  if (!best || titlePenalty(best.check) > 0) {
    const feedback = best ? describeTitleIssues(best.check) : 'the output was not a valid title string';
    const retry = await generateTitleCandidate(model, body, title, feedback);
    if (retry && (!best || titlePenalty(retry.check) < titlePenalty(best.check))) best = retry;
  }

  if (!best) {
    return fail(502, 'ai_title_failed', 'AI bozuk başlık üretti — lütfen tekrar deneyin.');
  }

  return {
    status: 200,
    data: {
      optimized_title: best.title,
      explanation: best.explanation,
      issues: best.check.issues,
    },
  };
}

async function handleGenerateDescription(body: any) {
  const { materials, category } = body;
  const title = coerceAiString(body.title);
  const existing_description = coerceAiString(body.existing_description);

  if (!title) {
    return fail(400, 'missing_title', 'title alanı zorunludur.');
  }

  const model = getGeminiModel();
  const improvePart = existing_description
    ? `\nAn existing description is provided – improve it while keeping the seller's voice and every concrete product detail (sizes, materials, care, shipping, personalization):\n${existing_description.slice(0, 5000)}`
    : '';

  const prompt = `You are a top Etsy copywriting and SEO specialist.
${ENGLISH_RULE}

CRITICAL: PRODUCT RELEVANCE
- Write ONLY about THIS SPECIFIC PRODUCT. Every sentence must describe, sell, or inform about it.
- Do NOT invent product features, materials, or dimensions not mentioned in the provided info.

STRUCTURE (follow this order):
1. Hook paragraph (first 160 chars): keyword-rich opening that says what the product IS and who it's for.
2. Product details: materials, look, size/dimensions if known.
3. Why buy this: unique selling points.
4. Perfect for: occasions and recipients relevant to this product.
5. Customization/ordering info: only if the title suggests personalization.

WRITING STYLE:
- Natural, warm, conversational US English. Short paragraphs (2-3 sentences). Use \\n\\n between paragraphs.
- Include keywords from the title and tags naturally.
- Total length: 1500-2500 characters.
- NO ALL CAPS, no excessive exclamation marks, no emoji unless clearly appropriate, no repeated selling points.

Return a JSON object: { "description": "..." }

Title: ${title}
Tags: ${listForPrompt(body.tags) || 'N/A'}
Materials: ${listForPrompt(materials) || 'N/A'}
Category: ${coerceAiString(category) || 'N/A'}${improvePart}${buildMarketContextPrompt(body.market_context)}`;

  const result = await model.generateContent(prompt);
  const parsed = parseAiJson(result.response.text());
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.description : parsed;
  // Arrays of paragraphs are joined with blank lines (not commas).
  const description = Array.isArray(raw) && raw.every((p: unknown) => typeof p === 'string')
    ? (raw as string[]).map((p) => p.trim()).filter(Boolean).join('\n\n')
    : coerceAiString(raw);

  if (!description || description.length < 80 || looksGarbled(description)) {
    console.error('[AI Etsy] generate_description invalid output:', String(description).slice(0, 200));
    return fail(502, 'ai_description_failed', 'AI açıklama oluşturamadı — tekrar deneyin.');
  }

  return { status: 200, data: { description: description.slice(0, 10000) } };
}

/** Block SSRF: reject non-https or internal/private hosts. */
function isUnsafeImageUrl(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
      host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('0.') ||
      host.endsWith('.local') || host.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    );
  } catch { return true; }
}

async function fetchImagePart(imageUrl: string): Promise<{ inlineData: { data: string; mimeType: string } } | null> {
  if (!imageUrl || isUnsafeImageUrl(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Cap at ~5MB to keep the vision request fast.
    if (buf.length > 5 * 1024 * 1024) return null;
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { inlineData: { data: buf.toString('base64'), mimeType } };
  } catch { return null; }
}

async function handleGenerateAltText(body: any) {
  const { title, description, image_url } = body;

  if (!title) {
    return fail(400, 'missing_title', 'title alanı zorunludur.');
  }

  const model = getGeminiModel();
  const imagePart = image_url ? await fetchImagePart(image_url) : null;

  const prompt = `You are a top Etsy SEO specialist with deep knowledge of Etsy's search algorithm as of March 2026.

${imagePart
  ? `You are shown the ACTUAL product photo above. Look at it carefully. Read (OCR) any text, labels, or numbers printed IN the image and incorporate meaningful ones. Describe exactly what is visible: the product, its colour, material, shape, style, and the setting/context of THIS specific photo (e.g. close-up detail, styled on a shelf, held in hand, size-comparison). Each photo of a listing is different — write alt text unique to THIS image, not a generic listing description.`
  : `No image was provided — write the best possible alt text from the title and description alone.`}

ETSY IMAGE ALT TEXT BEST PRACTICES (2026):
- Etsy uses alt text as a ranking signal in Etsy search AND Google Image search.
- 120-250 characters — use most of this space.
- Lead with the primary product keyword in the first few words, naturally.
- Describe what a buyer would SEE (colour, material, style, context/use-case).
- Write for accessibility (screen readers) and SEO simultaneously.
- NEVER output just a number, filename, position, or placeholder — always a full descriptive sentence.
- Do NOT keyword-stuff or comma-list unrelated keywords — Etsy penalises this.
- Do NOT start with "Image of" / "Photo of" — go straight to the product.
- Use natural, human, US English.

Return ONLY a JSON object: { "alt_text": "..." }

Product title: ${title}
Description: ${description || 'N/A'}`;

  const parts: any[] = imagePart ? [imagePart, { text: prompt }] : [{ text: prompt }];
  const result = await model.generateContent(parts);
  const parsed = parseAiJson(result.response.text());

  let altText = coerceAiString(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.alt_text : parsed);
  // Guard against degenerate output (e.g. a bare number) — fall back to the title.
  if (!altText || /^[\d\s.#-]+$/.test(altText)) {
    altText = String(title).slice(0, 250);
  }

  return { status: 200, data: { alt_text: altText.slice(0, 250) } };
}

async function handleMarketAnalysis(body: any) {
  const { query, totalResults, priceStats, topTags, topKeywords, shopCount,
          avgFavorites, avgViews, topShops } = body;

  if (!query) {
    return fail(400, 'missing_query', 'query alanı zorunludur.');
  }

  const model = getGeminiModel();
  const prompt = `Sen Etsy pazar araştırma ve strateji uzmanısın. Mart 2026 itibarıyla Etsy'nin arama algoritması, trendleri ve satıcı stratejileri hakkında derin bilgiye sahipsin.

ÖNEMLİ DİL KURALI: Etsy alıcıları İngilizce arama yaptığı için tüm Etsy anahtar kelimeleri, tagleri, arama terimleri, niş terimleri ve başlık önerileri MUTLAKA İNGİLİZCE olmalıdır. Sadece analiz metni, açıklamalar ve yorumlar Türkçe olmalıdır. tag_recommendations dizisi tamamen İngilizce Etsy tagleri içermelidir. niche_positioning ve title_recommendations içindeki anahtar kelimeler/örnekler İngilizce olmalıdır.

Bir satıcı "${query}" anahtar kelimesi ile pazar araştırması yaptı. İşte toplanan veriler:

PAZAR VERİLERİ:
- Toplam sonuç: ${totalResults || 'N/A'}
- Benzersiz mağaza sayısı: ${shopCount || 'N/A'}
- Fiyat istatistikleri: Min: $${priceStats?.min || 'N/A'}, Medyan: $${priceStats?.median || 'N/A'}, P25-P75: $${priceStats?.p25 ?? 'N/A'}-$${priceStats?.p75 ?? 'N/A'}, Max: $${priceStats?.max || 'N/A'}
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
  const parsed = parseAiJson(result.response.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('[AI Etsy] market_analysis invalid JSON');
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const score = Number(parsed.opportunity_score);
  const analysis = {
    opportunity_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    opportunity_level: coerceAiString(parsed.opportunity_level),
    market_summary: coerceAiString(parsed.market_summary),
    pricing_strategy: coerceAiString(parsed.pricing_strategy),
    tag_recommendations: normalizeTags(parsed.tag_recommendations, { max: 10 }).tags,
    title_recommendations: coerceAiString(parsed.title_recommendations),
    niche_positioning: coerceAiString(parsed.niche_positioning),
    seasonal_advice: coerceAiString(parsed.seasonal_advice),
    competition_analysis: coerceAiString(parsed.competition_analysis),
    action_items: coerceAiStringArray(parsed.action_items).slice(0, 7),
  };
  if (!analysis.market_summary) {
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { analysis } };
}

type BulkField = 'title' | 'tags' | 'description';

async function handleBulkOptimize(body: any) {
  const { listings } = body;

  if (!Array.isArray(listings) || listings.length === 0) {
    return fail(400, 'no_listings', 'listings alanı boş olamaz.');
  }

  if (listings.length > 20) {
    return fail(400, 'too_many_listings', 'Tek seferde en fazla 20 liste gönderilebilir.');
  }

  // Which fields to optimize. `field` (single, BulkEditor) or `fields` (array).
  // Default is title + tags — a description is only generated when asked for.
  const ALL: BulkField[] = ['title', 'tags', 'description'];
  const requested = new Set<BulkField>(
    (Array.isArray(body.fields) ? body.fields : typeof body.field === 'string' ? [body.field] : ['title', 'tags'])
      .filter((f: unknown): f is BulkField => typeof f === 'string' && (ALL as string[]).includes(f)),
  );
  if (requested.size === 0) requested.add('title');
  const wants = (f: BulkField) => requested.has(f);
  const instructions = sanitizeInstructions(body.instructions);

  // Only trust listing IDs the client sent.
  const inputById = new Map<string, any>();
  for (const l of listings) {
    if (l && (typeof l.listing_id === 'number' || typeof l.listing_id === 'string')) inputById.set(String(l.listing_id), l);
  }
  if (inputById.size === 0) return fail(400, 'no_listings', 'listings alanı boş olamaz.');

  const model = getGeminiModel();
  const listingSummaries = Array.from(inputById.values()).map((l: any, i: number) => {
    return `Listing ${i + 1} (ID: ${l.listing_id}):
  Title: ${coerceAiString(l.title) || 'N/A'}
  Description: ${coerceAiString(l.description).slice(0, wants('description') ? 1500 : 400) || 'N/A'}
  Tags: ${listForPrompt(l.tags) || 'N/A'}
  Category: ${coerceAiString(l.category) || 'N/A'}`;
  }).join('\n\n');

  const outputShape = ['"listing_id": <same id>', ...Array.from(requested).map((f) => f === 'tags' ? '"tags": ["..."]' : `"${f}": "..."`)].join(', ');
  const tagsAgainst = wants('title') ? 'the NEW title you write' : 'the listing\'s CURRENT title (which is not being changed)';

  const prompt = `You are a top Etsy SEO specialist. Optimize ONLY these fields for each listing: ${Array.from(requested).join(', ')}. Do not output other fields.
${ENGLISH_RULE}

${wants('title') ? TITLE_RULES : ''}
${wants('tags') ? `${TAG_RULES}\n- Tag words must not overlap with ${tagsAgainst}. Keep strong existing tags that already follow these rules.` : ''}
${wants('description') ? `DESCRIPTION RULES:
- First 160 chars = meta preview. Compelling and keyword-rich.
- Improve the existing description, keep the seller's voice and every concrete product detail. Never invent facts.
- Natural buyer-friendly language, short paragraphs separated by \\n\\n, 1500-2500 characters.` : ''}
${instructions ? `\nSELLER INSTRUCTIONS (follow them unless they conflict with the rules above): ${instructions}\n` : ''}
Return JSON: { "optimizations": [ { ${outputShape} }, ... ] }

${listingSummaries}`;

  const result = await model.generateContent(prompt);
  const parsed = parseAiJson(result.response.text());
  const rawItems = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed.optimizations ?? parsed.optimized ?? parsed.listings)
      : null;
  if (!Array.isArray(rawItems)) {
    console.error('[AI Etsy] bulk_optimize invalid response shape');
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const optimized: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.listing_id ?? '');
    const input = inputById.get(id);
    if (!input || seen.has(id)) continue;
    seen.add(id);

    const out: Record<string, any> = { listing_id: input.listing_id };
    const issues: string[] = [];
    let finalTitle = coerceAiString(input.title);

    if (wants('title')) {
      const t = fitTitleLength(normalizeTitle(item.title));
      if (t && !looksGarbled(t)) {
        out.title = t;
        finalTitle = t;
        issues.push(...checkTitle(t).issues);
      }
    }
    if (wants('tags')) {
      const { tags } = normalizeTags(item.tags, { title: finalTitle, dropTitleOverlap: true });
      if (tags.length > 0) out.tags = tags;
    }
    if (wants('description')) {
      const raw = item.description;
      const d = Array.isArray(raw) && raw.every((p: unknown) => typeof p === 'string')
        ? (raw as string[]).join('\n\n').trim()
        : coerceAiString(raw);
      if (d && d.length >= 80 && !looksGarbled(d)) out.description = d.slice(0, 10000);
    }
    if (issues.length) out.issues = Array.from(new Set(issues));
    if (Object.keys(out).some((k) => k === 'title' || k === 'tags' || k === 'description')) optimized.push(out);
  }

  if (optimized.length === 0) {
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { optimized, fields: Array.from(requested) } };
}

async function handleNicheReport(body: any) {
  const { query, demandScore, priceStats, competition, velocity, engagement, topTags, topKeywords } = body;

  if (!query) {
    return fail(400, 'missing_query', 'query alanı zorunludur.');
  }

  const model = getGeminiModel();
  const prompt = `Sen derin niş analizi yapan bir Etsy pazar uzmanısın. Aşağıdaki verilere dayanarak detaylı ve eyleme dönüştürülebilir niş raporu hazırla.

ÖNEMLİ DİL KURALI: Tüm anahtar kelimeler, tagler ve keyword örnekleri MUTLAKA İNGİLİZCE olmalıdır. Sadece analiz metni, açıklamalar ve yorumlar Türkçe olmalıdır.

NİŞ: "${query}"

VERİLER:
- Talep skoru: ${demandScore ?? 'N/A'}
- Fiyat istatistikleri: Min: $${priceStats?.min ?? 'N/A'}, Medyan: $${priceStats?.median ?? 'N/A'}, P25-P75: $${priceStats?.p25 ?? 'N/A'}-$${priceStats?.p75 ?? 'N/A'}, Max: $${priceStats?.max ?? 'N/A'}
- Rekabet seviyesi: ${competition ?? 'N/A'}
- Satış hızı (velocity): ${velocity ?? 'N/A'}
- Etkileşim (engagement): ${engagement ?? 'N/A'}
- En çok kullanılan etiketler: ${Array.isArray(topTags) ? topTags.slice(0, 20).map((t: any) => typeof t === 'string' ? t : `${t.tag} (${t.pct}%)`).join(', ') : 'N/A'}
- En çok kullanılan anahtar kelimeler: ${Array.isArray(topKeywords) ? topKeywords.slice(0, 15).map((k: any) => typeof k === 'string' ? k : `${k.keyword} (${k.pct}%)`).join(', ') : 'N/A'}

JSON formatında döndür:
{
  "verdict": "GİR" | "DİKKATLİ OL" | "KAÇIN",
  "confidence": 0-100,
  "summary": "2-3 cümlelik Türkçe özet",
  "strengths": ["güçlü yön 1 (Türkçe)", ...],
  "weaknesses": ["zayıf yön 1 (Türkçe)", ...],
  "opportunities": ["fırsat 1 (Türkçe)", ...],
  "entry_strategy": "Detaylı Türkçe giriş stratejisi, İngilizce keyword örnekleri ile",
  "pricing_recommendation": { "min": number, "sweet_spot": number, "max": number, "reasoning": "Türkçe açıklama" },
  "keyword_strategy": { "primary": ["english keyword"], "secondary": ["english keyword"], "long_tail": ["english long tail phrase"] },
  "action_items": ["Türkçe aksiyon maddesi, İngilizce keyword örnekleriyle", ...]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[AI Etsy] niche_report JSON parse failed:', text.slice(0, 500));
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const requiredKeys = ['verdict', 'confidence', 'summary', 'strengths', 'weaknesses', 'opportunities', 'entry_strategy', 'pricing_recommendation', 'keyword_strategy', 'action_items'];
  const missingKeys = requiredKeys.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    console.error('[AI Etsy] niche_report missing keys:', missingKeys);
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { report: parsed } };
}

async function handleShopSpyReport(body: any) {
  const { shopName, shopData, topListings, topTags } = body;

  if (!shopName) {
    return { status: 400, data: { error: 'shopName alanı zorunludur.' } };
  }

  const model = getGeminiModel();
  const listingsText = Array.isArray(topListings)
    ? topListings.slice(0, 10).map((l: any, i: number) => `  ${i + 1}. "${l.title}" — $${l.price}, ${l.favorites} favori`).join('\n')
    : 'N/A';

  const prompt = `Sen rakip mağaza analizi yapan bir Etsy strateji uzmanısın. Aşağıdaki mağaza verilerini analiz et.

ÖNEMLİ DİL KURALA: Tüm tag örnekleri ve keyword önerileri MUTLAKA İNGİLİZCE olmalıdır. Analiz metni Türkçe olmalıdır.

MAĞAZA: "${shopName}"

MAĞAZA VERİLERİ:
- Toplam satış: ${shopData?.sales ?? 'N/A'}
- Değerlendirme: ${shopData?.rating ?? 'N/A'}★
- Aktif ilan sayısı: ${shopData?.listings ?? 'N/A'}
- Katılım tarihi: ${shopData?.joinDate ?? 'N/A'}

EN İYİ İLANLAR:
${listingsText}

EN ÇOK KULLANILAN ETIKETLER: ${Array.isArray(topTags) ? topTags.slice(0, 20).map((t: any) => typeof t === 'string' ? t : `${t.tag} (${t.pct}%)`).join(', ') : 'N/A'}

JSON formatında döndür:
{
  "shop_score": 0-100 arası tam sayı puan (90-100: olağanüstü, 70-89: iyi, 50-69: geliştirilmeli, 50 altı: zayıf),
  "estimated_monthly_revenue": tahmini aylık gelir (sayı),
  "revenue_reasoning": "Türkçe gelir tahmini açıklaması",
  "strategy_summary": "Türkçe strateji özeti",
  "strengths": ["güçlü yön (Türkçe)", ...],
  "weaknesses": ["zayıf yön (Türkçe)", ...],
  "pricing_insights": "Türkçe fiyatlandırma analizi, $ tutarları ile",
  "tag_strategy": "Türkçe tag analizi, İngilizce tag örnekleri ile",
  "what_to_learn": ["öğrenilecek (Türkçe)", ...],
  "what_to_avoid": ["kaçınılacak (Türkçe)", ...]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[AI Etsy] shop_spy_report JSON parse failed:', text.slice(0, 500));
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const requiredKeys = ['shop_score', 'estimated_monthly_revenue', 'strategy_summary', 'strengths', 'weaknesses', 'pricing_insights', 'tag_strategy', 'what_to_learn', 'what_to_avoid'];
  const missingKeys = requiredKeys.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    console.error('[AI Etsy] shop_spy_report missing keys:', missingKeys);
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { report: parsed } };
}

async function handleListingAudit(body: any) {
  const { title, description, tags, price, favorites, views, imageCount, seoScore, marketAvgPrice, marketAvgFavorites } = body;

  if (!title) {
    return fail(400, 'missing_title', 'title alanı zorunludur.');
  }

  const model = getGeminiModel();
  const prompt = `Sen Etsy ilan denetimi yapan bir SEO ve satış uzmanısın. Aşağıdaki ilanı kapsamlı şekilde denetle.

ÖNEMLİ DİL KURALI: Optimize edilmiş başlık ve tag önerileri MUTLAKA İNGİLİZCE olmalıdır. Geri bildirim metinleri Türkçe olmalıdır.

İLAN VERİLERİ:
- Başlık: ${title}
- Açıklama: ${(description || 'N/A').slice(0, 500)}
- Taglar: ${Array.isArray(tags) ? tags.join(', ') : tags || 'Yok'}
- Fiyat: $${price ?? 'N/A'}
- Favoriler: ${favorites ?? 'N/A'}
- Görüntülenme: ${views ?? 'N/A'}
- Görsel sayısı: ${imageCount ?? 'N/A'}
- SEO skoru: ${seoScore ?? 'N/A'}

PAZAR KARŞILAŞTIRMA:
- Pazar ortalama fiyat: $${marketAvgPrice ?? 'N/A'}
- Pazar ortalama favori: ${marketAvgFavorites ?? 'N/A'}

JSON formatında döndür:
{
  "overall_score": 0-100 arası tam sayı puan (90-100: olağanüstü, 70-89: iyi, 50-69: geliştirilmeli, 50 altı: zayıf),
  "title_score": 0-100,
  "title_feedback": "Türkçe başlık geri bildirimi",
  "tags_score": 0-100,
  "tags_feedback": "Türkçe tag geri bildirimi, İngilizce tag önerileri ile",
  "description_score": 0-100,
  "description_feedback": "Türkçe açıklama geri bildirimi",
  "pricing_score": 0-100,
  "pricing_feedback": "Türkçe fiyatlandırma geri bildirimi",
  "image_score": 0-100,
  "image_feedback": "Türkçe görsel geri bildirimi",
  "quick_wins": ["Türkçe hızlı kazanım 1", ...],
  "optimized_title": "English optimized title suggestion",
  "suggested_tags": ["english tag 1", "english tag 2", ...]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[AI Etsy] listing_audit JSON parse failed:', text.slice(0, 500));
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const requiredKeys = ['overall_score', 'title_score', 'title_feedback', 'tags_score', 'tags_feedback', 'description_score', 'pricing_score', 'quick_wins', 'optimized_title', 'suggested_tags'];
  const missingKeys = requiredKeys.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    console.error('[AI Etsy] listing_audit missing keys:', missingKeys);
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  // Enforce listing rules on the AI's suggestions before the UI shows them.
  const auditTitle = fitTitleLength(normalizeTitle(parsed.optimized_title));
  parsed.optimized_title = auditTitle && !looksGarbled(auditTitle) ? auditTitle : '';
  parsed.suggested_tags = normalizeTags(parsed.suggested_tags, {
    title: parsed.optimized_title || coerceAiString(title), dropTitleOverlap: true,
  }).tags;
  parsed.quick_wins = coerceAiStringArray(parsed.quick_wins);

  return { status: 200, data: { audit: parsed } };
}

async function handleReviewSentiment(body: any) {
  const { shopName, reviews } = body;

  if (!shopName || !Array.isArray(reviews) || reviews.length === 0) {
    return { status: 400, data: { error: 'shopName ve reviews alanları zorunludur.' } };
  }

  const model = getGeminiModel();
  const reviewsText = reviews.slice(0, 50).map((r: any, i: number) =>
    `  ${i + 1}. [${r.rating}★] "${(r.review || '').slice(0, 200)}" (${r.created_timestamp || 'N/A'})`
  ).join('\n');

  const prompt = `Sen müşteri yorumlarını analiz eden bir Etsy pazar araştırma uzmanısın. Aşağıdaki rakip mağaza yorumlarından duygu analizi yap.

ÖNEMLİ DİL KURALI: Analiz metni Türkçe olmalıdır. Alıntılar orijinal dilde kalmalıdır.

MAĞAZA: "${shopName}"

YORUMLAR:
${reviewsText}

JSON formatında döndür:
{
  "overall_sentiment": "Çok Olumlu" | "Olumlu" | "Karışık" | "Olumsuz",
  "sentiment_score": 0-100,
  "themes": [{ "theme": "Türkçe tema adı", "count": sayı, "sentiment": "positive" | "negative" | "neutral", "example": "orijinal alıntı" }, ...],
  "buyer_loves": ["alıcıların sevdiği şeyler (Türkçe)"],
  "buyer_complaints": ["alıcı şikayetleri (Türkçe)"],
  "product_insights": ["ürün geliştirme için Türkçe öneriler"],
  "service_insights": ["hizmet geliştirme için Türkçe öneriler"]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[AI Etsy] review_sentiment JSON parse failed:', text.slice(0, 500));
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const requiredKeys = ['overall_sentiment', 'sentiment_score', 'themes', 'buyer_loves', 'buyer_complaints', 'product_insights', 'service_insights'];
  const missingKeys = requiredKeys.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    console.error('[AI Etsy] review_sentiment missing keys:', missingKeys);
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { sentiment: parsed } };
}

async function handlePriceRecommendation(body: any) {
  const { query, myPrice, priceStats, sweetSpot, priceRangeBreakdown, avgFavorites, productDescription } = body;

  if (!query) {
    return fail(400, 'missing_query', 'query alanı zorunludur.');
  }

  const model = getGeminiModel();
  const breakdownText = Array.isArray(priceRangeBreakdown)
    ? priceRangeBreakdown.map((r: any) => `  $${r.min}-$${r.max}: ${r.count} ilan (${r.pct}%)`).join('\n')
    : 'N/A';

  const prompt = `Sen Etsy fiyatlandırma stratejisi uzmanısın. Aşağıdaki pazar verilerine dayanarak optimal fiyat önerisi yap.

ÖNEMLİ DİL KURALI: Analiz metni ve açıklamalar Türkçe olmalıdır.

ÜRÜN: "${query}"
${productDescription ? `Ürün açıklaması: ${productDescription.slice(0, 300)}` : ''}

FİYAT VERİLERİ:
- Mevcut fiyatım: ${myPrice ? `$${myPrice}` : 'Belirtilmedi'}
- Pazar min: $${priceStats?.min ?? 'N/A'}
- Pazar medyan: $${priceStats?.median ?? 'N/A'}
- Pazar max: $${priceStats?.max ?? 'N/A'}
- Sweet spot: $${sweetSpot ?? 'N/A'}
- Ortalama favori: ${avgFavorites ?? 'N/A'}

FİYAT ARALIĞI DAĞILIMI:
${breakdownText}

JSON formatında döndür:
{
  "recommended_price": önerilen fiyat (sayı),
  "price_range": { "min": sayı, "max": sayı },
  "confidence": 0-100,
  "strategy": "Penetrasyon" | "Premium" | "Rekabetçi" | "Değer",
  "reasoning": "Türkçe detaylı açıklama",
  "price_positioning": "Türkçe — fiyatınızın pazardaki yeri",
  "tips": ["Türkçe fiyatlandırma ipucu 1", ...]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('[AI Etsy] price_recommendation JSON parse failed:', text.slice(0, 500));
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  const requiredKeys = ['recommended_price', 'price_range', 'confidence', 'strategy', 'reasoning', 'price_positioning', 'tips'];
  const missingKeys = requiredKeys.filter((k) => !(k in parsed));
  if (missingKeys.length > 0) {
    console.error('[AI Etsy] price_recommendation missing keys:', missingKeys);
    return fail(502, 'invalid_ai_response', 'AI yanıtı işlenemedi');
  }

  return { status: 200, data: { recommendation: parsed } };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST metodu desteklenmektedir.', code: 'method_not_allowed' });
  }

  // --- Auth ---
  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.', code: 'unauthorized' });
  const userId: string = authUser.id;

  // --- Rate limit ---
  if (!checkRateLimit(userId)) {
    return res.status(429).json({
      error: 'Çok fazla istek gönderdiniz. Lütfen bir dakika bekleyip tekrar deneyin.',
      code: 'rate_limited',
    });
  }

  // --- Route by action ---
  const { action, ...body } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'action alanı zorunludur.', code: 'invalid_action' });
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
      case 'niche_report':
        result = await handleNicheReport(body);
        break;
      case 'shop_spy_report':
        result = await handleShopSpyReport(body);
        break;
      case 'listing_audit':
        result = await handleListingAudit(body);
        break;
      case 'review_sentiment':
        result = await handleReviewSentiment(body);
        break;
      case 'price_recommendation':
        result = await handlePriceRecommendation(body);
        break;
      default:
        return res.status(400).json({
          error: 'Geçersiz action.',
          code: 'invalid_action',
        });
    }

    return res.status(result.status).json(result.data);
  } catch (err: any) {
    console.error('[AI Etsy] Gemini hatası:', err);

    if (err?.message?.includes('GEMINI_API_KEY')) {
      return res.status(500).json({ error: 'AI servisi yapılandırılmamış.', code: 'ai_not_configured' });
    }
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI yanıtı işlenemedi', code: 'invalid_ai_response' });
    }

    return res.status(500).json({
      error: 'AI isteği işlenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
      code: 'ai_failed',
    });
  }
}
