import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../lib/logger';
import { getSupabaseServerClient } from '../../../lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 30 };

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not configured');
  }
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// Claude helper – returns parsed JSON from Claude
// ---------------------------------------------------------------------------

async function askClaude<T>(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1024
): Promise<T> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract text from the response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response – strip markdown code fences if present
  let raw = textBlock.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.error('Failed to parse Claude JSON response', new Error('JSON parse error'), {
      raw: raw.substring(0, 500),
    });
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

interface OptimizeTitleInput {
  title: string;
  categoryName?: string;
  keywords?: string[];
}

interface OptimizeTitleOutput {
  optimizedTitle: string;
  suggestions: string[];
  score: { before: number; after: number };
}

async function handleOptimizeTitle(body: OptimizeTitleInput): Promise<OptimizeTitleOutput> {
  const { title, categoryName, keywords } = body;

  if (!title || typeof title !== 'string') {
    throw new InputError('title is required and must be a string');
  }

  const systemPrompt = `You are an expert eBay listing optimization specialist. Your job is to analyze eBay listing titles and optimize them for maximum search visibility and sales.

Rules for eBay title optimization:
- Maximum 80 characters
- Include high-value keywords buyers actually search for
- Put the most important keywords first
- Avoid filler words like "WOW", "L@@K", "AMAZING"
- Include brand, model, size, color, condition when relevant
- Use spaces, not special characters, to separate keywords
- Do NOT use all caps for entire title

You MUST respond with ONLY valid JSON in this exact format:
{
  "optimizedTitle": "the optimized title (max 80 chars)",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "score": { "before": 0, "after": 0 }
}

Score is 0-100 based on: keyword relevance (30%), keyword placement (20%), length usage (20%), readability (15%), completeness (15%).`;

  const userMsg = [
    `Current title: "${title}"`,
    categoryName ? `Category: ${categoryName}` : '',
    keywords?.length ? `Additional keywords to consider: ${keywords.join(', ')}` : '',
    'Optimize this eBay listing title.',
  ]
    .filter(Boolean)
    .join('\n');

  return askClaude<OptimizeTitleOutput>(systemPrompt, userMsg);
}

// ---------------------------------------------------------------------------

interface GenerateDescriptionInput {
  title: string;
  aspects?: Record<string, string[]>;
  condition?: string;
  price?: number;
}

interface GenerateDescriptionOutput {
  description: string;
}

async function handleGenerateDescription(
  body: GenerateDescriptionInput
): Promise<GenerateDescriptionOutput> {
  const { title, aspects, condition, price } = body;

  if (!title || typeof title !== 'string') {
    throw new InputError('title is required and must be a string');
  }

  const systemPrompt = `You are an expert eBay listing copywriter. Generate professional, conversion-optimized eBay listing descriptions in clean HTML.

Rules:
- Use clean, semantic HTML (h2, p, ul/li, strong, etc.)
- Include a compelling intro paragraph
- List key features/specifications in bullet points
- Add a condition section if condition info is provided
- Include a brief shipping/returns note placeholder
- Keep it professional and trustworthy – no hype or spam
- Use inline styles sparingly for readability (font-family, padding)
- Do NOT include external CSS links or JavaScript
- The HTML should render well in eBay's description viewer

You MUST respond with ONLY valid JSON in this exact format:
{
  "description": "<div>...the HTML description...</div>"
}`;

  const aspectLines = aspects
    ? Object.entries(aspects)
        .map(([key, values]) => `  ${key}: ${values.join(', ')}`)
        .join('\n')
    : '';

  const userMsg = [
    `Title: "${title}"`,
    condition ? `Condition: ${condition}` : '',
    price ? `Price: $${price}` : '',
    aspectLines ? `Item Specifics:\n${aspectLines}` : '',
    'Generate a professional eBay listing description in HTML.',
  ]
    .filter(Boolean)
    .join('\n');

  return askClaude<GenerateDescriptionOutput>(systemPrompt, userMsg, 2048);
}

