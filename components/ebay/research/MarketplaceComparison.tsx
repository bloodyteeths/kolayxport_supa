import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, LinearProgress, Alert, Tooltip, Checkbox,
  FormControlLabel, CircularProgress, InputAdornment, Collapse,
  IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Search, Crown, ChevronDown, ChevronUp, ArrowRight, Globe,
  CheckCircle, XCircle, Loader2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

interface MarketplaceComparisonProps {
  userId: string;
  onNavigate?: (tool: string, data?: any) => void;
}

interface MarketplaceResult {
  query: string;
  totalResults: number;
  avgPrice: number;
  medianPrice: number;
  uniqueSellers: number;
  demandScore: number;
  competitionScore: number;
  opportunityScore: number;
  freeShippingPct: number;
  sellThroughRate: number;
  demandLabel: string;
  competitionLabel: string;
  opportunityLabel: string;
}

interface MarketplaceDef {
  id: string;
  flag: string;
  labelKey: string;
}

type LoadState = 'idle' | 'loading' | 'done' | 'error';

type SortKey = 'label' | 'totalResults' | 'avgPrice' | 'medianPrice' | 'demandScore' | 'competitionScore' | 'opportunityScore' | 'uniqueSellers' | 'freeShippingPct';

const MARKETPLACES: MarketplaceDef[] = [
  { id: 'EBAY_US', flag: '\u{1F1FA}\u{1F1F8}', labelKey: 'mc_US' },
  { id: 'EBAY_GB', flag: '\u{1F1EC}\u{1F1E7}', labelKey: 'mc_GB' },
  { id: 'EBAY_DE', flag: '\u{1F1E9}\u{1F1EA}', labelKey: 'mc_DE' },
  { id: 'EBAY_FR', flag: '\u{1F1EB}\u{1F1F7}', labelKey: 'mc_FR' },
  { id: 'EBAY_IT', flag: '\u{1F1EE}\u{1F1F9}', labelKey: 'mc_IT' },
  { id: 'EBAY_ES', flag: '\u{1F1EA}\u{1F1F8}', labelKey: 'mc_ES' },
  { id: 'EBAY_AU', flag: '\u{1F1E6}\u{1F1FA}', labelKey: 'mc_AU' },
];

const MARKETPLACE_MAP = new Map(MARKETPLACES.map(m => [m.id, m]));

async function apiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({
    action, user_id: userId, ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
    ),
  });
  const res = await fetch(`/api/clawd/ebay-research?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API error: ${res.status}`);
  }
  return res.json();
}

function scoreColor(score: number): string {
  if (score >= 70) return '#2e7d32';
  if (score >= 40) return '#ed6c02';
  return '#d32f2f';
}

function ScoreBadge({ score, label }: { score: number; label?: string }) {
  return (
    <Tooltip title={label || ''}>
      <Chip
        label={score}
        size="small"
        sx={{
          fontWeight: 700,
          color: '#fff',
          bgcolor: scoreColor(score),
          minWidth: 44,
        }}
      />
    </Tooltip>
  );
}

