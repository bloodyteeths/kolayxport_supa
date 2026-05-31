import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { logger } from '../../../lib/logger';
import {
  getAutocomplete,
  alphabetSoupExpansion,
} from '../../../lib/integrations/amazonClient';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getParam(req: NextApiRequest, key: string): string {
  const v = req.query[key];
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: API key or session
  const apiKey = req.headers['x-api-key'];
  const envApiKey = process.env.CLAWD_API_KEY;
  if (!(envApiKey && apiKey === envApiKey)) {
    const user = await getAuthUser(req, res);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = getParam(req, 'action');
  const marketplace = getParam(req, 'marketplace') || 'US';

  try {
    switch (action) {
      // -------------------------------------------------------------------
      // Simple autocomplete
      // -------------------------------------------------------------------
      case 'autocomplete': {
        const q = getParam(req, 'q');
        if (!q) return res.status(400).json({ error: 'q parameter required' });

        const suggestions = await getAutocomplete(q, marketplace);
        return res.json({ suggestions });
      }

      // -------------------------------------------------------------------
      // Alphabet soup expansion (a-z)
      // -------------------------------------------------------------------
      case 'alphabet_soup': {
        const q = getParam(req, 'q');
        if (!q) return res.status(400).json({ error: 'q parameter required' });

        const suggestions = await alphabetSoupExpansion(q, marketplace);
        return res.json({ suggestions, count: suggestions.length });
      }

      // -------------------------------------------------------------------
      // Related keywords from autocomplete depth-2
      // -------------------------------------------------------------------
      case 'related_keywords': {
        const q = getParam(req, 'q');
        if (!q) return res.status(400).json({ error: 'q parameter required' });

        // Get primary suggestions
        const primary = await getAutocomplete(q, marketplace);

        // For top 5 suggestions, get their sub-suggestions
        const related = new Set<string>();
        primary.forEach(s => related.add(s));

        const topN = primary.slice(0, 5);
        for (const suggestion of topN) {
          const subs = await getAutocomplete(suggestion, marketplace);
          subs.forEach(s => related.add(s));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const allKeywords = Array.from(related).sort();

        // Extract word frequency across all suggestions
        const wordFreq: Record<string, number> = {};
        allKeywords.forEach(kw => {
          kw.toLowerCase().split(/\s+/).filter(w => w.length > 2).forEach(w => {
            wordFreq[w] = (wordFreq[w] || 0) + 1;
          });
        });

        const topWords = Object.entries(wordFreq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 30)
          .map(([word, count]) => ({ word, count }));

        return res.json({
          query: q,
          keywords: allKeywords,
          count: allKeywords.length,
          topWords,
        });
      }

      // -------------------------------------------------------------------
      // Keyword comparison (compare search suggestion volumes)
      // -------------------------------------------------------------------
      case 'keyword_compare': {
        const keywordsParam = getParam(req, 'keywords');
        if (!keywordsParam) return res.status(400).json({ error: 'keywords parameter required (comma-separated)' });

        const keywords = keywordsParam.split(',').map(k => k.trim()).filter(Boolean).slice(0, 10);

        const results = await Promise.all(
          keywords.map(async (keyword) => {
            const suggestions = await getAutocomplete(keyword, marketplace);
            // Number of suggestions is a rough proxy for search volume
            return {
              keyword,
              suggestionCount: suggestions.length,
              topSuggestion: suggestions[0] || null,
              isExactMatch: suggestions.some(s => s.toLowerCase() === keyword.toLowerCase()),
            };
          }),
        );

        // Rank by suggestion count (higher = likely more popular)
        results.sort((a, b) => b.suggestionCount - a.suggestionCount);

        return res.json({ results });
      }

      // -------------------------------------------------------------------
      // Seasonal analysis placeholder
      // (In production, combine with Google Trends data)
      // -------------------------------------------------------------------
      case 'seasonal_analysis': {
        const q = getParam(req, 'q');
        if (!q) return res.status(400).json({ error: 'q parameter required' });

        // Amazon doesn't have a public trends API, so we provide
        // category-based seasonal patterns
        const seasonalPatterns: Record<string, { peak: string[]; low: string[] }> = {
          'toys': { peak: ['November', 'December'], low: ['January', 'February'] },
          'garden': { peak: ['March', 'April', 'May'], low: ['November', 'December'] },
          'school': { peak: ['July', 'August', 'September'], low: ['November', 'December'] },
          'fitness': { peak: ['January', 'February'], low: ['November', 'December'] },
          'swimwear': { peak: ['May', 'June', 'July'], low: ['October', 'November'] },
          'halloween': { peak: ['September', 'October'], low: ['November', 'December'] },
          'christmas': { peak: ['November', 'December'], low: ['January', 'February'] },
          'valentine': { peak: ['January', 'February'], low: ['March', 'April'] },
        };

        const lowerQ = q.toLowerCase();
        const matched = Object.entries(seasonalPatterns).find(([key]) =>
          lowerQ.includes(key),
        );

        // Also get current autocomplete to see if the product is "active"
        const suggestions = await getAutocomplete(q, marketplace);

        return res.json({
          query: q,
          currentActivity: suggestions.length > 5 ? 'high' : suggestions.length > 2 ? 'medium' : 'low',
          seasonalPattern: matched
            ? { category: matched[0], ...matched[1] }
            : { category: 'general', peak: ['November', 'December'], low: ['January', 'February'] },
          note: 'For detailed trends, combine with Google Trends data via /api/trends/etsy?action=google_trends',
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    logger.error('Amazon trends API error', err, { action });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