// ---------------------------------------------------------------------------

interface AnalyzeListingInput {
  title: string;
  description?: string;
  price?: number;
  imageCount?: number;
  aspects?: Record<string, string[]>;
  categoryName?: string;
}

interface ListingIssue {
  type: string;
  severity: string;
  message: string;
  fix: string;
}

interface AnalyzeListingOutput {
  score: number;
  issues: ListingIssue[];
  tips: string[];
}

async function handleAnalyzeListing(body: AnalyzeListingInput): Promise<AnalyzeListingOutput> {
  const { title, description, price, imageCount, aspects, categoryName } = body;

  if (!title || typeof title !== 'string') {
    throw new InputError('title is required and must be a string');
  }

  const systemPrompt = `You are an expert eBay listing analyst. Analyze eBay listings and provide actionable improvement suggestions.

Evaluate these areas:
- Title quality (keyword usage, length, readability)
- Description quality (if provided)
- Pricing competitiveness (if price provided)
- Image count (eBay recommends 7-12 images)
- Item specifics completeness
- Category relevance
- Overall listing quality

Issue severity levels: "critical", "warning", "info"
Issue types: "title", "description", "price", "images", "aspects", "category", "general"

Score is 0-100 overall listing quality.

You MUST respond with ONLY valid JSON in this exact format:
{
  "score": 0,
  "issues": [
    { "type": "title", "severity": "warning", "message": "...", "fix": "..." }
  ],
  "tips": ["tip 1", "tip 2"]
}`;

  const aspectLines = aspects
    ? Object.entries(aspects)
        .map(([key, values]) => `  ${key}: ${values.join(', ')}`)
        .join('\n')
    : '';

  const userMsg = [
    `Title: "${title}"`,
    categoryName ? `Category: ${categoryName}` : '',
    price !== undefined ? `Price: $${price}` : '',
    imageCount !== undefined ? `Number of images: ${imageCount}` : '',
    aspectLines ? `Item Specifics:\n${aspectLines}` : '',
    description ? `Description (first 500 chars): ${description.substring(0, 500)}` : 'No description provided.',
    'Analyze this eBay listing and provide improvement suggestions.',
  ]
    .filter(Boolean)
    .join('\n');

  return askClaude<AnalyzeListingOutput>(systemPrompt, userMsg);
}

// ---------------------------------------------------------------------------

interface SuggestPriceInput {
  title: string;
  condition?: string;
  categoryName?: string;
  competitorPrices?: number[];
}

interface SuggestPriceOutput {
  suggestedPrice: number;
  priceRange: { min: number; max: number };
  reasoning: string;
}

async function handleSuggestPrice(body: SuggestPriceInput): Promise<SuggestPriceOutput> {
  const { title, condition, categoryName, competitorPrices } = body;

  if (!title || typeof title !== 'string') {
    throw new InputError('title is required and must be a string');
  }

  const systemPrompt = `You are an expert eBay pricing analyst. Based on the item details and any competitor pricing data, suggest an optimal price.

Rules:
- If competitor prices are provided, use them as strong signals
- Consider item condition when pricing
- Factor in category-specific pricing patterns
- Provide a reasonable price range (min/max)
- Give clear reasoning for the suggested price
- Prices should be in USD unless otherwise specified
- Be conservative – it's better to price competitively than too high

You MUST respond with ONLY valid JSON in this exact format:
{
  "suggestedPrice": 0.00,
  "priceRange": { "min": 0.00, "max": 0.00 },
  "reasoning": "explanation of pricing rationale"
}`;

  const userMsg = [
    `Item: "${title}"`,
    condition ? `Condition: ${condition}` : '',
    categoryName ? `Category: ${categoryName}` : '',
    competitorPrices?.length
      ? `Competitor prices: ${competitorPrices.map((p) => `$${p}`).join(', ')}`
      : '',
    'Suggest an optimal price for this eBay listing.',
  ]
    .filter(Boolean)
    .join('\n');

  return askClaude<SuggestPriceOutput>(systemPrompt, userMsg);
}

