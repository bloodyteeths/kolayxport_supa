import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = { maxDuration: 60 };

// ---------------------------------------------------------------------------
// Rate limiter – in-memory, 30 req/min per user
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' } as any,
  });
}

// ---------------------------------------------------------------------------
// Shared prompt helpers
// ---------------------------------------------------------------------------
function buildMarketContext(mc: any): string {
  if (!mc) return '';
  const prices = mc.stats
    ? `$${mc.stats.minPrice} - $${mc.stats.maxPrice} (avg: $${mc.stats.avgPrice}, median: $${mc.stats.medianPrice})`
    : 'N/A';
  const keywords = Array.isArray(mc.topKeywords)
    ? mc.topKeywords.slice(0, 15).map((k: any) => `${k.keyword} (${k.pct}%)`).join(', ')
    : 'N/A';
  const opp = mc.opportunity
    ? `Demand: ${mc.opportunity.demand?.score}/100, Competition: ${mc.opportunity.competition?.score}/100, Opportunity: ${mc.opportunity.score}/100`
    : 'N/A';

  return `

MARKET RESEARCH DATA (real Amazon competitor analysis for "${mc.query || 'N/A'}"):
- Market price range: ${prices}
- Top title keywords: ${keywords}
- Total results: ${mc.totalResults || 'N/A'}
- Scores: ${opp}
- Average BSR: ${mc.stats?.avgBsr || 'N/A'}
- Average reviews: ${mc.stats?.avgReviews || 'N/A'}

USE THIS DATA to inform your analysis. Your recommendations MUST be grounded in these real market insights.`;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleMarketAnalysis(body: any) {
  const { query, marketData } = body;
  if (!query) return { status: 400, data: { error: 'query is required' } };

  const model = getGeminiModel();
  const prompt = `You are an expert Amazon product research analyst. Analyze this market niche and provide actionable insights.
${buildMarketContext(marketData)}

Analyze the market for "${query}" and return JSON:
{
  "summary": "2-3 sentence market overview",
  "marketSize": "small | medium | large",
  "trend": "growing | stable | declining",
  "profitPotential": "low | medium | high",
  "pricingStrategy": {
    "recommended": number,
    "reasoning": "why this price"
  },
  "topOpportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "risks": ["risk 1", "risk 2"],
  "differentiationIdeas": ["idea 1", "idea 2", "idea 3"],
  "keywordsToTarget": ["keyword 1", "keyword 2", ...up to 10],
  "seasonality": "description of seasonal patterns if any",
  "competitiveAdvice": "specific advice on how to compete in this niche"
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleNicheReport(body: any) {
  const { query, marketData } = body;
  if (!query) return { status: 400, data: { error: 'query is required' } };

  const model = getGeminiModel();
  const prompt = `You are a senior Amazon market researcher. Generate a comprehensive niche viability report.
${buildMarketContext(marketData)}

Generate a detailed niche report for "${query}". Return JSON:
{
  "nicheScore": number (0-100),
  "verdict": "Highly Recommended | Recommended | Proceed with Caution | Not Recommended",
  "executiveSummary": "3-4 sentence overview",
  "demandAnalysis": {
    "score": number (0-100),
    "summary": "1-2 sentences",
    "signals": ["signal 1", "signal 2"]
  },
  "competitionAnalysis": {
    "score": number (0-100),
    "summary": "1-2 sentences",
    "barriers": ["barrier 1", "barrier 2"]
  },
  "profitAnalysis": {
    "estimatedMargin": "percentage range",
    "breakEvenUnits": number,
    "summary": "1-2 sentences"
  },
  "entryStrategy": {
    "approach": "description",
    "steps": ["step 1", "step 2", "step 3"],
    "investmentRange": "$X - $Y",
    "timeToProfit": "X months"
  },
  "keyRisks": [
    { "risk": "description", "severity": "high | medium | low", "mitigation": "how to handle" }
  ]
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleProductOpportunity(body: any) {
  const { asin, title, price, salesRank, reviewCount, rating, categoryName, features, marketData } = body;
  if (!asin && !title) return { status: 400, data: { error: 'asin or title is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon product opportunity analyst. Evaluate this specific product opportunity.
${buildMarketContext(marketData)}

Product Details:
- ASIN: ${asin || 'N/A'}
- Title: ${title || 'N/A'}
- Price: $${price || 'N/A'}
- BSR: ${salesRank || 'N/A'}
- Reviews: ${reviewCount || 'N/A'} (${rating || 'N/A'} stars)
- Category: ${categoryName || 'N/A'}
- Features: ${Array.isArray(features) ? features.join(' | ') : 'N/A'}

Return JSON:
{
  "opportunityScore": number (0-100),
  "verdict": "Strong Buy | Buy | Hold | Avoid",
  "summary": "2-3 sentence assessment",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "estimatedMonthlySales": number,
  "estimatedMonthlyRevenue": number,
  "competitiveLandscape": "easy | moderate | hard",
  "improvementSuggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "pricingAdvice": "recommendation on pricing"
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleKeywordClusters(body: any) {
  const { keywords, query } = body;
  if (!keywords?.length) return { status: 400, data: { error: 'keywords array is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon keyword research specialist. Group these keywords by search intent.

Query: "${query || 'N/A'}"
Keywords: ${keywords.slice(0, 100).join(', ')}

Group these keywords into meaningful clusters based on buyer search intent.
Return JSON:
{
  "clusters": [
    {
      "name": "cluster name",
      "intent": "informational | commercial | transactional",
      "keywords": ["kw1", "kw2", ...],
      "priority": "high | medium | low",
      "strategy": "how to target this cluster"
    }
  ],
  "primaryKeyword": "the single best keyword to target",
  "longTailGems": ["low-competition long-tail keywords worth targeting"],
  "avoidKeywords": ["keywords that look good but won't convert"]
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleListingAudit(body: any) {
  const { title, bulletPoints, description, price, imageCount, categoryName, marketData } = body;
  if (!title) return { status: 400, data: { error: 'title is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon listing optimization expert. Audit this listing and score it.
${buildMarketContext(marketData)}

Listing Details:
- Title: ${title}
- Bullet Points: ${Array.isArray(bulletPoints) ? bulletPoints.join(' | ') : bulletPoints || 'N/A'}
- Description: ${description || 'N/A'}
- Price: $${price || 'N/A'}
- Image Count: ${imageCount || 'N/A'}
- Category: ${categoryName || 'N/A'}

Amazon Listing Best Practices (2026):
- Titles: Max 200 chars, brand first, key features, no keyword stuffing
- Bullet points: 5 bullets, 200 chars each, benefit-driven, keywords natural
- Images: 7+ images, infographics, lifestyle, size comparison, A+ content
- Price: Competitive with Buy Box consideration

Return JSON:
{
  "overallScore": number (0-100),
  "issues": [
    { "field": "title | bullets | description | price | images | general", "severity": "critical | warning | info", "issue": "description", "fix": "how to fix" }
  ],
  "titleScore": number (0-100),
  "bulletScore": number (0-100),
  "seoScore": number (0-100),
  "competitiveScore": number (0-100),
  "recommendations": ["top priority recommendation 1", "recommendation 2", "recommendation 3"]
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleOptimizeTitle(body: any) {
  const { title, categoryName, keywords, marketData } = body;
  if (!title) return { status: 400, data: { error: 'title is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon listing title optimization expert.
${buildMarketContext(marketData)}

AMAZON TITLE RULES (2026):
- Max 200 characters (but first 80 chars show in mobile search results — front-load key info)
- Format: Brand + Main Keyword + Key Feature + Size/Color + Use Case
- No ALL CAPS, no special chars for decoration, no promotional phrases
- Include 2-3 high-value keywords naturally
- Must be readable and appealing to buyers (not keyword-stuffed)

Current title: "${title}"
Category: ${categoryName || 'General'}
Target keywords: ${Array.isArray(keywords) ? keywords.join(', ') : keywords || 'N/A'}

Return JSON:
{
  "optimizedTitle": "the new title (max 200 chars)",
  "beforeScore": number (0-100),
  "afterScore": number (0-100),
  "changes": ["what changed and why"],
  "keywordsIncluded": ["keywords in the new title"],
  "keywordsMissing": ["keywords that couldn't fit"]
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleOptimizeBullets(body: any) {
  const { title, bulletPoints, features, categoryName, marketData } = body;
  if (!title) return { status: 400, data: { error: 'title is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon bullet point copywriter.
${buildMarketContext(marketData)}

AMAZON BULLET POINT RULES:
- Exactly 5 bullet points
- Each bullet: 150-200 chars, starts with a CAPITALIZED benefit keyword
- Lead with the benefit, then feature
- Include 1-2 keywords per bullet naturally
- Address common buyer concerns (size, material, durability, compatibility)
- Last bullet: satisfaction guarantee or social proof

Product: ${title}
Category: ${categoryName || 'General'}
Current bullets: ${Array.isArray(bulletPoints) ? bulletPoints.join(' | ') : 'None'}
Key features: ${Array.isArray(features) ? features.join(' | ') : features || 'N/A'}

Return JSON:
{
  "bullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"],
  "keywordsUsed": ["keywords included across all bullets"],
  "improvements": ["what's better about the new bullets"]
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handlePriceStrategy(body: any) {
  const { title, price, categoryName, cogs, marketData } = body;
  if (!title) return { status: 400, data: { error: 'title is required' } };

  const model = getGeminiModel();
  const prompt = `You are an Amazon pricing strategist.
${buildMarketContext(marketData)}

Product: ${title}
Current Price: $${price || 'N/A'}
Category: ${categoryName || 'General'}
COGS: $${cogs || 'N/A'}

Analyze the market data and recommend a pricing strategy.
Return JSON:
{
  "recommendedPrice": number,
  "priceRange": { "min": number, "max": number },
  "strategy": "penetration | competitive | premium | value",
  "reasoning": "why this price works",
  "buyBoxAdvice": "how to win/maintain the Buy Box",
  "promotionIdeas": ["promo idea 1", "promo idea 2"],
  "marginEstimate": "estimated margin at recommended price"
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

async function handleCompetitorAnalysis(body: any) {
  const { items, query } = body;
  if (!items?.length) return { status: 400, data: { error: 'items array is required' } };

  const model = getGeminiModel();
  const itemSummary = items.slice(0, 10).map((i: any, idx: number) =>
    `${idx + 1}. "${i.title}" - $${i.price} | BSR: ${i.salesRank} | ${i.reviewCount} reviews (${i.rating}★) | ${i.seller || 'Unknown'}`
  ).join('\n');

  const prompt = `You are an Amazon competitive intelligence analyst. Analyze these top competitors.

Search: "${query}"
Top Products:
${itemSummary}

Return JSON:
{
  "summary": "2-3 sentence competitive landscape overview",
  "dominantStrategy": "what winning products have in common",
  "priceSweetSpot": { "min": number, "max": number, "optimal": number },
  "reviewBarrier": "minimum reviews needed to compete",
  "gaps": ["market gap 1 that no competitor is filling", "gap 2"],
  "weakCompetitors": ["which competitors have weak listings (low reviews, bad titles)"],
  "differentiationOpportunities": ["how to stand out"],
  "entryDifficulty": "easy | moderate | hard",
  "recommendedApproach": "specific advice for entering this market"
}`;

  const result = await model.generateContent(prompt);
  return { status: 200, data: JSON.parse(result.response.text()) };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!checkRateLimit(user.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded (30 req/min)' });
  }

  const action = typeof req.query.action === 'string' ? req.query.action : '';
  const body = req.body || {};

  try {
    let result: { status: number; data: any };

    switch (action) {
      case 'market_analysis':
        result = await handleMarketAnalysis(body);
        break;
      case 'niche_report':
        result = await handleNicheReport(body);
        break;
      case 'product_opportunity':
        result = await handleProductOpportunity(body);
        break;
      case 'keyword_clusters':
        result = await handleKeywordClusters(body);
        break;
      case 'listing_audit':
        result = await handleListingAudit(body);
        break;
      case 'optimize_title':
        result = await handleOptimizeTitle(body);
        break;
      case 'optimize_bullets':
        result = await handleOptimizeBullets(body);
        break;
      case 'price_strategy':
        result = await handlePriceStrategy(body);
        break;
      case 'competitor_analysis':
        result = await handleCompetitorAnalysis(body);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    // Validate AI response is valid JSON object
    if (result.data && typeof result.data === 'object') {
      return res.status(result.status).json(result.data);
    }

    return res.status(500).json({ error: 'AI returned invalid response' });
  } catch (err: any) {
    // Handle Gemini garbled/array output
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned malformed JSON. Please try again.' });
    }
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
