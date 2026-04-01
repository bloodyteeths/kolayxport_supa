import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, LinearProgress, Alert, Tabs, Tab, Tooltip,
  IconButton, CircularProgress, InputAdornment, Grid,
} from '@mui/material';
import {
  Search, TrendingUp, Copy, Download, RotateCcw, ExternalLink,
  ArrowUpDown, Trash2, Sparkles, Type, Hash, Layers, Eye,
  CheckCircle, XCircle, Info, Zap, Plus, Minus, ShoppingBag, BarChart3,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeywordIntelligenceProps {
  userId: string;
  marketplace: string;
  userListings?: any[];
  onNavigate?: (tool: string, data?: any) => void;
}

interface MarketItem {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition: string;
  conditionId?: string;
  image?: { imageUrl: string };
  itemWebUrl: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  buyingOptions?: string[];
  itemLocation?: { postalCode: string; country: string };
  topRatedBuyingExperience?: boolean;
  itemCreationDate?: string;
  legacyItemId?: string;
  itemSpecifics?: { name: string; value: string }[];
  estimatedAvailabilities?: { estimatedSoldQuantity?: number }[];
  description?: string;
  additionalImages?: { imageUrl: string }[];
}

interface KeywordRow {
  keyword: string;
  count: number;
  usagePercent: number;
  avgPrice: number;
  competition: number; // unique seller count
  score: number;
}

interface PhraseData {
  phrase: string;
  count: number;
  percentage: number;
  avgPrice: number;
  competition: number;
  score: number;
}

interface ItemDetails {
  title: string;
  price: { value: string; currency: string };
  condition: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  itemSpecifics?: { name: string; value: string }[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  image?: { imageUrl: string };
  additionalImages?: { imageUrl: string }[];
  itemCreationDate?: string;
  estimatedAvailabilities?: { estimatedSoldQuantity?: number }[];
  itemWebUrl?: string;
  legacyItemId?: string;
}

type SortField = 'keyword' | 'usagePercent' | 'avgPrice' | 'competition' | 'score';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was', 'were',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'not', 'no', 'set', '&', '-', '/', '|', '+', 'x',
  'new', 'free', 'shipping', 'lot', 'usa', 'us',
]);

const MAX_TITLE_LENGTH = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

function extractWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[\s,;:!?()[\]{}""'']+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function extractNgrams(
  items: MarketItem[],
  n: number,
): PhraseData[] {
  const freq: Record<string, number> = {};
  const priceAcc: Record<string, number[]> = {};
  const sellerAcc: Record<string, Set<string>> = {};

  items.forEach((item) => {
    const words = extractWords(item.title);
    const price = parseFloat(item.price?.value || '0');
    const seller = item.seller?.username || item.itemId;
    const seen = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      freq[phrase] = (freq[phrase] || 0) + 1;
      if (!priceAcc[phrase]) priceAcc[phrase] = [];
      priceAcc[phrase].push(price);
      if (!sellerAcc[phrase]) sellerAcc[phrase] = new Set();
      sellerAcc[phrase].add(seller);
    }
  });

  const total = items.length || 1;
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .map(([phrase, count]) => {
      const avgPrice = priceAcc[phrase].reduce((s, v) => s + v, 0) / priceAcc[phrase].length;
      const competition = sellerAcc[phrase].size;
      const usagePct = (count / total) * 100;
      return {
        phrase,
        count,
        percentage: Math.round(usagePct),
        avgPrice,
        competition,
        score: calculateKeywordScore(usagePct, avgPrice, competition),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

function calculateKeywordScore(usage: number, avgPrice: number, competition: number): number {
  // Normalize each factor to 0-100 range, then combine
  const usageScore = Math.min(usage, 100); // higher usage = better
  const priceScore = Math.min((avgPrice / 5) * 10, 100); // higher avg price = better
  const compScore = Math.max(100 - competition * 2, 0); // lower competition = better

  const raw = usageScore * 0.4 + priceScore * 0.35 + compScore * 0.25;
  return Math.round(Math.min(raw, 100));
}

function buildKeywordRows(items: MarketItem[]): KeywordRow[] {
  const freq: Record<string, number> = {};
  const priceAcc: Record<string, number[]> = {};
  const sellerAcc: Record<string, Set<string>> = {};

  items.forEach((item) => {
    const words = extractWords(item.title);
    const price = parseFloat(item.price?.value || '0');
    const seller = item.seller?.username || item.itemId;
    const unique = new Set(words);
    unique.forEach((w) => {
      freq[w] = (freq[w] || 0) + 1;
      if (!priceAcc[w]) priceAcc[w] = [];
      priceAcc[w].push(price);
      if (!sellerAcc[w]) sellerAcc[w] = new Set();
      sellerAcc[w].add(seller);
    });
  });

  const total = items.length || 1;
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .map(([keyword, count]) => {
      const usagePercent = (count / total) * 100;
      const avgPrice = priceAcc[keyword].reduce((s, v) => s + v, 0) / priceAcc[keyword].length;
      const competition = sellerAcc[keyword].size;
      return {
        keyword,
        count,
        usagePercent,
        avgPrice,
        competition,
        score: calculateKeywordScore(usagePercent, avgPrice, competition),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
}

function generateTitleVariations(keywords: KeywordRow[], maxLen: number): string[] {
  if (keywords.length === 0) return [];
  const top = keywords.slice(0, 15).map((k) => k.keyword);
  const variations: string[] = [];

  // Variation 1: top scored keywords, in order
  let v1 = '';
  for (const w of top) {
    const candidate = v1 ? `${v1} ${w}` : w;
    if (candidate.length <= maxLen) v1 = candidate;
    else break;
  }
  if (v1) variations.push(capitalize(v1));

  // Variation 2: group by high price first
  const priceSort = [...keywords.slice(0, 15)].sort((a, b) => b.avgPrice - a.avgPrice);
  let v2 = '';
  for (const k of priceSort) {
    const candidate = v2 ? `${v2} ${k.keyword}` : k.keyword;
    if (candidate.length <= maxLen) v2 = candidate;
    else break;
  }
  if (v2 && v2 !== v1) variations.push(capitalize(v2));

  // Variation 3: low competition first
  const compSort = [...keywords.slice(0, 15)].sort((a, b) => a.competition - b.competition);
  let v3 = '';
  for (const k of compSort) {
    const candidate = v3 ? `${v3} ${k.keyword}` : k.keyword;
    if (candidate.length <= maxLen) v3 = candidate;
    else break;
  }
  if (v3 && !variations.includes(capitalize(v3))) variations.push(capitalize(v3));

  // Variation 4: mix high usage + price — alternating
  const mixed: typeof keywords = [];
  const usageSort = [...keywords.slice(0, 15)].sort((a, b) => b.usagePercent - a.usagePercent);
  for (let i = 0; i < Math.max(usageSort.length, priceSort.length); i++) {
    if (i < usageSort.length) mixed.push(usageSort[i]);
    if (i < priceSort.length && !mixed.find((m) => m.keyword === priceSort[i].keyword)) {
      mixed.push(priceSort[i]);
    }
  }
  let v4 = '';
  for (const k of mixed) {
    const candidate = v4 ? `${v4} ${k.keyword}` : k.keyword;
    if (candidate.length <= maxLen) v4 = candidate;
    else break;
  }
  if (v4 && !variations.includes(capitalize(v4))) variations.push(capitalize(v4));

  // Variation 5: randomized from top 10
  const shuffled = [...top.slice(0, 10)].sort(() => Math.random() - 0.5);
  let v5 = '';
  for (const w of shuffled) {
    const candidate = v5 ? `${v5} ${w}` : w;
    if (candidate.length <= maxLen) v5 = candidate;
    else break;
  }
  if (v5 && !variations.includes(capitalize(v5))) variations.push(capitalize(v5));

  return variations.slice(0, 5);
}

function capitalize(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseEbayUrl(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Pure numeric = legacy item ID
  if (/^\d{9,15}$/.test(trimmed)) return trimmed;

  // URL patterns
  // https://www.ebay.com/itm/123456789012
  // https://www.ebay.com/itm/some-title/123456789012
  const urlMatch = trimmed.match(/ebay\.[a-z.]+\/itm\/(?:[^/]+\/)?(\d{9,15})/i);
  if (urlMatch) return urlMatch[1];

  // Query param: ?item=123456789012
  const paramMatch = trimmed.match(/[?&]item=(\d{9,15})/i);
  if (paramMatch) return paramMatch[1];

  return null;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreBg(score: number): string {
  if (score >= 70) return 'rgba(16,185,129,0.1)';
  if (score >= 40) return 'rgba(245,158,11,0.1)';
  return 'rgba(239,68,68,0.1)';
}

function titleLengthColor(len: number): string {
  if (len >= 60 && len <= MAX_TITLE_LENGTH) return '#10b981';
  if (len >= 40 && len < 60) return '#f59e0b';
  return '#ef4444';
}

function toCSV(rows: KeywordRow[]): string {
  const header = 'Keyword,Count,Usage %,Avg Price,Competition,Score';
  const lines = rows.map(
    (r) => `"${r.keyword}",${r.count},${r.usagePercent.toFixed(1)},${r.avgPrice.toFixed(2)},${r.competition},${r.score}`,
  );
  return [header, ...lines].join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// (Tab labels moved to i18n: ebay.research.keyword.tabKeywordResearch etc.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function KeywordIntelligence({ userId, marketplace, userListings, onNavigate }: KeywordIntelligenceProps) {
  const t = useTranslations('ebay.research.keyword');
  const [activeTab, setActiveTab] = useState(0);

  // --- User keywords from listings ---
  const userKeywords = useMemo(() => {
    if (!userListings?.length) return [];
    const freq = new Map<string, number>();
    for (const l of userListings) {
      const words = (l.title || '').toLowerCase().split(/[\s,\-\/\(\)]+/).filter((w: string) => w.length > 2);
      for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
  }, [userListings]);

  // --- Keyword Research state ---
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MarketItem[]>([]);
  const [keywordRows, setKeywordRows] = useState<KeywordRow[]>([]);
  const [bigrams, setBigrams] = useState<PhraseData[]>([]);
  const [trigrams, setTrigrams] = useState<PhraseData[]>([]);
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [phraseTab, setPhraseTab] = useState(0); // 0=words, 1=bigrams, 2=trigrams
  const [error, setError] = useState('');

  // --- Reverse Lookup state ---
  const [lookupInput, setLookupInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [lookupKeywords, setLookupKeywords] = useState<{ word: string; popular: boolean }[]>([]);

  // --- Title Builder state ---
  const [titleText, setTitleText] = useState('');
  const [currentTitle, setCurrentTitle] = useState(''); // user's existing title for comparison
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  // Refs
  const queryInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Keyword Research: fetch & analyze
  // ---------------------------------------------------------------------------

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setItems([]);
    setKeywordRows([]);
    setBigrams([]);
    setTrigrams([]);

    try {
      const url = `/api/clawd/ebay?action=search_market&q=${encodeURIComponent(query.trim())}&limit=200&marketplace_id=${marketplace}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(t('apiError', { status: res.status }));
      const data = await res.json();

      const fetched: MarketItem[] = data.itemSummaries || data.items || [];
      if (fetched.length === 0) {
        setError(t('noResults'));
        return;
      }

      setItems(fetched);
      setKeywordRows(buildKeywordRows(fetched));
      setBigrams(extractNgrams(fetched, 2));
      setTrigrams(extractNgrams(fetched, 3));
    } catch (err: any) {
      setError(err.message || t('searchError'));
    } finally {
      setLoading(false);
    }
  }, [query, marketplace]);

  // ---------------------------------------------------------------------------
  // Sorted keyword rows
  // ---------------------------------------------------------------------------

  const sortedKeywords = useMemo(() => {
    const rows = [...keywordRows];
    rows.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return rows;
  }, [keywordRows, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    },
    [sortField],
  );

  // ---------------------------------------------------------------------------
  // Copy / Export
  // ---------------------------------------------------------------------------

  const copyAllKeywords = useCallback(() => {
    const text = sortedKeywords
      .slice(0, 30)
      .map((r) => r.keyword)
      .join(', ');
    navigator.clipboard.writeText(text);
    toast.success(t('top30Copied'));
  }, [sortedKeywords]);

  const exportCSV = useCallback(() => {
    downloadCSV(toCSV(sortedKeywords), `keywords_${query.replace(/\s+/g, '_')}.csv`);
    toast.success(t('csvDownloaded'));
  }, [sortedKeywords, query]);

  // ---------------------------------------------------------------------------
  // Reverse Lookup
  // ---------------------------------------------------------------------------

  const doLookup = useCallback(async () => {
    const itemId = parseEbayUrl(lookupInput);
    if (!itemId) {
      setLookupError(t('invalidEbayUrl'));
      return;
    }
    setLookupLoading(true);
    setLookupError('');
    setItemDetails(null);
    setLookupKeywords([]);

    try {
      const url = `/api/clawd/ebay?action=get_item_details&legacy_item_id=${itemId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(t('apiError', { status: res.status }));
      const data = await res.json();

      if (!data || (!data.title && !data.itemId)) {
        setLookupError(t('listingNotFound'));
        return;
      }

      setItemDetails(data);

      // Extract keywords and cross-ref with research data
      const titleWords = extractWords(data.title || '');
      const popularSet = new Set(keywordRows.filter((k) => k.usagePercent >= 10).map((k) => k.keyword));
      setLookupKeywords(
        titleWords.map((w) => ({ word: w, popular: popularSet.has(w) })),
      );
    } catch (err: any) {
      setLookupError(err.message || t('lookupError'));
    } finally {
      setLookupLoading(false);
    }
  }, [lookupInput, keywordRows]);

  const optimizeAgainst = useCallback(() => {
    if (!itemDetails?.title) return;
    setQuery(itemDetails.title);
    setActiveTab(0);
    toast.success(t('titleCopiedToSearch'));
  }, [itemDetails]);

  // ---------------------------------------------------------------------------
  // Title Builder helpers
  // ---------------------------------------------------------------------------

  const titleLength = titleText.length;
  const titleWordCount = titleText.trim() ? titleText.trim().split(/\s+/).length : 0;
  const titleWordsSet = useMemo(() => new Set(extractWords(titleText)), [titleText]);

  const suggestedKeywords = useMemo(() => {
    return sortedKeywords.filter((k) => !titleWordsSet.has(k.keyword)).slice(0, 30);
  }, [sortedKeywords, titleWordsSet]);

  const titleVariations = useMemo(() => {
    return generateTitleVariations(sortedKeywords, MAX_TITLE_LENGTH);
  }, [sortedKeywords]);

  const addKeywordToTitle = useCallback(
    (word: string) => {
      const next = titleText ? `${titleText} ${word}` : word;
      if (next.length <= MAX_TITLE_LENGTH) {
        setTitleText(next);
        setSelectedKeywords((prev) => new Set([...prev, word]));
      } else {
        toast.error(t('charLimitExceeded', { max: MAX_TITLE_LENGTH }));
      }
    },
    [titleText],
  );

  const removeLastWord = useCallback(() => {
    const words = titleText.trim().split(/\s+/);
    if (words.length <= 1) {
      setTitleText('');
      setSelectedKeywords(new Set());
      return;
    }
    const removed = words.pop()!;
    setTitleText(words.join(' '));
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      next.delete(removed.toLowerCase());
      return next;
    });
  }, [titleText]);

  // Keyword coverage comparison
  const currentTitleWords = useMemo(() => new Set(extractWords(currentTitle)), [currentTitle]);
  const newTitleWords = useMemo(() => new Set(extractWords(titleText)), [titleText]);
  const currentCoverage = useMemo(() => {
    if (sortedKeywords.length === 0) return 0;
    const top20 = sortedKeywords.slice(0, 20).map((k) => k.keyword);
    return Math.round((top20.filter((k) => currentTitleWords.has(k)).length / top20.length) * 100);
  }, [sortedKeywords, currentTitleWords]);
  const newCoverage = useMemo(() => {
    if (sortedKeywords.length === 0) return 0;
    const top20 = sortedKeywords.slice(0, 20).map((k) => k.keyword);
    return Math.round((top20.filter((k) => newTitleWords.has(k)).length / top20.length) * 100);
  }, [sortedKeywords, newTitleWords]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderSortableHeader = (label: string, field: SortField) => (
    <TableSortLabel
      active={sortField === field}
      direction={sortField === field ? sortDir : 'desc'}
      onClick={() => handleSort(field)}
    >
      {label}
    </TableSortLabel>
  );

  const renderPhraseTable = (data: PhraseData[], label: string) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, maxHeight: 400, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{label}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('colUsage')}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('colAvgPrice')}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('colCompetition')}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('colScore')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={row.phrase}
              hover
              sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(99,102,241,0.04)' } }}
              onClick={() => addKeywordToTitle(row.phrase)}
            >
              <TableCell>
                <Typography variant="body2" fontWeight={500}>{row.phrase}</Typography>
              </TableCell>
              <TableCell align="right">{pct(row.percentage)}</TableCell>
              <TableCell align="right">{fmt(row.avgPrice)}</TableCell>
              <TableCell align="right">{row.competition}</TableCell>
              <TableCell align="right">
                <Chip
                  label={row.score}
                  size="small"
                  sx={{
                    bgcolor: scoreBg(row.score),
                    color: scoreColor(row.score),
                    fontWeight: 700,
                    minWidth: 44,
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} align="center">
                <Typography variant="body2" color="text.secondary">
                  {t('noDataYet')}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  // ---------------------------------------------------------------------------
  // TAB 1: Keyword Research
  // ---------------------------------------------------------------------------

  const renderKeywordResearch = () => (
    <Box>
      {/* User's own keywords */}
      {userKeywords.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'action.hover', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {t('popularWordsInListings')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {userKeywords.map(({ word, count }) => (
              <Chip
                key={word}
                label={`${word} (${count})`}
                size="small"
                variant="outlined"
                onClick={() => setQuery(word)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Search bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          inputRef={queryInputRef}
          size="small"
          placeholder={t('searchPlaceholder')}
          helperText={t('searchHelperText')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          sx={{ flex: 1, minWidth: 200 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            ),
          }}
        />
        <Button
          variant="contained"
          onClick={doSearch}
          disabled={loading || !query.trim()}
          startIcon={loading ? <CircularProgress size={16} /> : <TrendingUp size={16} />}
          sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
        >
          {t('searchButton')}
        </Button>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2, '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' } }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {keywordRows.length > 0 && (
        <>
          {/* Summary */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip
              icon={<Hash size={14} />}
              label={t('listingsAnalyzed', { count: items.length })}
              variant="outlined"
              size="small"
            />
            <Chip
              icon={<Type size={14} />}
              label={t('uniqueWords', { count: keywordRows.length })}
              variant="outlined"
              size="small"
            />
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
              <Tooltip title={t('copyTop30Tooltip')}>
                <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={copyAllKeywords} sx={{ borderColor: '#6366f1', color: '#6366f1' }}>
                  {t('copyAll')}
                </Button>
              </Tooltip>
              <Tooltip title={t('downloadCsvTooltip')}>
                <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCSV} sx={{ borderColor: '#6366f1', color: '#6366f1' }}>
                  CSV
                </Button>
              </Tooltip>
            </Box>
          </Box>

          {/* Phrase type tabs */}
          <Tabs
            value={phraseTab}
            onChange={(_, v) => setPhraseTab(v)}
            sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 }, '& .Mui-selected': { color: '#6366f1' }, '& .MuiTabs-indicator': { bgcolor: '#6366f1' } }}
          >
            <Tab label={t('tabSingleWords')} />
            <Tab label={t('tabBigrams')} />
            <Tab label={t('tabTrigrams')} />
          </Tabs>

          {/* Unigrams table */}
          {phraseTab === 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 500, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      {renderSortableHeader(t('colKeyword'), 'keyword')}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      {renderSortableHeader(t('colUsagePercent'), 'usagePercent')}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      {renderSortableHeader(t('colAvgPrice'), 'avgPrice')}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      {renderSortableHeader(t('colCompetition'), 'competition')}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      {renderSortableHeader(t('colScore'), 'score')}
                    </TableCell>
                    {onNavigate && (
                      <TableCell align="center" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('colActions')}</TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedKeywords.map((row) => (
                    <TableRow
                      key={row.keyword}
                      hover
                      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(99,102,241,0.04)' } }}
                      onClick={() => addKeywordToTitle(row.keyword)}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{row.keyword}</Typography>
                      </TableCell>
                      <TableCell align="right">{pct(row.usagePercent)}</TableCell>
                      <TableCell align="right">{fmt(row.avgPrice)}</TableCell>
                      <TableCell align="right">{row.competition}</TableCell>
                      <TableCell align="right">
                        <Chip
                          label={row.score}
                          size="small"
                          sx={{
                            bgcolor: scoreBg(row.score),
                            color: scoreColor(row.score),
                            fontWeight: 700,
                            minWidth: 44,
                          }}
                        />
                      </TableCell>
                      {onNavigate && (
                        <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title={t('viewProducts')}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigate('product_database', { keyword: row.keyword });
                              }}
                            >
                              <ShoppingBag size={15} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('nicheAnalysis')}>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigate('niche_finder', { keyword: row.keyword });
                              }}
                            >
                              <BarChart3 size={15} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Bigrams */}
          {phraseTab === 1 && renderPhraseTable(bigrams, t('bigramLabel'))}

          {/* Trigrams */}
          {phraseTab === 2 && renderPhraseTable(trigrams, t('trigramLabel'))}
        </>
      )}
    </Box>
  );

  // ---------------------------------------------------------------------------
  // TAB 2: Reverse Listing Lookup
  // ---------------------------------------------------------------------------

  const renderReverseLookup = () => (
    <Box>
      {/* Input */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder={t('lookupPlaceholder')}
          helperText={t('lookupHelperText')}
          value={lookupInput}
          onChange={(e) => setLookupInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doLookup()}
          sx={{ flex: 1, minWidth: 240 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Eye size={18} />
              </InputAdornment>
            ),
          }}
        />
        <Button
          variant="contained"
          onClick={doLookup}
          disabled={lookupLoading || !lookupInput.trim()}
          startIcon={lookupLoading ? <CircularProgress size={16} /> : <Search size={16} />}
          sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
        >
          {t('analyzeButton')}
        </Button>
      </Box>

      {lookupLoading && <LinearProgress sx={{ mb: 2, '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' } }} />}
      {lookupError && <Alert severity="error" sx={{ mb: 2 }}>{lookupError}</Alert>}

      {itemDetails && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Title analysis */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">{t('titleLabel')}</Typography>
              <Chip label={`${(itemDetails.title || '').length} ${t('charactersLabel')}`} size="small" variant="outlined" />
            </Box>
            <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
              {itemDetails.title}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
              {lookupKeywords.map((kw, i) => (
                <Chip
                  key={`${kw.word}-${i}`}
                  label={kw.word}
                  size="small"
                  color={kw.popular ? 'success' : 'default'}
                  variant={kw.popular ? 'filled' : 'outlined'}
                  onClick={() => addKeywordToTitle(kw.word)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
            {lookupKeywords.some((k) => k.popular) && (
              <Typography variant="caption" color="text.secondary">
                <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {t('popularKeywordsHint')}
              </Typography>
            )}
            <Box sx={{ mt: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Zap size={14} />}
                onClick={optimizeAgainst}
                sx={{ borderColor: '#6366f1', color: '#6366f1' }}
              >
                {t('optimizeAgainst')}
              </Button>
            </Box>
          </Paper>

          {/* Price & seller info */}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>{t('priceInfo')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{t('priceLabel')}</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {itemDetails.price ? `${itemDetails.price.currency} ${itemDetails.price.value}` : 'N/A'}
                    </Typography>
                  </Box>
                  {itemDetails.shippingOptions?.[0]?.shippingCost && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{t('shippingLabel')}</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {itemDetails.shippingOptions[0].shippingCost.currency}{' '}
                        {itemDetails.shippingOptions[0].shippingCost.value}
                      </Typography>
                    </Box>
                  )}
                  <Divider sx={{ my: 0.5 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" fontWeight={600}>{t('totalLabel')}</Typography>
                    <Typography variant="body2" fontWeight={700} color="primary">
                      {itemDetails.price
                        ? `${itemDetails.price.currency} ${(
                            parseFloat(itemDetails.price.value) +
                            parseFloat(itemDetails.shippingOptions?.[0]?.shippingCost?.value || '0')
                          ).toFixed(2)}`
                        : 'N/A'}
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>{t('sellerInfo')}</Typography>
                {itemDetails.seller ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{t('usernameLabel')}</Typography>
                      <Typography variant="body2" fontWeight={600}>{itemDetails.seller.username}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{t('feedbackScoreLabel')}</Typography>
                      <Typography variant="body2" fontWeight={600}>{itemDetails.seller.feedbackScore}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{t('positiveRateLabel')}</Typography>
                      <Typography variant="body2" fontWeight={600}>{itemDetails.seller.feedbackPercentage}%</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">{t('sellerNotAvailable')}</Typography>
                )}
              </Paper>
            </Grid>
          </Grid>

          {/* Listing details */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>{t('listingDetails')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">{t('conditionLabel')}</Typography>
                <Typography variant="body2" fontWeight={600}>{itemDetails.condition || 'N/A'}</Typography>
              </Box>
              {itemDetails.categories && itemDetails.categories.length > 0 && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">{t('categoryLabel')}</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {itemDetails.categories.map((c) => c.categoryName).join(' > ')}
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">{t('imageCountLabel')}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {1 + (itemDetails.additionalImages?.length || 0)}
                </Typography>
              </Box>
              {itemDetails.estimatedAvailabilities?.[0]?.estimatedSoldQuantity != null && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">{t('estimatedSalesLabel')}</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {itemDetails.estimatedAvailabilities[0].estimatedSoldQuantity}
                  </Typography>
                </Box>
              )}
              {itemDetails.itemCreationDate && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">{t('creationDateLabel')}</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {new Date(itemDetails.itemCreationDate).toLocaleDateString('tr-TR')}
                  </Typography>
                </Box>
              )}
              {itemDetails.legacyItemId && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Item ID:</Typography>
                  <Typography variant="body2" fontWeight={600}>{itemDetails.legacyItemId}</Typography>
                </Box>
              )}
            </Box>
          </Paper>

          {/* Item Specifics */}
          {itemDetails.itemSpecifics && itemDetails.itemSpecifics.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('itemSpecifics', { count: itemDetails.itemSpecifics.length })}
              </Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('specNameCol')}</TableCell>
                      <TableCell sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>{t('specValueCol')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {itemDetails.itemSpecifics.map((spec, i) => (
                      <TableRow key={i} hover sx={{ '&:hover': { bgcolor: 'rgba(99,102,241,0.04)' } }}>
                        <TableCell>{spec.name}</TableCell>
                        <TableCell>{spec.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>
      )}
    </Box>
  );

  // ---------------------------------------------------------------------------
  // TAB 3: Title Builder
  // ---------------------------------------------------------------------------

  const renderTitleBuilder = () => {
    const lengthPct = (titleLength / MAX_TITLE_LENGTH) * 100;
    const barColor = titleLengthColor(titleLength);

    return (
      <Box>
        {sortedKeywords.length === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('doSearchFirst')}
          </Alert>
        )}

        <Grid container spacing={2}>
          {/* LEFT: Keyword bank */}
          <Grid item xs={12} md={5}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle2" gutterBottom>
                <Layers size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {t('keywordBank')}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                {t('clickToAddToTitle')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxHeight: 300, overflow: 'auto' }}>
                {sortedKeywords.map((kw) => {
                  const inTitle = titleWordsSet.has(kw.keyword);
                  return (
                    <Chip
                      key={kw.keyword}
                      label={`${kw.keyword} (${kw.score})`}
                      size="small"
                      color={inTitle ? 'primary' : 'default'}
                      variant={inTitle ? 'filled' : 'outlined'}
                      onClick={() => !inTitle && addKeywordToTitle(kw.keyword)}
                      sx={{
                        cursor: inTitle ? 'default' : 'pointer',
                        opacity: inTitle ? 0.6 : 1,
                        borderColor: !inTitle ? scoreColor(kw.score) : undefined,
                      }}
                    />
                  );
                })}
                {sortedKeywords.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {t('noKeywordsYet')}
                  </Typography>
                )}
              </Box>
            </Paper>
          </Grid>

          {/* RIGHT: Title editor */}
          <Grid item xs={12} md={7}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle2" gutterBottom>
                <Type size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {t('titleEditor')}
              </Typography>

              {/* Title field */}
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                maxRows={3}
                placeholder={t('titleEditorPlaceholder')}
                helperText={t('titleEditorHelperText')}
                value={titleText}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_TITLE_LENGTH + 10) {
                    setTitleText(e.target.value);
                  }
                }}
                sx={{ mb: 1 }}
                error={titleLength > MAX_TITLE_LENGTH}
              />

              {/* Character bar */}
              <Box sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: barColor, fontWeight: 600 }}>
                    {t('charactersCount', { current: titleLength, max: MAX_TITLE_LENGTH })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('wordsCount', { count: titleWordCount })}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(lengthPct, 100)}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: '#e0e0e0',
                    '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', borderRadius: 3 },
                  }}
                />
              </Box>

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Trash2 size={14} />}
                  onClick={() => {
                    setTitleText('');
                    setSelectedKeywords(new Set());
                  }}
                  sx={{ borderColor: '#6366f1', color: '#6366f1' }}
                >
                  {t('clearButton')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Minus size={14} />}
                  onClick={removeLastWord}
                  disabled={!titleText}
                  sx={{ borderColor: '#6366f1', color: '#6366f1' }}
                >
                  {t('removeLastWord')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Copy size={14} />}
                  onClick={() => {
                    navigator.clipboard.writeText(titleText);
                    toast.success(t('titleCopied'));
                  }}
                  disabled={!titleText}
                  sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
                >
                  {t('copyButton')}
                </Button>
              </Box>

              {/* Suggested keywords not in title */}
              {suggestedKeywords.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    {t('suggestedKeywords')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxHeight: 100, overflow: 'auto' }}>
                    {suggestedKeywords.slice(0, 20).map((kw) => (
                      <Chip
                        key={kw.keyword}
                        label={kw.keyword}
                        size="small"
                        variant="outlined"
                        color="success"
                        onClick={() => addKeywordToTitle(kw.keyword)}
                        icon={<Plus size={12} />}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Paper>

            {/* Suggested Titles */}
            {titleVariations.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <Typography variant="subtitle2" gutterBottom>
                  <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {t('suggestedTitles')}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {titleVariations.map((v, i) => (
                    <Box
                      key={i}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        '&:hover': { bgcolor: 'action.selected' },
                      }}
                    >
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {v}
                      </Typography>
                      <Chip label={`${v.length}k`} size="small" variant="outlined" />
                      <Tooltip title={t('useThisTitle')}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setTitleText(v);
                            toast.success(t('titleSelected'));
                          }}
                        >
                          <CheckCircle size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('copyTooltip')}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            navigator.clipboard.writeText(v);
                            toast.success(t('copied'));
                          }}
                        >
                          <Copy size={14} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Box>
              </Paper>
            )}

            {/* Title Comparison */}
            <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle2" gutterBottom>
                <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {t('titleComparison')}
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder={t('currentTitlePlaceholder')}
                helperText={t('currentTitleHelperText')}
                value={currentTitle}
                onChange={(e) => setCurrentTitle(e.target.value)}
                sx={{ mb: 2 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Info size={14} />
                    </InputAdornment>
                  ),
                }}
              />

              {currentTitle && titleText && sortedKeywords.length > 0 && (
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Paper
                      variant="outlined"
                      sx={{ p: 1.5, bgcolor: currentCoverage >= newCoverage ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}
                    >
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('currentTitle')}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-word' }}>
                        {currentTitle}
                      </Typography>
                      <Chip
                        label={t('coverage', { percent: currentCoverage })}
                        size="small"
                        color={currentCoverage >= 50 ? 'success' : 'warning'}
                      />
                      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                        {t('charsAndWords', { chars: currentTitle.length, words: currentTitle.trim().split(/\s+/).length })}
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={6}>
                    <Paper
                      variant="outlined"
                      sx={{ p: 1.5, bgcolor: newCoverage >= currentCoverage ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}
                    >
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t('newTitle')}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-word' }}>
                        {titleText}
                      </Typography>
                      <Chip
                        label={t('coverage', { percent: newCoverage })}
                        size="small"
                        color={newCoverage >= 50 ? 'success' : 'warning'}
                      />
                      <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                        {t('charsAndWords', { chars: titleText.length, words: titleWordCount })}
                      </Typography>
                    </Paper>
                  </Grid>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {newCoverage > currentCoverage ? (
                        <CheckCircle size={16} color="#10b981" />
                      ) : newCoverage === currentCoverage ? (
                        <Info size={16} color="#f59e0b" />
                      ) : (
                        <XCircle size={16} color="#ef4444" />
                      )}
                      <Typography variant="body2">
                        {newCoverage > currentCoverage
                          ? t('newTitleBetterCoverage', { diff: newCoverage - currentCoverage })
                          : newCoverage === currentCoverage
                          ? t('sameCoverage')
                          : t('currentTitleBetterCoverage', { diff: currentCoverage - newCoverage })}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              )}

              {(!currentTitle || !titleText) && sortedKeywords.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('enterBothTitles')}
                </Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
        <Zap size={20} color="#6366f1" style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('description')}
      </Typography>

      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{
          mb: 2,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem' },
          '& .Mui-selected': { color: '#6366f1' },
          '& .MuiTabs-indicator': { bgcolor: '#6366f1' },
        }}
      >
        <Tab icon={<Search size={16} />} iconPosition="start" label={t('tabKeywordResearch')} />
        <Tab icon={<Eye size={16} />} iconPosition="start" label={t('tabReverseLookup')} />
        <Tab icon={<Type size={16} />} iconPosition="start" label={t('tabTitleBuilder')} />
      </Tabs>

      {activeTab === 0 && renderKeywordResearch()}
      {activeTab === 1 && renderReverseLookup()}
      {activeTab === 2 && renderTitleBuilder()}
    </Box>
  );
}
