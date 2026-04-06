import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';

// Google Trends API (npm package)
let googleTrends: any;
try {
  googleTrends = require('google-trends-api');
} catch {
  googleTrends = null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth check
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action as string;
  if (!action) {
    return res.status(400).json({ error: 'Action required' });
  }

  try {
    switch (action) {
      case 'google_trends':
        return await handleGoogleTrends(req, res);
      case 'autocomplete':
        return await handleAutocomplete(req, res);
      case 'keyword_volume':
        return await handleKeywordVolume(req, res);
      case 'seasonal_trends':
        return await handleSeasonalTrends(req, res);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error: any) {
    console.error(`[trends/etsy] ${action} error:`, error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}

// ---------------------------------------------------------------------------
// Action: google_trends
// ---------------------------------------------------------------------------

async function handleGoogleTrends(req: NextApiRequest, res: NextApiResponse) {
  const keyword = (req.query.keyword as string || '').trim();
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });

  if (!googleTrends) {
    return res.status(500).json({ error: 'google-trends-api not available' });
  }

  const startTime = new Date();
  startTime.setFullYear(startTime.getFullYear() - 1);

  // Fetch interest over time + related queries in parallel
  const [interestRaw, relatedRaw] = await Promise.all([
    googleTrends.interestOverTime({
      keyword,
      startTime,
      category: 18, // Shopping
      geo: '', // Worldwide
    }).catch(() => null),
    googleTrends.relatedQueries({
      keyword,
      startTime,
      category: 18,
    }).catch(() => null),
  ]);

  // Parse interest over time
  let timeline: { date: string; value: number }[] = [];
  let averageInterest = 0;
  let peakValue = 0;
  let peakDate = '';

  if (interestRaw) {
    try {
      const parsed = JSON.parse(interestRaw);
      const data = parsed?.default?.timelineData || [];
      timeline = data.map((d: any) => ({
        date: d.formattedAxisTime || d.formattedTime || '',
        value: d.value?.[0] || 0,
      }));
      if (timeline.length > 0) {
        averageInterest = Math.round(timeline.reduce((s, t) => s + t.value, 0) / timeline.length);
        const peak = timeline.reduce((best, t) => t.value > best.value ? t : best, timeline[0]);
        peakValue = peak.value;
        peakDate = peak.date;
      }
    } catch { /* ignore parse errors */ }
  }

  // Parse related queries
  let risingQueries: { query: string; value: string }[] = [];
  let topQueries: { query: string; value: number }[] = [];

  if (relatedRaw) {
    try {
      const parsed = JSON.parse(relatedRaw);
      const defaultData = parsed?.default;
      if (defaultData) {
        const rising = defaultData.rankedList?.[1]?.rankedKeyword || [];
        risingQueries = rising.slice(0, 15).map((r: any) => ({
          query: r.query,
          value: r.formattedValue || String(r.value),
        }));
        const top = defaultData.rankedList?.[0]?.rankedKeyword || [];
        topQueries = top.slice(0, 15).map((t: any) => ({
          query: t.query,
          value: t.value,
        }));
      }
    } catch { /* ignore */ }
  }

  // Determine trend direction
  let trendDirection: 'rising' | 'stable' | 'declining' = 'stable';
  if (timeline.length >= 4) {
    const recent = timeline.slice(-4).reduce((s, t) => s + t.value, 0) / 4;
    const older = timeline.slice(0, 4).reduce((s, t) => s + t.value, 0) / 4;
    if (recent > older * 1.2) trendDirection = 'rising';
    else if (recent < older * 0.8) trendDirection = 'declining';
  }

  return res.status(200).json({
    keyword,
    timeline,
    averageInterest,
    peakValue,
    peakDate,
    trendDirection,
    risingQueries,
    topQueries,
  });
}

// ---------------------------------------------------------------------------
// Action: autocomplete
// ---------------------------------------------------------------------------

async function handleAutocomplete(req: NextApiRequest, res: NextApiResponse) {
  const keyword = (req.query.keyword as string || '').trim();
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });

  const alphabetSoup = req.query.alphabet === 'true';

  // Build queries: base keyword + optional alphabet expansion
  const queries = [keyword];
  if (alphabetSoup) {
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach(letter => {
      queries.push(`${keyword} ${letter}`);
    });
  }

  const allSuggestions: { text: string; source: string; score: number }[] = [];

  // Process in batches to avoid rate limits
  for (const q of queries) {
    const [googleResults, amazonResults] = await Promise.all([
      fetchGoogleSuggestions(q),
      fetchAmazonSuggestions(q),
    ]);

    googleResults.forEach(text => {
      allSuggestions.push({ text: text.toLowerCase().trim(), source: 'google', score: 0 });
    });

    amazonResults.forEach(text => {
      allSuggestions.push({ text: text.toLowerCase().trim(), source: 'amazon', score: 0 });
    });

    // Small delay between alphabet queries
    if (alphabetSoup && queries.length > 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Deduplicate and score
  const merged = new Map<string, { text: string; sources: Set<string>; count: number }>();
  allSuggestions.forEach(s => {
    const existing = merged.get(s.text);
    if (existing) {
      existing.sources.add(s.source);
      existing.count++;
    } else {
      merged.set(s.text, { text: s.text, sources: new Set([s.source]), count: 1 });
    }
  });

  const results = Array.from(merged.values())
    .map(m => ({
      keyword: m.text,
      sources: Array.from(m.sources),
      sourceCount: m.sources.size,
      frequency: m.count,
      // Score: higher if appears in multiple sources
      score: m.sources.size * 30 + m.count * 5,
    }))
    .filter(r => r.keyword !== keyword.toLowerCase())
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  return res.status(200).json({
    keyword,
    suggestions: results,
    totalFound: results.length,
    alphabetSoup,
  });
}

async function fetchGoogleSuggestions(query: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data[1] || []).slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchAmazonSuggestions(query: string): Promise<string[]> {
  try {
    const url = `https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.suggestions || []).map((s: any) => s.value).slice(0, 10);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Action: keyword_volume
// ---------------------------------------------------------------------------

async function handleKeywordVolume(req: NextApiRequest, res: NextApiResponse) {
  let keywords: string[] = [];

  if (req.method === 'POST') {
    keywords = req.body?.keywords || [];
  } else {
    const kw = req.query.keywords as string || '';
    keywords = kw.split(',').map(k => k.trim()).filter(Boolean);
  }

  if (keywords.length === 0) return res.status(400).json({ error: 'Keywords required' });
  keywords = keywords.slice(0, 10); // Max 10

  if (!googleTrends) {
    return res.status(500).json({ error: 'google-trends-api not available' });
  }

  const startTime = new Date();
  startTime.setFullYear(startTime.getFullYear() - 1);

  // Fetch all keywords' interest data
  // Google Trends compares up to 5 keywords at once
  const results: { keyword: string; volume: number; trend: string }[] = [];

  // Process in chunks of 5
  for (let i = 0; i < keywords.length; i += 5) {
    const chunk = keywords.slice(i, i + 5);

    try {
      const raw = await googleTrends.interestOverTime({
        keyword: chunk,
        startTime,
        category: 18,
      });

      const parsed = JSON.parse(raw);
      const data = parsed?.default?.timelineData || [];

      chunk.forEach((kw, idx) => {
        const values = data.map((d: any) => d.value?.[idx] || 0);
        const avg = values.length > 0 ? Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length) : 0;

        // Trend direction
        let trend = 'stable';
        if (values.length >= 8) {
          const recent = values.slice(-4).reduce((a: number, b: number) => a + b, 0) / 4;
          const older = values.slice(0, 4).reduce((a: number, b: number) => a + b, 0) / 4;
          if (recent > older * 1.2) trend = 'rising';
          else if (recent < older * 0.8) trend = 'declining';
        }

        results.push({ keyword: kw, volume: avg, trend });
      });
    } catch {
      chunk.forEach(kw => results.push({ keyword: kw, volume: 0, trend: 'unknown' }));
    }

    // Rate limit delay between chunks
    if (i + 5 < keywords.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return res.status(200).json({
    keywords: results.sort((a, b) => b.volume - a.volume),
  });
}

// ---------------------------------------------------------------------------
// Action: seasonal_trends
// ---------------------------------------------------------------------------

const CATEGORY_WIKI_MAP: Record<string, string> = {
  jewelry: 'Jewellery',
  necklace: 'Necklace',
  bracelet: 'Bracelet',
  ring: 'Ring_(jewellery)',
  earring: 'Earring',
  macrame: 'Macramé',
  crochet: 'Crochet',
  knitting: 'Knitting',
  candle: 'Candle',
  soap: 'Soap',
  pottery: 'Pottery',
  ceramic: 'Ceramic_art',
  woodworking: 'Woodworking',
  embroidery: 'Embroidery',
  quilting: 'Quilting',
  wedding: 'Wedding',
  baby: 'Infant',
  nursery: 'Nursery_(room)',
  gift: 'Gift',
  christmas: 'Christmas',
  halloween: 'Halloween',
  valentine: 'Valentine%27s_Day',
  'mothers day': 'Mother%27s_Day',
  'fathers day': 'Father%27s_Day',
  birthday: 'Birthday',
  home: 'Home_decoration',
  garden: 'Gardening',
  vintage: 'Vintage_clothing',
  art: 'Art',
  painting: 'Painting',
  print: 'Printmaking',
  sticker: 'Sticker',
  planner: 'Personal_organizer',
  tote: 'Tote_bag',
  bag: 'Bag',
  leather: 'Leather',
  personalized: 'Personalization',
  custom: 'Mass_customization',
  pet: 'Pet',
  dog: 'Dog',
  cat: 'Cat',
};

async function handleSeasonalTrends(req: NextApiRequest, res: NextApiResponse) {
  const keyword = (req.query.keyword as string || '').trim().toLowerCase();
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });

  // Find best matching Wikipedia article
  let article = '';
  for (const [key, wiki] of Object.entries(CATEGORY_WIKI_MAP)) {
    if (keyword.includes(key)) {
      article = wiki;
      break;
    }
  }

  // Also try Google Trends monthly data
  let monthlyData: { month: string; value: number }[] = [];

  if (googleTrends) {
    try {
      const startTime = new Date();
      startTime.setFullYear(startTime.getFullYear() - 2);

      const raw = await googleTrends.interestOverTime({
        keyword,
        startTime,
        category: 18,
        granularTimeResolution: false,
      });

      const parsed = JSON.parse(raw);
      const data = parsed?.default?.timelineData || [];

      // Aggregate by month
      const monthMap: Record<string, number[]> = {};
      data.forEach((d: any) => {
        const date = new Date(d.time * 1000);
        const monthKey = date.toLocaleString('en-US', { month: 'short' });
        if (!monthMap[monthKey]) monthMap[monthKey] = [];
        monthMap[monthKey].push(d.value?.[0] || 0);
      });

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      monthlyData = months.map(m => ({
        month: m,
        value: monthMap[m]?.length ? Math.round(monthMap[m].reduce((a, b) => a + b, 0) / monthMap[m].length) : 0,
      }));
    } catch { /* ignore */ }
  }

  // Fetch Wikipedia pageviews if article found
  let wikiData: { month: string; views: number }[] = [];

  if (article) {
    try {
      const end = new Date();
      const start = new Date();
      start.setFullYear(start.getFullYear() - 1);

      const startStr = start.toISOString().slice(0, 10).replace(/-/g, '');
      const endStr = end.toISOString().slice(0, 10).replace(/-/g, '');

      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${article}/monthly/${startStr}/${endStr}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'KolayXport/1.0 (market-research)' },
      });

      if (response.ok) {
        const data = await response.json();
        wikiData = (data.items || []).map((item: any) => ({
          month: new Date(item.timestamp.replace(/(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3')).toLocaleString('en-US', { month: 'short' }),
          views: item.views,
        }));
      }
    } catch { /* ignore */ }
  }

  // Determine peak and low months
  let peakMonth = '';
  let lowMonth = '';
  const dataToAnalyze = monthlyData.length > 0 ? monthlyData : wikiData.map(w => ({ month: w.month, value: w.views }));

  if (dataToAnalyze.length > 0) {
    const sorted = [...dataToAnalyze].sort((a, b) => b.value - a.value);
    peakMonth = sorted[0]?.month || '';
    lowMonth = sorted[sorted.length - 1]?.month || '';
  }

  return res.status(200).json({
    keyword,
    article: article || null,
    monthlyTrends: monthlyData,
    wikiPageviews: wikiData,
    peakMonth,
    lowMonth,
    hasData: monthlyData.length > 0 || wikiData.length > 0,
  });
}