export default function MarketplaceComparison({ userId, onNavigate }: MarketplaceComparisonProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const t = useTranslations('ebayResearch');

  const [keyword, setKeyword] = useState('');
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(new Set(MARKETPLACES.map(m => m.id)));
  const [results, setResults] = useState<Map<string, MarketplaceResult>>(new Map());
  const [loadStates, setLoadStates] = useState<Map<string, LoadState>>(new Map());
  const [sortKey, setSortKey] = useState<SortKey>('opportunityScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const getMarketLabel = useCallback((m: MarketplaceDef) => t(m.labelKey as any), [t]);

  const isLoading = useMemo(() => {
    for (const s of loadStates.values()) {
      if (s === 'loading') return true;
    }
    return false;
  }, [loadStates]);

  const hasResults = results.size > 0;

  const toggleMarket = useCallback((id: string) => {
    setSelectedMarkets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const runComparison = useCallback(async () => {
    const q = keyword.trim();
    if (!q) { toast.error(t('mc_enterKeyword')); return; }
    const markets = MARKETPLACES.filter(m => selectedMarkets.has(m.id));
    if (markets.length === 0) { toast.error(t('mc_selectAtLeastOne')); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setResults(new Map());
    const initStates = new Map<string, LoadState>();
    markets.forEach(m => initStates.set(m.id, 'loading'));
    setLoadStates(initStates);

    const promises = markets.map(async (m) => {
      try {
        const data = await apiCall('niche_analyze', userId, { q, marketplace_id: m.id });
        if (ctrl.signal.aborted) return;
        setResults(prev => new Map(prev).set(m.id, data));
        setLoadStates(prev => new Map(prev).set(m.id, 'done'));
      } catch (err: any) {
        if (ctrl.signal.aborted) return;
        setLoadStates(prev => new Map(prev).set(m.id, 'error'));
        toast.error(`${m.flag} ${t(m.labelKey as any)}: ${err.message}`, { duration: 4000 });
      }
    });

    await Promise.allSettled(promises);
  }, [keyword, selectedMarkets, userId, t]);

  const sortedResults = useMemo(() => {
    const entries = Array.from(results.entries()).map(([id, data]) => ({
      id,
      market: MARKETPLACE_MAP.get(id)!,
      data,
    }));
    entries.sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'label') {
        av = t(a.market.labelKey as any);
        bv = t(b.market.labelKey as any);
      } else {
        av = (a.data as any)[sortKey] ?? 0;
        bv = (b.data as any)[sortKey] ?? 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return entries;
  }, [results, sortKey, sortDir, t]);

  const bestMarket = useMemo(() => {
    if (sortedResults.length === 0) return null;
    return sortedResults.reduce((best, cur) =>
      cur.data.opportunityScore > best.data.opportunityScore ? cur : best
    , sortedResults[0]);
  }, [sortedResults]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
  };

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const maxAvgPrice = useMemo(() => {
    let max = 0;
    results.forEach(r => { if (r.avgPrice > max) max = r.avgPrice; });
    return max || 1;
  }, [results]);

  const doneCount = useMemo(() => {
    let c = 0;
    loadStates.forEach(s => { if (s === 'done') c++; });
    return c;
  }, [loadStates]);

  const totalCount = loadStates.size;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Search Section */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Globe size={20} /> {t('marketplaceComparison')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={t('mc_keywordPlaceholder')}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runComparison()}
            disabled={isLoading}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><Search size={18} /></InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            onClick={runComparison}
            disabled={isLoading || !keyword.trim()}
            startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : <Search size={18} />}
            sx={{ minWidth: 130 }}
          >
            {isLoading ? t('mc_loading') : t('mc_compare')}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {MARKETPLACES.map(m => (
            <FormControlLabel
              key={m.id}
              control={
                <Checkbox
                  size="small"
                  checked={selectedMarkets.has(m.id)}
                  onChange={() => toggleMarket(m.id)}
                  disabled={isLoading}
                />
              }
              label={<Typography variant="body2">{m.flag} {t(m.labelKey as any)}</Typography>}
              sx={{ mr: 1.5 }}
            />
          ))}
        </Box>
      </Paper>

      {/* Loading State */}
      {isLoading && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <LinearProgress variant="determinate" value={totalCount > 0 ? (doneCount / totalCount) * 100 : 0} sx={{ mb: 1.5 }} />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {MARKETPLACES.filter(m => loadStates.has(m.id)).map(m => {
              const st = loadStates.get(m.id)!;
              return (
                <Chip
                  key={m.id}
                  size="small"
                  label={`${m.flag} ${t(m.labelKey as any)}`}
                  icon={
                    st === 'done' ? <CheckCircle size={14} color="#2e7d32" /> :
                    st === 'error' ? <XCircle size={14} color="#d32f2f" /> :
                    <Loader2 size={14} className="animate-spin" />
                  }
                  variant="outlined"
                  sx={{
                    borderColor: st === 'done' ? '#2e7d32' : st === 'error' ? '#d32f2f' : undefined,
                  }}
                />
              );
            })}
          </Box>
        </Paper>
      )}

      {/* Best Market Recommendation */}
      {bestMarket && !isLoading && (
        <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#f0fff4' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Crown size={22} color="#ed6c02" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('mc_bestMarket', { flag: bestMarket.market.flag, label: t(bestMarket.market.labelKey as any) })}
            </Typography>
            <ScoreBadge score={bestMarket.data.opportunityScore} label={t('mc_opportunityScore')} />
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {t('mc_highDemand', { demand: bestMarket.data.demandScore })}, {bestMarket.data.competitionScore < 50 ? t('mc_lowCompetition') : t('mc_midCompetition')} {t('mc_competitionScore', { score: bestMarket.data.competitionScore })}, {t('mc_goodPrice', { price: bestMarket.data.avgPrice.toFixed(2) })}
          </Typography>
          {onNavigate && (
            <Button
              size="small"
              variant="outlined"
              endIcon={<ArrowRight size={16} />}
              onClick={() => onNavigate('product_database', { keyword, marketplace: bestMarket.id })}
            >
              {t('mc_searchThisMarket')}
            </Button>
          )}
        </Paper>
      )}

      {/* Price Comparison Bar Chart */}
      {hasResults && !isLoading && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('mc_avgPriceComparison')}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {sortedResults.map(({ id, market, data }) => (
              <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ minWidth: 90, flexShrink: 0 }}>
                  {market.flag} {t(market.labelKey as any)}
                </Typography>
                <Box sx={{ flex: 1, position: 'relative', height: 24, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
                  <Box sx={{
                    height: '100%',
                    width: `${(data.avgPrice / maxAvgPrice) * 100}%`,
                    bgcolor: scoreColor(data.opportunityScore),
                    borderRadius: 1,
                    transition: 'width 0.4s ease',
                    opacity: 0.75,
                  }} />
                  <Typography variant="caption" sx={{
                    position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)',
                    fontWeight: 600, color: (data.avgPrice / maxAvgPrice) > 0.3 ? '#fff' : 'text.primary',
                  }}>
                    ${data.avgPrice.toFixed(2)}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Results Table (Desktop) */}
      {hasResults && !isLoading && !isMobile && (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {([
                    ['label', t('mc_colMarket')],
                    ['totalResults', t('mc_colTotalProducts')],
                    ['avgPrice', t('mc_colAvgPrice')],
                    ['medianPrice', t('mc_colMedianPrice')],
                    ['demandScore', t('mc_colDemand')],
                    ['competitionScore', t('mc_colCompetition')],
                    ['opportunityScore', t('mc_colOpportunity')],
                    ['uniqueSellers', t('mc_colSellers')],
                    ['freeShippingPct', t('mc_colFreeShipping')],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <TableCell key={key} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <TableSortLabel
                        active={sortKey === key}
                        direction={sortKey === key ? sortDir : 'desc'}
                        onClick={() => handleSort(key)}
                      >
                        {label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedResults.map(({ id, market, data }) => {
                  const isBest = bestMarket?.id === id;
                  return (
                    <TableRow key={id} sx={{ bgcolor: isBest ? '#f0fff4' : undefined }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {isBest && <Crown size={16} color="#ed6c02" />}
                          <Typography variant="body2" sx={{ fontWeight: isBest ? 700 : 400 }}>
                            {market.flag} {t(market.labelKey as any)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{(data.totalResults ?? 0).toLocaleString()}</TableCell>
                      <TableCell>${data.avgPrice.toFixed(2)}</TableCell>
                      <TableCell>${data.medianPrice.toFixed(2)}</TableCell>
                      <TableCell><ScoreBadge score={data.demandScore} label={data.demandLabel} /></TableCell>
                      <TableCell><ScoreBadge score={data.competitionScore} label={data.competitionLabel} /></TableCell>
                      <TableCell><ScoreBadge score={data.opportunityScore} label={data.opportunityLabel} /></TableCell>
                      <TableCell>{data.uniqueSellers}</TableCell>
                      <TableCell>%{data.freeShippingPct.toFixed(0)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Results Cards (Mobile) */}
      {hasResults && !isLoading && isMobile && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {sortedResults.map(({ id, market, data }) => {
            const isBest = bestMarket?.id === id;
            const expanded = expandedCards.has(id);
            return (
              <Paper key={id} variant="outlined" sx={{ bgcolor: isBest ? '#f0fff4' : undefined, overflow: 'hidden' }}>
                <Box
                  sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => toggleCard(id)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isBest && <Crown size={16} color="#ed6c02" />}
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {market.flag} {t(market.labelKey as any)}
                    </Typography>
                    <ScoreBadge score={data.opportunityScore} label={t('mc_opportunityLabel')} />
                  </Box>
                  <IconButton size="small">
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </IconButton>
                </Box>

                <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" label={`$${data.avgPrice.toFixed(2)}`} variant="outlined" />
                  <Chip size="small" label={`${t('mc_demandLabel')}: ${data.demandScore}`} sx={{ color: scoreColor(data.demandScore), borderColor: scoreColor(data.demandScore) }} variant="outlined" />
                  <Chip size="small" label={`${t('mc_competitionLabel')}: ${data.competitionScore}`} sx={{ color: scoreColor(data.competitionScore), borderColor: scoreColor(data.competitionScore) }} variant="outlined" />
                </Box>

                <Collapse in={expanded}>
                  <Box sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    <MetricRow label={t('mc_totalProducts')} value={(data.totalResults ?? 0).toLocaleString()} />
                    <MetricRow label={t('mc_avgPriceLabel')} value={`$${data.avgPrice.toFixed(2)}`} />
                    <MetricRow label={t('mc_medianPriceLabel')} value={`$${data.medianPrice.toFixed(2)}`} />
                    <MetricRow label={t('mc_demandLabel')} value={`${data.demandScore} (${data.demandLabel})`} />
                    <MetricRow label={t('mc_competitionLabel')} value={`${data.competitionScore} (${data.competitionLabel})`} />
                    <MetricRow label={t('mc_opportunityLabel')} value={`${data.opportunityScore} (${data.opportunityLabel})`} />
                    <MetricRow label={t('mc_sellerCount')} value={String(data.uniqueSellers)} />
                    <MetricRow label={t('mc_freeShippingLabel')} value={`%${data.freeShippingPct.toFixed(0)}`} />
                    <MetricRow label={t('mc_sellThroughRate')} value={`%${(data.sellThroughRate * 100).toFixed(1)}`} />
                  </Box>
                </Collapse>
              </Paper>
            );
          })}
        </Box>
      )}

      {!hasResults && !isLoading && loadStates.size > 0 && (
        <Alert severity="warning">{t('mc_noResults')}</Alert>
      )}
    </Box>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}