// ---------------------------------------------------------------------------

interface BulkOptimizeInput {
  listings: { id: string; title: string; categoryName?: string }[];
}

interface BulkOptimizeOutput {
  results: { id: string; original: string; optimized: string }[];
}

async function handleBulkOptimizeTitles(body: BulkOptimizeInput): Promise<BulkOptimizeOutput> {
  const { listings } = body;

  if (!Array.isArray(listings) || listings.length === 0) {
    throw new InputError('listings array is required and must not be empty');
  }

  if (listings.length > 10) {
    throw new InputError('Maximum 10 listings per bulk request');
  }

  for (const listing of listings) {
    if (!listing.id || !listing.title) {
      throw new InputError('Each listing must have an id and title');
    }
  }

  const systemPrompt = `You are an expert eBay listing optimization specialist. Optimize multiple eBay listing titles at once for maximum search visibility.

Rules for eBay title optimization:
- Maximum 80 characters per title
- Include high-value keywords buyers actually search for
- Put the most important keywords first
- Avoid filler words like "WOW", "L@@K", "AMAZING"
- Include brand, model, size, color, condition when relevant
- Do NOT use all caps for entire titles

You MUST respond with ONLY valid JSON in this exact format:
{
  "results": [
    { "id": "listing-id", "original": "original title", "optimized": "optimized title" }
  ]
}

Return one result per input listing, in the same order.`;

  const listingLines = listings
    .map(
      (l, i) =>
        `${i + 1}. [ID: ${l.id}] "${l.title}"${l.categoryName ? ` (Category: ${l.categoryName})` : ''}`
    )
    .join('\n');

  const userMsg = `Optimize these eBay listing titles:\n\n${listingLines}`;

  return askClaude<BulkOptimizeOutput>(systemPrompt, userMsg, 2048);
}

// ---------------------------------------------------------------------------
// Custom error for input validation
// ---------------------------------------------------------------------------

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // 1. Authenticate --- accept API key OR session auth
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;
  let authenticated = false;

  // Try API key auth first
  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
  }

  // Fall back to session auth
  if (!authenticated) {
    try {
      const supabase = getSupabaseServerClient(req, res);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        authenticated = true;
      }
    } catch {
      // session auth failed
    }
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication' });
  }

  // 2. Route to action
  const action = req.query.action as string;
  if (!action) {
    return res.status(400).json({
      error: 'action query parameter is required',
      availableActions: [
        'optimize_title',
        'generate_description',
        'analyze_listing',
        'suggest_price',
        'bulk_optimize_titles',
      ],
    });
  }

  try {
    let result: unknown;

    switch (action) {
      case 'optimize_title':
        result = await handleOptimizeTitle(req.body);
        break;

      case 'generate_description':
        result = await handleGenerateDescription(req.body);
        break;

      case 'analyze_listing':
        result = await handleAnalyzeListing(req.body);
        break;

      case 'suggest_price':
        result = await handleSuggestPrice(req.body);
        break;

      case 'bulk_optimize_titles':
        result = await handleBulkOptimizeTitles(req.body);
        break;

      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          availableActions: [
            'optimize_title',
            'generate_description',
            'analyze_listing',
            'suggest_price',
            'bulk_optimize_titles',
          ],
        });
    }

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof InputError) {
      return res.status(400).json({ error: error.message });
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('ebay-ai handler error', error instanceof Error ? error : new Error(errMsg), {
      action,
    });

    // Don't expose internal errors to client
    if (errMsg.includes('ANTHROPIC_API_KEY')) {
      return res.status(500).json({ error: 'AI service is not configured' });
    }

    return res.status(500).json({ error: 'AI processing failed. Please try again.' });
  }
}
