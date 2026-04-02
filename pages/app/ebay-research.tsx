import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Tabs, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, IconButton, Tooltip, LinearProgress, Alert, Select,
  MenuItem, FormControl, InputLabel, CircularProgress, Divider,
  InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions,
  Slider, Card, CardContent, Collapse, useMediaQuery, useTheme,
  Grid, Badge, Skeleton, TableSortLabel,
} from '@mui/material';
import {
  Search, TrendingUp, TrendingDown, Star, ExternalLink,
  Plus, Trash2, RefreshCw, Eye, Bookmark, BarChart2,
  DollarSign, Users, FolderTree, Gauge, Package, Target,
  ChevronDown, ChevronUp, Edit3, Tag, Clock, AlertTriangle,
  Save, X, Copy, ShoppingBag, Globe, Filter, ArrowUpDown,
  Sparkles, Zap, Download, Layers, Lightbulb,
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import KeywordIntelligence from '@/components/ebay/research/KeywordIntelligence';
import CompetitiveIntelligence from '@/components/ebay/research/CompetitiveIntelligence';
import ListingOptimizer from '@/components/ebay/research/ListingOptimizer';
import FinancialIntelligence from '@/components/ebay/research/FinancialIntelligence';
import ArbitrageScanner from '@/components/ebay/research/ArbitrageScanner';
import SeoAnalyzer from '@/components/ebay/research/SeoAnalyzer';
import AiOptimizationHub from '@/components/ebay/research/AiOptimizationHub';
import MarketplaceComparison from '@/components/ebay/research/MarketplaceComparison';
import CategoryExplorer from '@/components/ebay/research/CategoryExplorer';
import NicheComparison from '@/components/ebay/research/NicheComparison';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchFilters {
  keyword: string;
  categoryId: string;
  priceMin: number;
  priceMax: number;
  condition: string;
  sortBy: string;
  marketplace: string;
}

interface ProductResult {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  condition: string;
  seller: string;
  sellerFeedback: number;
  shippingCost: number | null;
  freeShipping: boolean;
  topRated: boolean;
  estimatedSold: number;
  listingDate: string;
  itemUrl: string;
  location: string;
}

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  totalResults: number;
}

interface TrackedProduct {
  id: string;
  legacyItemId: string;
  itemId?: string;
  title: string;
  imageUrl: string;
  currentPrice: number;
  currency: string;
  totalSold: number;
  itemWebUrl?: string;
  notes: string;
  tags: string[];
  lastCheckedAt: string;
  createdAt: string;
  snapshots: { price: number; currency: string; quantity?: number; soldQuantity?: number; timestamp: string }[];
}

interface NicheReport {
  keyword: string;
  demandScore: number;
  competitionScore: number;
  totalListings: number;
  uniqueSellers: number;
  avgPrice: number;
  medianPrice: number;
  priceMin: number;
  priceMax: number;
  freeShippingPct: number;
  sellerConcentration: number;
  topProducts: ProductResult[];
  aspects: { name: string; count: number; percentage: number }[];
  priceDistribution: { range: string; count: number }[];
  savedAt?: string;
  id?: string;
  opportunityScore?: number;
  demandLabel?: string;
  competitionLabel?: string;
  opportunityLabel?: string;
  avgSoldPerItem?: number;
  sellThroughRate?: number;
  listingsPerSeller?: number;
}

interface TrackedSeller {
  id: string;
  sellerUsername: string;
  feedbackScore: number;
  feedbackPct: string;
  lastCheckedAt: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SortDir = 'asc' | 'desc';

function useTableSort<T>(items: T[], defaultKey: string = '', defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a: any, b: any) => {
      let va = a[sortKey] ?? 0;
      let vb = b[sortKey] ?? 0;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}

const CONDITIONS_DATA = [
  { value: '', labelKey: 'conditionAll' },
  { value: 'New', labelKey: 'conditionNew' },
  { value: 'Used', labelKey: 'conditionUsed' },
  { value: 'OpenBox', labelKey: 'conditionOpenBox' },
  { value: 'Refurbished', labelKey: 'conditionRefurbished' },
];

const SORT_DATA = [
  { value: 'BestMatch', labelKey: 'sortBestMatch' },
  { value: 'PricePlusShippingLowest', labelKey: 'sortPriceLow' },
  { value: 'PricePlusShippingHighest', labelKey: 'sortPriceHigh' },
  { value: 'StartTimeNewest', labelKey: 'sortNewest' },
];

const MARKETPLACES_DATA = [
  { value: 'EBAY_US', labelKey: 'marketplaceUS', flag: '🇺🇸' },
  { value: 'EBAY_GB', labelKey: 'marketplaceGB', flag: '🇬🇧' },
  { value: 'EBAY_DE', labelKey: 'marketplaceDE', flag: '🇩🇪' },
  { value: 'EBAY_FR', labelKey: 'marketplaceFR', flag: '🇫🇷' },
  { value: 'EBAY_IT', labelKey: 'marketplaceIT', flag: '🇮🇹' },
  { value: 'EBAY_ES', labelKey: 'marketplaceES', flag: '🇪🇸' },
  { value: 'EBAY_AU', labelKey: 'marketplaceAU', flag: '🇦🇺' },
];

const POPULAR_CATEGORIES_DATA = [
  { id: '11450', nameKey: 'catClothing', emoji: '👗' },
  { id: '58058', nameKey: 'catPhones', emoji: '📱' },
  { id: '11700', nameKey: 'catHome', emoji: '🏠' },
  { id: '220', nameKey: 'catToys', emoji: '🧸' },
  { id: '26395', nameKey: 'catHealth', emoji: '💄' },
  { id: '6000', nameKey: 'catMotors', emoji: '🚗' },
  { id: '64482', nameKey: 'catSports', emoji: '⚽' },
  { id: '293', nameKey: 'catElectronics', emoji: '🔌' },
  { id: '12576', nameKey: 'catBaby', emoji: '👶' },
  { id: '625', nameKey: 'catCamera', emoji: '📷' },
  { id: '175672', nameKey: 'catJewelry', emoji: '💎' },
  { id: '15032', nameKey: 'catPets', emoji: '🐾' },
];

const SCORE_COLOR = (score: number, invert = false) => {
  const s = invert ? 100 - score : score;
  if (s >= 70) return '#10b981';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
};

const SCORE_GLOW = (score: number, invert = false) => {
  const s = invert ? 100 - score : score;
  if (s >= 70) return 'rgba(16,185,129,0.25)';
  if (s >= 40) return 'rgba(245,158,11,0.25)';
  return 'rgba(239,68,68,0.25)';
};

// ---------------------------------------------------------------------------
// Utility Components
// ---------------------------------------------------------------------------

function ExpandedPriceChart({ snapshots, title, onClose }: { snapshots: { price: number; soldQuantity?: number; timestamp: string }[]; title?: string; onClose: () => void }) {
  const t = useTranslations('ebayResearch');
  const { formatDate } = useLocale();
  if (!snapshots || snapshots.length < 2) return null;
  const data = snapshots.slice(-30);
  const prices = data.map(s => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const latest = data[data.length - 1];
  const oldest = data[0];
  const changeVal = oldest.price > 0 ? ((latest.price - oldest.price) / oldest.price) * 100 : 0;
  const svgW = 560;
  const svgH = 200;
  const padX = 40;
  const padY = 20;
  const chartW = svgW - padX * 2;
  const chartH = svgH - padY * 2;
  const points = data.map((s, i) => ({
    x: padX + (i / (data.length - 1)) * chartW,
    y: padY + chartH - ((s.price - min) / range) * chartH,
    ...s,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${svgH - padY} L ${padX} ${svgH - padY} Z`;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 0 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>{t('priceHistory')}</Typography>
          {title && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>}
        </Box>
        <IconButton size="small" onClick={onClose}><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: '#fafbff' }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`${t('latest')}: $${latest.price.toFixed(2)}`} size="small" sx={{ bgcolor: '#6366f1', color: '#fff', fontWeight: 600 }} />
          <Chip label={`Min: $${min.toFixed(2)}`} size="small" variant="outlined" sx={{ borderColor: 'rgba(99,102,241,0.3)' }} />
          <Chip label={`Max: $${max.toFixed(2)}`} size="small" variant="outlined" sx={{ borderColor: 'rgba(99,102,241,0.3)' }} />
          <Chip
            label={`${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(1)}%`}
            size="small"
            sx={{
              bgcolor: changeVal >= 0 ? '#ecfdf5' : '#fef2f2',
              color: changeVal >= 0 ? '#059669' : '#dc2626',
              fontWeight: 600,
              boxShadow: changeVal >= 0 ? '0 0 8px rgba(16,185,129,0.3)' : '0 0 8px rgba(239,68,68,0.3)',
            }}
          />
        </Box>
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', maxHeight: 220 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(pct => {
              const y = padY + chartH * (1 - pct);
              const val = min + range * pct;
              return (
                <g key={pct}>
                  <line x1={padX} y1={y} x2={svgW - padX} y2={y} stroke="#e5e7eb" strokeDasharray="4" />
                  <text x={padX - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">${val.toFixed(0)}</text>
                </g>
              );
            })}
            {/* Area fill */}
            <path d={areaD} fill="url(#priceGrad)" />
            {/* Price line */}
            <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" />
            {/* Data points */}
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={i === points.length - 1 ? 5 : 3} fill={i === points.length - 1 ? '#6366f1' : '#a5b4fc'} stroke="#fff" strokeWidth="1.5" />
                {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
                  <text x={p.x} y={svgH - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
                    {formatDate(p.timestamp, { day: '2-digit', month: '2-digit' })}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </Box>
        {/* Sold quantity trend if available */}
        {data.some(d => d.soldQuantity != null && d.soldQuantity > 0) && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">{t('salesTrend')}:</Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 40, mt: 0.5 }}>
              {data.map((s, i) => {
                const maxSold = Math.max(...data.map(d => d.soldQuantity || 0), 1);
                return (
                  <Tooltip key={i} title={`${s.soldQuantity || 0} sold - ${formatDate(s.timestamp)}`}>
                    <Box sx={{
                      flex: 1, minWidth: 3,
                      height: `${Math.max(((s.soldQuantity || 0) / maxSold) * 100, 3)}%`,
                      bgcolor: '#10b981', borderRadius: '2px 2px 0 0',
                      '&:hover': { bgcolor: '#059669' },
                    }} />
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MiniPriceChart({ snapshots, title, expandable = true }: { snapshots: { price: number; soldQuantity?: number; timestamp: string }[]; title?: string; expandable?: boolean }) {
  const t = useTranslations('ebayResearch');
  const { formatDate } = useLocale();
  const [expanded, setExpanded] = useState(false);
  if (!snapshots || snapshots.length < 2) return <Typography variant="caption" color="text.secondary">{t('noData')}</Typography>;
  const prices = snapshots.map(s => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return (
    <>
      <Box
        sx={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: 30, minWidth: 60, cursor: expandable ? 'pointer' : 'default', '&:hover': expandable ? { opacity: 0.8 } : {} }}
        onClick={() => expandable && setExpanded(true)}
        title={expandable ? t('clickDetailedChart') : undefined}
      >
        {snapshots.slice(-30).map((s, i, arr) => (
          <Tooltip key={i} title={`$${s.price.toFixed(2)} - ${formatDate(s.timestamp)}`}>
            <Box sx={{
              flex: 1, minWidth: 2, maxWidth: 6,
              height: `${Math.max(((s.price - min) / range) * 100, 5)}%`,
              bgcolor: i === arr.length - 1 ? '#6366f1' : '#818cf8',
              borderRadius: '2px 2px 0 0',
              boxShadow: i === arr.length - 1 ? '0 0 6px rgba(99,102,241,0.4)' : 'none',
              '&:hover': { bgcolor: '#4f46e5' },
            }} />
          </Tooltip>
        ))}
      </Box>
      {expanded && <ExpandedPriceChart snapshots={snapshots} title={title} onClose={() => setExpanded(false)} />}
    </>
  );
}

function ScoreDisplay({ label, score, invert = false }: { label: string; score: number; invert?: boolean }) {
  const t = useTranslations('ebayResearch');
  const color = SCORE_COLOR(score, invert);
  const glow = SCORE_GLOW(score, invert);
  const pct = Math.min(score, 100);
  const rad = 40;
  const circ = 2 * Math.PI * rad;
  const dashOff = circ - (pct / 100) * circ;
  return (
    <Box sx={{ textAlign: 'center', p: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600, letterSpacing: '0.02em' }}>
        {label}
      </Typography>
      <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 96, height: 96, boxShadow: `0 0 20px ${glow}`, borderRadius: '50%' }}>
        <svg width="96" height="96" style={{ position: 'absolute', top: 0, left: 0 }}>
          <circle cx="48" cy="48" r={rad} fill="none" stroke="#f0f0f5" strokeWidth="6" />
          <circle cx="48" cy="48" r={rad} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={dashOff}
            transform="rotate(-90 48 48)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 900, fontSize: '1.75rem', color, lineHeight: 1 }}>
            {score}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>/100</Typography>
        </Box>
      </Box>
    </Box>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Paper sx={{ p: 1.5, textAlign: 'center', flex: '1 1 140px', minWidth: 120, background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.1)', borderLeft: '3px solid', borderLeftColor: 'primary.main' }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.5, color: '#6366f1' }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, fontSize: '1.25rem' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function PriceStatsBar({ stats }: { stats: PriceStats | null }) {
  const t = useTranslations('ebayResearch');
  if (!stats) return null;
  return (
    <Paper sx={{ p: 1.5, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #fafbff 0%, #f5f0ff 100%)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
      <Chip icon={<DollarSign size={14} />} label={`Min: $${stats.min.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<BarChart2 size={14} />} label={`${t('avg')}: $${stats.avg.toFixed(2)}`} size="small" color="primary" variant="outlined" />
      <Chip icon={<Target size={14} />} label={`${t('median')}: $${stats.median.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<DollarSign size={14} />} label={`Max: $${stats.max.toFixed(2)}`} size="small" variant="outlined" />
      <Chip icon={<Package size={14} />} label={`${stats.totalResults.toLocaleString()} ${t('results')}`} size="small" color="secondary" />
    </Paper>
  );
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
      <Box sx={{ width: 80, height: 80, borderRadius: '50%', background: 'linear-gradient(135deg, #ede9fe 0%, #e0f2fe 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
        <Package size={40} strokeWidth={1.5} style={{ color: '#6366f1' }} />
      </Box>
      <Typography variant="h6" sx={{ mt: 2, fontWeight: 700 }}>{message}</Typography>
      {sub && <Typography variant="body2" sx={{ mt: 1 }}>{sub}</Typography>}
    </Box>
  );
}

function PriceChangeChip({ change }: { change: number }) {
  if (change === 0) return <Chip label="0%" size="small" variant="outlined" />;
  const up = change > 0;
  return (
    <Chip
      icon={up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      label={`${up ? '+' : ''}${change.toFixed(1)}%`}
      size="small"
      sx={{
        bgcolor: up ? '#ecfdf5' : '#fef2f2',
        color: up ? '#059669' : '#dc2626',
        fontWeight: 600,
        boxShadow: up ? '0 0 8px rgba(16,185,129,0.3)' : '0 0 8px rgba(239,68,68,0.3)',
      }}
    />
  );
}

function SoldBadge({ count }: { count: number }) {
  const t = useTranslations('ebayResearch');
  const color = count > 10 ? '#10b981' : count > 0 ? '#f59e0b' : '#9e9e9e';
  const bg = count > 10 ? '#ecfdf5' : count > 0 ? '#fffbeb' : '#f5f5f5';
  return (
    <Chip
      label={`${count} ${t('sales')}`}
      size="small"
      sx={{ bgcolor: bg, color, fontWeight: 600, fontSize: '0.75rem', boxShadow: count > 0 ? '0 1px 4px rgba(0,0,0,0.06)' : 'none' }}
    />
  );
}

function SimpleHistogram({ data }: { data: { range: string; count: number }[] }) {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map(d => d.count), 1);
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 100, mt: 1 }}>
      {data.map((d, i) => (
        <Tooltip key={i} title={`${d.range}: ${d.count}`}>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{
              width: '100%', maxWidth: 40,
              height: `${Math.max((d.count / maxCount) * 80, 4)}px`,
              background: 'linear-gradient(180deg, #6366f1 0%, #8b5cf6 100%)',
              borderRadius: '4px 4px 0 0',
              transition: 'all 0.2s ease',
              '&:hover': { background: 'linear-gradient(180deg, #4f46e5 0%, #7c3aed 100%)', transform: 'scaleY(1.05)' },
            }} />
            <Typography variant="caption" sx={{ fontSize: '0.6rem', mt: 0.5, writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: 50, overflow: 'hidden', color: '#64748b' }}>
              {d.range}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// API Helper
// ---------------------------------------------------------------------------

function mapEbayItem(item: any): ProductResult {
  return {
    itemId: item.itemId || item.legacyItemId || '',
    legacyItemId: item.legacyItemId,
    title: item.title || '',
    price: typeof item.price === 'number' ? item.price : parseFloat(item.price?.value || '0'),
    currency: item.price?.currency || item.currency || 'USD',
    imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || item.imageUrl || '',
    condition: item.condition || '',
    seller: item.seller?.username || item.seller || '',
    sellerFeedback: item.seller?.feedbackScore || item.sellerFeedback || 0,
    shippingCost: item.shippingOptions?.[0]?.shippingCost?.value ? parseFloat(item.shippingOptions[0].shippingCost.value) : null,
    freeShipping: item.shippingOptions?.[0]?.shippingCost?.value === '0.00' || item.freeShipping || false,
    topRated: item.topRatedBuyingExperience || item.topRated || false,
    estimatedSold: item.estimatedSoldQuantity || item.estimatedSold || 0,
    listingDate: item.itemCreationDate || item.listingDate || '',
    itemUrl: item.itemWebUrl || item.itemUrl || '',
    location: item.itemLocation?.postalCode || item.location || '',
  };
}

function mapNicheProduct(p: any): ProductResult {
  return {
    itemId: p.legacyItemId || p.itemId || '',
    legacyItemId: p.legacyItemId,
    title: p.title || '',
    price: typeof p.price === 'number' ? p.price : parseFloat(p.price?.value || '0'),
    currency: p.currency || 'USD',
    imageUrl: p.imageUrl || p.image?.imageUrl || '',
    condition: p.condition || '',
    seller: typeof p.seller === 'string' ? p.seller : p.seller?.username || '',
    sellerFeedback: p.sellerFeedback || 0,
    shippingCost: null,
    freeShipping: false,
    topRated: false,
    estimatedSold: p.soldQuantity ?? p.estimatedSoldQuantity ?? p.estimatedSold ?? 0,
    listingDate: '',
    itemUrl: p.itemUrl || p.itemWebUrl || (p.legacyItemId ? `https://www.ebay.com/itm/${p.legacyItemId}` : ''),
    location: '',
  };
}

async function apiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({ action, user_id: userId, ...Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
  ) });
  const res = await fetch(`/api/clawd/ebay-research?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function apiPost(action: string, userId: string, body: Record<string, any> = {}) {
  const res = await fetch(`/api/clawd/ebay-research?action=${action}&user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tab Panel Wrapper
// ---------------------------------------------------------------------------

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ---------------------------------------------------------------------------
// TAB 1: Product Database
// ---------------------------------------------------------------------------

function ProductDatabase({ userId, userListings = [], userListingsLoading = false, onNavigate, navigateData, onConsumeNavigateData }: { userId: string; userListings?: any[]; userListingsLoading?: boolean; onNavigate?: (tool: string, data?: any) => void; navigateData?: any; onConsumeNavigateData?: () => void }) {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime, formatNumber } = useLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [filters, setFilters] = useState<SearchFilters>({
    keyword: '',
    categoryId: '',
    priceMin: 0,
    priceMax: 10000,
    condition: '',
    sortBy: 'BestMatch',
    marketplace: 'EBAY_US',
  });
  const [results, setResults] = useState<ProductResult[]>([]);
  const [priceStats, setPriceStats] = useState<PriceStats | null>(null);
  const [topKeywords, setTopKeywords] = useState<{ word: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [trackingIds, setTrackingIds] = useState<Set<string>>(new Set());
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [autoLoadTrigger, setAutoLoadTrigger] = useState(0);
  const productSort = useTableSort<ProductResult>(results, '', 'desc');

  // Consume navigateData to pre-fill keyword and auto-search
  useEffect(() => {
    if (navigateData?.keyword) {
      setFilters(prev => ({ ...prev, keyword: navigateData.keyword }));
      onConsumeNavigateData?.();
    }
  }, [navigateData, onConsumeNavigateData]);

  // Auto-load trending products on mount
  useEffect(() => {
    if (results.length > 0 || navigateData?.keyword) return;
    const trendingKeywords = ['wireless earbuds', 'phone case', 'led lights', 'yoga mat', 'bluetooth speaker', 'watch band'];
    const randomKeyword = trendingKeywords[Math.floor(Math.random() * trendingKeywords.length)];
    setFilters(prev => ({ ...prev, keyword: randomKeyword }));
    setAutoLoaded(true);
    setAutoLoadTrigger(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(async (append = false) => {
    if (!filters.keyword.trim() && !filters.categoryId.trim()) {
      toast.error(t('enterKeywordOrCategory'));
      return;
    }
    setLoading(true);
    setSearched(true);
    const newOffset = append ? offset : 0;
    try {
      const data = await apiCall('product_database', userId, {
        q: filters.keyword,
        category_id: filters.categoryId,
        min_price: filters.priceMin > 0 ? filters.priceMin : '',
        max_price: filters.priceMax < 10000 ? filters.priceMax : '',
        condition: filters.condition,
        sort: filters.sortBy,
        marketplace_id: filters.marketplace,
        offset: newOffset,
        limit: 50,
      });
      const items: ProductResult[] = (data.items || []).map(mapEbayItem);
      if (append) {
        setResults(prev => [...prev, ...items]);
      } else {
        setResults(items);
      }
      setPriceStats(data.priceStats || null);
      if (!append) setTopKeywords(data.topKeywords || []);
      setOffset(newOffset + items.length);
      setHasMore((data.total || 0) > newOffset + items.length);
    } catch (err: any) {
      toast.error(err.message || t('searchFailed'));
    } finally {
      setLoading(false);
    }
  }, [filters, offset, userId]);

  const handleTrack = useCallback(async (product: ProductResult) => {
    try {
      await apiPost('track_product', userId, {
        legacyItemId: product.legacyItemId || product.itemId,
        title: product.title,
      });
      setTrackingIds(prev => new Set(prev).add(product.itemId));
      toast.success(t('productTracked'));
    } catch (err: any) {
      toast.error(err.message || t('trackFailed'));
    }
  }, [userId]);

  const handleSellerSearch = useCallback((seller: string) => {
    setFilters(prev => ({ ...prev, keyword: `seller:${seller}` }));
  }, []);

  const [categoryChipClicked, setCategoryChipClicked] = useState(0);

  // Trigger search when a category chip is clicked
  useEffect(() => {
    if (categoryChipClicked > 0) {
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryChipClicked]);

  // Trigger auto-load search after keyword is set
  useEffect(() => {
    if (autoLoadTrigger > 0) {
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadTrigger]);

  const userCategories = useMemo(() => {
    const cats = new Map<string, { id: string; name: string; count: number }>();
    for (const l of userListings || []) {
      const id = l.categoryId;
      const name = l.categoryPath?.split('|').pop()?.trim() || l.categoryId || '';
      if (id && name) {
        const existing = cats.get(id);
        if (existing) existing.count++;
        else cats.set(id, { id, name, count: 1 });
      }
    }
    return Array.from(cats.values()).sort((a, b) => b.count - a.count);
  }, [userListings]);

  const updateFilter = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Box>
      {/* Search Form */}
      <Paper sx={{
        p: 2, mb: 2,
        background: '#fff',
        boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
        borderRadius: 3,
        border: '1px solid rgba(99,102,241,0.08)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: isMobile ? 1 : 0 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#1e1b4b' }}>
            <Search size={18} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
            {t('productSearch')}
          </Typography>
          {isMobile && (
            <Button size="small" startIcon={<Filter size={14} />} onClick={() => setShowFilters(!showFilters)}>
              {t('filters')}
            </Button>
          )}
        </Box>

        {/* User category quick-filter chips */}
        {userCategories.length > 0 && (
          <Box sx={{ mb: 2, mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('yourCategories')}:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {userCategories.slice(0, 8).map(cat => (
                <Chip
                  key={cat.id}
                  label={`${cat.name} (${cat.count})`}
                  size="small"
                  variant={filters.categoryId === cat.id ? 'filled' : 'outlined'}
                  onClick={() => {
                    setFilters(prev => ({ ...prev, categoryId: cat.id }));
                    setCategoryChipClicked(c => c + 1);
                  }}
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    ...(filters.categoryId === cat.id ? {
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                      color: '#fff',
                      boxShadow: '0 2px 6px rgba(99,102,241,0.2)',
                      '&:hover': { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' },
                    } : {
                      borderColor: 'rgba(99,102,241,0.2)',
                      '&:hover': { borderColor: '#6366f1', bgcolor: 'rgba(99,102,241,0.04)' },
                    }),
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Keyword + Category row - always visible */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label={t('keyword')}
            placeholder="e.g.: wireless earbuds, bluetooth speaker, yoga mat"
            helperText={t('keywordHelperText')}
            value={filters.keyword}
            onChange={e => updateFilter('keyword', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setAutoLoaded(false); handleSearch(); } }}
            sx={{ flex: '2 1 250px' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            }}
          />
          <TextField
            size="small"
            label={t('categoryId')}
            value={filters.categoryId}
            onChange={e => updateFilter('categoryId', e.target.value)}
            sx={{ flex: '1 1 120px', maxWidth: 160 }}
          />
          <Button variant="contained" onClick={() => { setAutoLoaded(false); handleSearch(); }} disabled={loading} sx={{
            minWidth: 100,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            borderRadius: 2,
            transition: 'all 0.2s ease',
            '&:hover': { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' },
          }}>
            {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : t('searchBtn')}
          </Button>
          <Chip
            icon={<Lightbulb size={14} />}
            label={t('tips')}
            size="small"
            variant={showTips ? 'filled' : 'outlined'}
            onClick={() => setShowTips(v => !v)}
            sx={{
              cursor: 'pointer', alignSelf: 'center',
              ...(showTips ? {
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: '#fff',
              } : {
                borderColor: 'rgba(99,102,241,0.3)',
                color: '#6366f1',
              }),
            }}
          />
        </Box>

        {/* Tips */}
        <Collapse in={showTips}>
          <Paper sx={{ p: 2, mt: 1.5, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('tips')}</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>{t('tip1')}</li>
                <li>{t('tip2')}</li>
                <li>{t('tip3')}</li>
                <li>{t('tip4')}</li>
              </ul>
            </Typography>
          </Paper>
        </Collapse>

        {/* Extended Filters */}
        <Collapse in={showFilters || !isMobile}>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Marketplace */}
            <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 130 } }}>
              <InputLabel>{t('marketplace')}</InputLabel>
              <Select value={filters.marketplace} label={t('marketplace')} onChange={e => updateFilter('marketplace', e.target.value)}>
                {MARKETPLACES_DATA.map(m => (
                  <MenuItem key={m.value} value={m.value}>{m.flag} {t(m.labelKey)}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Condition */}
            <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 120 } }}>
              <InputLabel>{t('condition')}</InputLabel>
              <Select value={filters.condition} label={t('condition')} onChange={e => updateFilter('condition', e.target.value)}>
                {CONDITIONS_DATA.map(c => (
                  <MenuItem key={c.value} value={c.value}>{t(c.labelKey)}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Sort */}
            <FormControl size="small" sx={{ minWidth: { xs: '48%', sm: 170 } }}>
              <InputLabel>{t('sorting')}</InputLabel>
              <Select value={filters.sortBy} label={t('sorting')} onChange={e => updateFilter('sortBy', e.target.value)}>
                {SORT_DATA.map(s => (
                  <MenuItem key={s.value} value={s.value}>{t(s.labelKey)}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Price Range */}
            <TextField
              size="small"
              label={t('minPrice')}
              type="number"
              value={filters.priceMin || ''}
              onChange={e => updateFilter('priceMin', Number(e.target.value))}
              sx={{ width: { xs: '45%', sm: 100 } }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField
              size="small"
              label={t('maxPrice')}
              type="number"
              value={filters.priceMax >= 10000 ? '' : filters.priceMax}
              onChange={e => updateFilter('priceMax', Number(e.target.value) || 10000)}
              sx={{ width: { xs: '45%', sm: 100 } }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
          </Box>
        </Collapse>
      </Paper>

      {/* Auto-loaded trending banner */}
      {autoLoaded && results.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingUp size={16} color="#6366f1" />
          <Typography variant="body2" color="text.secondary">
            {t('trendingShown')}
          </Typography>
        </Paper>
      )}

      {/* Price Stats */}
      <PriceStatsBar stats={priceStats} />

      {/* Top Keywords */}
      {topKeywords.length > 0 && (
        <Paper sx={{
          p: 1.5, mb: 2, overflow: 'hidden',
          background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)',
          border: '1px solid rgba(99,102,241,0.1)',
          borderRadius: 3,
          boxShadow: '0 1px 8px rgba(99,102,241,0.06)',
        }}>
          <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block', color: '#6366f1' }}>
            {t('trendingKeywords')}:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {topKeywords.slice(0, 15).map((kw, i) => (
              <Chip
                key={i}
                label={`${kw.word} (${kw.count})`}
                size="small"
                clickable
                onClick={() => {
                  setFilters(prev => ({ ...prev, keyword: kw.word }));
                }}
                sx={{
                  fontSize: '0.7rem', height: 24,
                  fontWeight: i < 5 ? 700 : 400,
                  transition: 'all 0.2s ease',
                  ...(i < 3 ? {
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff',
                    boxShadow: '0 2px 6px rgba(99,102,241,0.2)',
                  } : {
                    bgcolor: '#fff',
                    color: '#64748b',
                    border: '1px solid rgba(99,102,241,0.15)',
                  }),
                  '&:hover': { boxShadow: '0 2px 8px rgba(99,102,241,0.25)', transform: 'translateY(-1px)' },
                }}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Loading */}
      {loading && <LinearProgress sx={{ mb: 1, borderRadius: 2, '& .MuiLinearProgress-bar': { background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' } }} />}

      {/* Results */}
      {!searched && userListings.length > 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center', background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
          <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
            {t('startSearchOrSelectCategory')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {userListings.length} {t('activeListingsHint')}
          </Typography>
        </Paper>
      ) : !searched ? (
        <EmptyState message={t('startSearch')} sub={t('searchHint')} />
      ) : results.length === 0 && !loading ? (
        <EmptyState message={t('noResults')} sub={t('changeFiltersHint')} />
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {results.map(product => (
            <MobileProductCard key={product.itemId} product={product} onTrack={handleTrack} onSellerSearch={handleSellerSearch} tracked={trackingIds.has(product.itemId)} onNavigate={onNavigate} />
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                <TableCell sx={{ width: 60, fontWeight: 700, color: '#1e1b4b' }}>{t('image')}</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('title')}</TableCell>
                <TableCell align="right" sortDirection={productSort.sortKey === 'price' ? productSort.sortDir : false}>
                  <TableSortLabel active={productSort.sortKey === 'price'} direction={productSort.sortKey === 'price' ? productSort.sortDir : 'desc'} onClick={() => productSort.handleSort('price')}>
                    {t('price')}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center" sortDirection={productSort.sortKey === 'estimatedSold' ? productSort.sortDir : false}>
                  <TableSortLabel active={productSort.sortKey === 'estimatedSold'} direction={productSort.sortKey === 'estimatedSold' ? productSort.sortDir : 'desc'} onClick={() => productSort.handleSort('estimatedSold')}>
                    {t('sales')}
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('condition')}</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('seller')}</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('shipping')}</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('action')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {productSort.sorted.map(product => (
                <TableRow key={product.itemId} hover sx={{ transition: 'all 0.15s ease', '&:hover': { bgcolor: '#f8faff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' } }}>
                  <TableCell>
                    <Box
                      component="img"
                      src={product.imageUrl || '/placeholder-product.png'}
                      alt=""
                      sx={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 2, bgcolor: '#f5f5f5', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                      onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography
                      variant="body2"
                      component="a"
                      href={product.itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: '#6366f1', textDecoration: 'none', fontWeight: 500,
                        '&:hover': { textDecoration: 'underline', color: '#4f46e5' },
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}
                    >
                      {product.title}
                    </Typography>
                    {product.topRated && (
                      <Chip icon={<Star size={12} />} label={t('topRated')} size="small" color="warning" sx={{ mt: 0.5, height: 20, fontSize: '0.65rem' }} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#6366f1' }}>${product.price.toFixed(2)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <SoldBadge count={product.estimatedSold} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{product.condition}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="caption"
                      sx={{ cursor: 'pointer', color: '#6366f1', '&:hover': { textDecoration: 'underline', color: '#4f46e5' } }}
                      onClick={() => handleSellerSearch(product.seller)}
                    >
                      {product.seller}
                    </Typography>
                    {product.sellerFeedback > 0 && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        ({product.sellerFeedback.toLocaleString()})
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {product.freeShipping ? (
                      <Chip label={t('free')} size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                    ) : product.shippingCost != null ? (
                      <Typography variant="caption">${product.shippingCost.toFixed(2)}</Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">-</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'center' }}>
                      <Tooltip title={trackingIds.has(product.itemId) ? t('tracking') : t('trackProduct')}>
                        <IconButton
                          size="small"
                          color={trackingIds.has(product.itemId) ? 'primary' : 'default'}
                          onClick={() => handleTrack(product)}
                          disabled={trackingIds.has(product.itemId)}
                          sx={{ borderRadius: 2, transition: 'all 0.2s ease', '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' } }}
                        >
                          <Bookmark size={16} fill={trackingIds.has(product.itemId) ? 'currentColor' : 'none'} />
                        </IconButton>
                      </Tooltip>
                      {onNavigate && (
                        <Tooltip title={t('nicheAnalysis')}>
                          <IconButton size="small" sx={{ borderRadius: 2, transition: 'all 0.2s ease', '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' } }} onClick={() => onNavigate('niche_finder', { keyword: product.title.split(' ').slice(0, 4).join(' ') })}>
                            <Gauge size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onNavigate && (
                        <Tooltip title={t('seoCheck')}>
                          <IconButton size="small" sx={{ borderRadius: 2, transition: 'all 0.2s ease', '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' } }} onClick={() => onNavigate('seo_analyzer', { keyword: product.title.split(' ').slice(0, 4).join(' '), title: product.title })}>
                            <Target size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={t('openOnEbay')}>
                        <IconButton size="small" component="a" href={product.itemUrl} target="_blank" rel="noopener noreferrer" sx={{ borderRadius: 2, transition: 'all 0.2s ease', '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' } }}>
                          <ExternalLink size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Load More */}
      {hasMore && results.length > 0 && !loading && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button variant="outlined" onClick={() => handleSearch(true)} startIcon={<ChevronDown size={16} />} sx={{
            borderColor: '#6366f1', color: '#6366f1', borderRadius: 2,
            transition: 'all 0.2s ease',
            '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)', boxShadow: '0 2px 8px rgba(99,102,241,0.15)' },
          }}>
            {t('loadMore')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

// Mobile product card for search results
function MobileProductCard({ product, onTrack, onSellerSearch, tracked, onNavigate }: {
  product: ProductResult; onTrack: (p: ProductResult) => void;
  onSellerSearch: (s: string) => void; tracked: boolean;
  onNavigate?: (tool: string, data?: any) => void;
}) {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime } = useLocale();
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper sx={{ overflow: 'hidden', background: '#fff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', transition: 'all 0.2s ease', '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.08)' } }}>
      <Box sx={{ display: 'flex', gap: 1.5, p: 1.5, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <Box
          component="img"
          src={product.imageUrl || '/placeholder-product.png'}
          alt=""
          sx={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} sx={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {product.title}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#6366f1' }}>${product.price.toFixed(2)}</Typography>
            <SoldBadge count={product.estimatedSold} />
            {product.topRated && <Star size={14} color="#ed6c02" fill="#ed6c02" />}
          </Box>
        </Box>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </Box>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{t('condition')}:</Typography>
            <Typography variant="caption">{product.condition}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{t('seller')}:</Typography>
            <Typography
              variant="caption"
              sx={{ cursor: 'pointer', color: '#6366f1', '&:hover': { textDecoration: 'underline', color: '#4f46e5' } }}
              onClick={(e) => { e.stopPropagation(); onSellerSearch(product.seller); }}
            >
              {product.seller} ({product.sellerFeedback.toLocaleString()})
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{t('shipping')}:</Typography>
            <Typography variant="caption">
              {product.freeShipping ? t('free') : product.shippingCost != null ? `$${product.shippingCost.toFixed(2)}` : '-'}
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small" variant="outlined" sx={{ flex: '1 1 45%', borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}
              startIcon={<Bookmark size={14} fill={tracked ? 'currentColor' : 'none'} />}
              onClick={() => onTrack(product)}
              disabled={tracked}
            >
              {tracked ? t('tracking') : t('trackProduct')}
            </Button>
            {onNavigate && (
              <Button
                size="small" variant="outlined" sx={{ flex: '1 1 45%', borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}
                startIcon={<Gauge size={14} />}
                onClick={() => onNavigate('niche_finder', { keyword: product.title.split(' ').slice(0, 4).join(' ') })}
              >
                {t('nicheAnalysis')}
              </Button>
            )}
            {onNavigate && (
              <Button
                size="small" variant="outlined" sx={{ flex: '1 1 45%', borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}
                startIcon={<Target size={14} />}
                onClick={() => onNavigate('seo_analyzer', { keyword: product.title.split(' ').slice(0, 4).join(' '), title: product.title })}
              >
                SEO
              </Button>
            )}
            <Button
              size="small" variant="outlined" sx={{ flex: '1 1 45%', borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}
              startIcon={<ExternalLink size={14} />}
              component="a" href={product.itemUrl} target="_blank" rel="noopener noreferrer"
            >
              eBay
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// TAB 2: Product Tracker
// ---------------------------------------------------------------------------

function ProductTracker({ userId, userListings, onNavigate }: { userId: string; userListings?: any[]; onNavigate?: (tool: string, data?: any) => void }) {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime } = useLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [tagDialog, setTagDialog] = useState<{ id: string; tags: string[] } | null>(null);
  const [newTag, setNewTag] = useState('');
  const trackedSort = useTableSort<TrackedProduct>(tracked, 'currentPrice', 'desc');

  const lastUpdateTime = useMemo(() => {
    if (tracked.length === 0) return null;
    const dates = tracked.map(p => p.lastCheckedAt).filter(Boolean).map(d => new Date(d).getTime());
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [tracked]);

  const handleExportCsv = useCallback(() => {
    if (tracked.length === 0) return;
    const headers = ['title', 'currentPrice', 'previousPrice', 'priceChange%', 'legacyItemId', 'notes', 'tags', 'lastUpdated'];
    const rows = tracked.map(p => {
      const prevPrice = p.snapshots?.length > 1 ? p.snapshots[p.snapshots.length - 1].price : p.currentPrice;
      const change = prevPrice > 0 ? (((p.currentPrice - prevPrice) / prevPrice) * 100).toFixed(2) : '0';
      return [
        `"${(p.title || '').replace(/"/g, '""')}"`,
        p.currentPrice?.toFixed(2) ?? '',
        prevPrice?.toFixed(2) ?? '',
        change,
        p.legacyItemId || '',
        `"${(p.notes || '').replace(/"/g, '""')}"`,
        `"${(p.tags || []).join(', ')}"`,
        p.lastCheckedAt || '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracked-products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('csvDownloaded'));
  }, [tracked]);

  const fetchTracked = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('tracked_products', userId);
      setTracked(data.products || []);
    } catch (err: any) {
      toast.error(err.message || t('trackedProductsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchTracked(); }, [fetchTracked]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await apiPost('refresh_tracked', userId);
      toast.success(t('allProductsUpdated'));
      await fetchTracked();
    } catch (err: any) {
      toast.error(err.message || t('updateFailed'));
    } finally {
      setRefreshing(false);
    }
  }, [userId, fetchTracked]);

  const handleAddByUrl = useCallback(async () => {
    if (!addItemId.trim()) return;
    setAddLoading(true);
    try {
      // Extract item ID from URL or use as-is
      let itemId = addItemId.trim();
      const urlMatch = itemId.match(/\/itm\/(\d+)/);
      if (urlMatch) itemId = urlMatch[1];
      const idMatch = itemId.match(/(\d{10,14})/);
      if (idMatch) itemId = idMatch[1];

      await apiPost('track_product', userId, { legacyItemId: itemId });
      toast.success(t('productTracked'));
      setAddDialogOpen(false);
      setAddItemId('');
      await fetchTracked();
    } catch (err: any) {
      toast.error(err.message || t('productAddFailed'));
    } finally {
      setAddLoading(false);
    }
  }, [addItemId, userId, fetchTracked]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await apiPost('untrack_product', userId, { id });
      setTracked(prev => prev.filter(p => p.id !== id));
      toast.success(t('productUntracked'));
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    }
  }, [userId]);

  const handleSaveNotes = useCallback(async (id: string) => {
    try {
      await apiPost('update_product', userId, { id, notes: notesText });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, notes: notesText } : p));
      setEditingNotes(null);
      toast.success(t('noteSaved'));
    } catch (err: any) {
      toast.error(err.message || t('noteSaveFailed'));
    }
  }, [userId, notesText]);

  const handleAddTag = useCallback(async (id: string) => {
    if (!newTag.trim() || !tagDialog) return;
    const updated = [...tagDialog.tags, newTag.trim()];
    try {
      await apiPost('update_product', userId, { id, tags: updated });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, tags: updated } : p));
      setTagDialog({ id, tags: updated });
      setNewTag('');
    } catch (err: any) {
      toast.error(err.message || t('tagAddFailed'));
    }
  }, [userId, newTag, tagDialog]);

  const handleRemoveTag = useCallback(async (id: string, tag: string) => {
    if (!tagDialog) return;
    const updated = tagDialog.tags.filter(t => t !== tag);
    try {
      await apiPost('update_product', userId, { id, tags: updated });
      setTracked(prev => prev.map(p => p.id === id ? { ...p, tags: updated } : p));
      setTagDialog({ id, tags: updated });
    } catch (err: any) {
      toast.error(err.message || t('tagDeleteFailed'));
    }
  }, [userId, tagDialog]);

  if (loading) {
    return (
      <Box sx={{ py: 4 }}>
        {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" height={100} sx={{ mb: 1, borderRadius: 1 }} />)}
      </Box>
    );
  }

  return (
    <Box>
      {/* Actions Bar */}
      <Box sx={{
        display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center',
        p: 2, borderRadius: 3,
        background: 'linear-gradient(135deg, #fafbff 0%, #f0f1ff 100%)',
        border: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
      }}>
        <Button
          variant="contained"
          startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshCw size={16} />}
          onClick={handleRefreshAll}
          disabled={refreshing || tracked.length === 0}
          sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
        >
          {t('refreshTrackedProducts')}
        </Button>
        <Button variant="outlined" startIcon={<Plus size={16} />} onClick={() => setAddDialogOpen(true)}
          sx={{ borderColor: '#6366f1', color: '#6366f1', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' }, borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
        >
          {t('addByUrlId')}
        </Button>
        <Tooltip title={t('downloadCSV')}>
          <span>
            <IconButton size="small" onClick={handleExportCsv} disabled={tracked.length === 0} sx={{ color: '#6366f1' }}>
              <Download size={18} />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastUpdateTime && (
            <Chip
              icon={<Clock size={12} />}
              label={`${t('lastUpdate')}: ${formatDateTime(lastUpdateTime, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
              size="small"
              variant="outlined"
              sx={{ height: 24, fontSize: '0.7rem', borderColor: 'rgba(99,102,241,0.2)', color: '#6366f1' }}
            />
          )}
          <Typography variant="caption" sx={{ color: '#6366f1', fontWeight: 600 }}>
            {tracked.length} {t('productsTracked')}
          </Typography>
        </Box>
      </Box>

      {/* Product List */}
      {tracked.length === 0 ? (
        <Box>
          <EmptyState
            message={t('noTrackedProducts')}
            sub={t('noTrackedProductsSub')}
          />
          <Paper sx={{ p: 2, mt: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>{t('howToTrackProducts')}</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>{t('trackStep1')}</li>
                <li>{t('trackStep2')}</li>
                <li>{t('trackStep3')}</li>
                <li>{t('trackStep4')}</li>
              </ul>
            </Typography>
          </Paper>
        </Box>
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {tracked.map(product => (
            <TrackedProductMobileCard
              key={product.id}
              product={product}
              onRemove={handleRemove}
              onEditNotes={(id, notes) => { setEditingNotes(id); setNotesText(notes); }}
              onOpenTags={(id, tags) => setTagDialog({ id, tags })}
              onNavigate={onNavigate}
            />
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: 'linear-gradient(135deg, #f8f9ff 0%, #eef0ff 100%)' }}>
                <TableCell sx={{ width: 60, fontWeight: 600, color: '#4338ca' }}>{t('image')}</TableCell>
                <TableCell sx={{ fontWeight: 600, color: '#4338ca' }}>{t('title')}</TableCell>
                <TableCell align="right" sortDirection={trackedSort.sortKey === 'currentPrice' ? trackedSort.sortDir : false}>
                  <TableSortLabel active={trackedSort.sortKey === 'currentPrice'} direction={trackedSort.sortKey === 'currentPrice' ? trackedSort.sortDir : 'desc'} onClick={() => trackedSort.handleSort('currentPrice')}>
                    {t('price')}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">{t('change')}</TableCell>
                <TableCell align="center" sortDirection={trackedSort.sortKey === 'totalSold' ? trackedSort.sortDir : false}>
                  <TableSortLabel active={trackedSort.sortKey === 'totalSold'} direction={trackedSort.sortKey === 'totalSold' ? trackedSort.sortDir : 'desc'} onClick={() => trackedSort.handleSort('totalSold')}>
                    {t('sales')}
                  </TableSortLabel>
                </TableCell>
                <TableCell>{t('priceHistory')}</TableCell>
                <TableCell>{t('notes')}</TableCell>
                <TableCell>{t('tags')}</TableCell>
                <TableCell align="center">{t('lastChecked')}</TableCell>
                <TableCell align="center">{t('deleteLabel')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {trackedSort.sorted.map(product => (
                <TableRow key={product.id} hover sx={{ '&:hover': { bgcolor: 'rgba(99,102,241,0.03)' } }}>
                  <TableCell>
                    <Box
                      component="img"
                      src={product.imageUrl || '/placeholder-product.png'}
                      alt=""
                      sx={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 2 }}
                      onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 250 }}>
                    <Typography variant="body2" fontWeight={500} sx={{
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {product.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      ID: {product.legacyItemId}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700} sx={{ color: '#6366f1' }}>${(product.currentPrice || 0).toFixed(2)}</Typography>
                    {product.snapshots?.length > 1 && (() => {
                      const oldest = product.snapshots[product.snapshots.length - 1];
                      return oldest.price !== product.currentPrice ? (
                        <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                          ${oldest.price.toFixed(2)}
                        </Typography>
                      ) : null;
                    })()}
                  </TableCell>
                  <TableCell align="center">
                    {product.snapshots?.length > 1 ? (() => {
                      const oldest = product.snapshots[product.snapshots.length - 1];
                      const change = oldest.price > 0 ? ((product.currentPrice - oldest.price) / oldest.price) * 100 : 0;
                      return <PriceChangeChip change={change} />;
                    })() : <Typography variant="caption" color="text.secondary">-</Typography>}
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2">{product.totalSold ?? 0}</Typography>
                  </TableCell>
                  <TableCell>
                    <MiniPriceChart snapshots={product.snapshots} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 150 }}>
                    {editingNotes === product.id ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          value={notesText}
                          onChange={e => setNotesText(e.target.value)}
                          multiline
                          maxRows={3}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="small" color="primary" onClick={() => handleSaveNotes(product.id)}>
                          <Save size={14} />
                        </IconButton>
                        <IconButton size="small" onClick={() => setEditingNotes(null)}>
                          <X size={14} />
                        </IconButton>
                      </Box>
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                        onClick={() => { setEditingNotes(product.id); setNotesText(product.notes || ''); }}
                      >
                        {product.notes || 'Not ekle...'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(product.tags || []).slice(0, 3).map(tag => (
                        <Chip key={tag} label={tag} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                      ))}
                      <IconButton size="small" onClick={() => setTagDialog({ id: product.id, tags: product.tags || [] })}>
                        <Tag size={12} />
                      </IconButton>
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="caption" color="text.secondary">
                      {product.lastCheckedAt ? formatDateTime(product.lastCheckedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {onNavigate && (
                        <>
                          <Tooltip title={t('seoAnalysis')}>
                            <IconButton size="small" onClick={() => onNavigate('seo_analyzer', { keyword: product.title })}>
                              <Target size={16} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('aiAssistant')}>
                            <IconButton size="small" onClick={() => onNavigate('ai_hub', { title: product.title })}>
                              <Sparkles size={16} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      {product.itemWebUrl || product.legacyItemId ? (
                        <IconButton size="small" component="a" href={product.itemWebUrl || `https://www.ebay.com/itm/${product.legacyItemId}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={16} />
                        </IconButton>
                      ) : null}
                      <IconButton size="small" color="error" onClick={() => handleRemove(product.id)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add by URL/ID Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('addProductByUrl')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('enterProductUrlOrId')}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label={t('ebayUrlOrItemId')}
            value={addItemId}
            onChange={e => setAddItemId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddByUrl()}
            placeholder={t('ebayUrlPlaceholder')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)}>{t('addDialogCancel')}</Button>
          <Button variant="contained" onClick={handleAddByUrl} disabled={addLoading || !addItemId.trim()}>
            {addLoading ? <CircularProgress size={18} /> : t('addDialogAdd')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tags Dialog */}
      <Dialog open={!!tagDialog} onClose={() => setTagDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('editTags')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2, mt: 1 }}>
            {tagDialog?.tags.map(tag => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                onDelete={() => tagDialog && handleRemoveTag(tagDialog.id, tag)}
                color="primary"
                variant="outlined"
              />
            ))}
            {(!tagDialog?.tags || tagDialog.tags.length === 0) && (
              <Typography variant="caption" color="text.secondary">{t('noTagsYet')}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              label="Yeni Etiket"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && tagDialog && handleAddTag(tagDialog.id)}
            />
            <Button variant="outlined" onClick={() => tagDialog && handleAddTag(tagDialog.id)} disabled={!newTag.trim()}>
              Ekle
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialog(null)}>Kapat</Button>
        </DialogActions>
      </Dialog>

      {/* Notes inline edit dialog for mobile */}
      {isMobile && editingNotes && (
        <Dialog open={!!editingNotes} onClose={() => setEditingNotes(null)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('editNote')}</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              multiline
              rows={4}
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditingNotes(null)}>Iptal</Button>
            <Button variant="contained" onClick={() => editingNotes && handleSaveNotes(editingNotes)}>Kaydet</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

function TrackedProductMobileCard({ product, onRemove, onEditNotes, onOpenTags, onNavigate }: {
  product: TrackedProduct;
  onRemove: (id: string) => void;
  onEditNotes: (id: string, notes: string) => void;
  onOpenTags: (id: string, tags: string[]) => void;
  onNavigate?: (tool: string, data?: any) => void;
}) {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime } = useLocale();
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper sx={{ overflow: 'hidden', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
      <Box sx={{ display: 'flex', gap: 1.5, p: 1.5, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <Box
          component="img"
          src={product.imageUrl || '/placeholder-product.png'}
          alt=""
          sx={{ width: 55, height: 55, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }}
          onError={(e: any) => { e.target.src = '/placeholder-product.png'; }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} noWrap>{product.title}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#6366f1' }}>${(product.currentPrice || 0).toFixed(2)}</Typography>
            {product.snapshots?.length > 1 ? (() => {
              const oldest = product.snapshots[product.snapshots.length - 1];
              const change = oldest.price > 0 ? ((product.currentPrice - oldest.price) / oldest.price) * 100 : 0;
              return <PriceChangeChip change={change} />;
            })() : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
            {(product.tags || []).slice(0, 2).map(tag => (
              <Chip key={tag} label={tag} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
            ))}
          </Box>
        </Box>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </Box>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {product.snapshots?.length > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">{t('firstPrice')}:</Typography>
              <Typography variant="caption">${product.snapshots[product.snapshots.length - 1].price.toFixed(2)}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{t('sales')}:</Typography>
            <Typography variant="caption">{product.totalSold ?? 0}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Son Kontrol:</Typography>
            <Typography variant="caption">
              {product.lastCheckedAt ? formatDateTime(product.lastCheckedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
            </Typography>
          </Box>
          {(product.itemWebUrl || product.legacyItemId) && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="small" variant="text" component="a" href={product.itemWebUrl || `https://www.ebay.com/itm/${product.legacyItemId}`} target="_blank" rel="noopener noreferrer" startIcon={<ExternalLink size={12} />}>
                {t('viewOnEbay')}
              </Button>
            </Box>
          )}
          {/* Price Chart */}
          <Box>
            <Typography variant="caption" color="text.secondary">{t('priceHistory')}:</Typography>
            <MiniPriceChart snapshots={product.snapshots} />
          </Box>
          {/* Notes */}
          {product.notes && (
            <Box>
              <Typography variant="caption" color="text.secondary">Not:</Typography>
              <Typography variant="caption" display="block">{product.notes}</Typography>
            </Box>
          )}
          <Divider />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => onEditNotes(product.id, product.notes || '')} startIcon={<Edit3 size={12} />}>
              Not
            </Button>
            <Button size="small" variant="outlined" onClick={() => onOpenTags(product.id, product.tags || [])} startIcon={<Tag size={12} />}>
              Etiket
            </Button>
            {onNavigate && (
              <>
                <Button size="small" variant="outlined" onClick={() => onNavigate('seo_analyzer', { keyword: product.title })} startIcon={<Target size={12} />}>
                  SEO
                </Button>
                <Button size="small" variant="outlined" onClick={() => onNavigate('ai_hub', { title: product.title })} startIcon={<Sparkles size={12} />}>
                  AI
                </Button>
              </>
            )}
            <Button size="small" variant="outlined" color="error" onClick={() => onRemove(product.id)} startIcon={<Trash2 size={12} />} sx={{ ml: 'auto' }}>
              Sil
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// TAB 3: Niche Finder
// ---------------------------------------------------------------------------

function NicheFinder({ userId, userListings, onNavigate, navigateData, onConsumeNavigateData }: { userId: string; userListings?: any[]; onNavigate?: (tool: string, data?: any) => void; navigateData?: any; onConsumeNavigateData?: () => void }) {
  const t = useTranslations('ebayResearch');
  const { formatDate } = useLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [keyword, setKeyword] = useState('');
  const [marketplace, setMarketplace] = useState('EBAY_US');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<NicheReport | null>(null);
  const [savedNiches, setSavedNiches] = useState<NicheReport[]>([]);
  const [loadingNiches, setLoadingNiches] = useState(true);
  const [savingNiche, setSavingNiche] = useState(false);
  const [categoryAnalyzing, setCategoryAnalyzing] = useState<string | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [autoLoadTrigger, setAutoLoadTrigger] = useState(0);
  const nicheProductSort = useTableSort<ProductResult>(report?.topProducts || [], 'estimatedSold', 'desc');

  // Consume navigateData to pre-fill keyword
  useEffect(() => {
    if (navigateData?.keyword) {
      setKeyword(navigateData.keyword);
      onConsumeNavigateData?.();
    }
  }, [navigateData, onConsumeNavigateData]);

  // Auto-load a trending niche on mount
  useEffect(() => {
    if (report || navigateData?.keyword) return;
    const trendingKeywords = ['wireless earbuds', 'phone case iphone', 'led strip lights', 'yoga accessories', 'car accessories'];
    const randomKeyword = trendingKeywords[Math.floor(Math.random() * trendingKeywords.length)];
    setKeyword(randomKeyword);
    setAutoLoaded(true);
    setAutoLoadTrigger(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSavedNiches = useCallback(async () => {
    setLoadingNiches(true);
    try {
      const data = await apiCall('saved_niches', userId);
      setSavedNiches(data.niches || []);
    } catch {
      // silent
    } finally {
      setLoadingNiches(false);
    }
  }, [userId]);

  useEffect(() => { fetchSavedNiches(); }, [fetchSavedNiches]);

  const handleAnalyze = useCallback(async () => {
    if (!keyword.trim()) {
      toast.error(t('enterKeyword'));
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      const data = await apiCall('niche_analyze', userId, { q: keyword, marketplace_id: marketplace });
      const mapped: NicheReport = {
        keyword: data.query || keyword,
        demandScore: data.demandScore || 0,
        competitionScore: data.competitionScore || 0,
        totalListings: data.totalResults || 0,
        uniqueSellers: data.uniqueSellers || 0,
        avgPrice: data.avgPrice || 0,
        medianPrice: data.medianPrice || 0,
        priceMin: data.priceSpread?.min || 0,
        priceMax: data.priceSpread?.max || 0,
        freeShippingPct: data.freeShippingPct || 0,
        sellerConcentration: data.sellerConcentration || 0,
        topProducts: (data.topProducts || []).filter(Boolean).map(mapNicheProduct),
        aspects: Object.entries(data.aspectDistributions || {}).map(([name, values]: [string, any]) => {
          const total = Object.values(values as Record<string, number>).reduce((s: number, c: number) => s + c, 0);
          return { name, count: total, percentage: data.totalResults ? Math.round((total / data.totalResults) * 100) : 0 };
        }),
        priceDistribution: data.priceDistribution || [],
        opportunityScore: data.opportunityScore || 0,
        demandLabel: data.demandLabel || '',
        competitionLabel: data.competitionLabel || '',
        opportunityLabel: data.opportunityLabel || '',
        avgSoldPerItem: data.avgSoldPerItem,
        sellThroughRate: data.sellThroughRate,
        listingsPerSeller: data.listingsPerSeller,
      };
      setReport(mapped);
    } catch (err: any) {
      toast.error(err.message || t('analysisFailed'));
    } finally {
      setLoading(false);
    }
  }, [keyword, marketplace, userId]);

  // Trigger auto-load analysis after keyword is set
  useEffect(() => {
    if (autoLoadTrigger > 0) {
      handleAnalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadTrigger]);

  const handleCategoryAnalyze = useCallback(async (categoryId: string, categoryName: string) => {
    setCategoryAnalyzing(categoryId);
    setLoading(true);
    setReport(null);
    setKeyword(categoryName);
    try {
      const data = await apiCall('niche_analyze', userId, { category_id: categoryId, marketplace_id: marketplace });
      const mapped: NicheReport = {
        keyword: categoryName,
        demandScore: data.demandScore || 0,
        competitionScore: data.competitionScore || 0,
        totalListings: data.totalResults || 0,
        uniqueSellers: data.uniqueSellers || 0,
        avgPrice: data.avgPrice || 0,
        medianPrice: data.medianPrice || 0,
        priceMin: data.priceSpread?.min || 0,
        priceMax: data.priceSpread?.max || 0,
        freeShippingPct: data.freeShippingPct || 0,
        sellerConcentration: data.sellerConcentration || 0,
        topProducts: (data.topProducts || []).filter(Boolean).map(mapNicheProduct),
        aspects: Object.entries(data.aspectDistributions || {}).map(([name, values]: [string, any]) => {
          const total = Object.values(values as Record<string, number>).reduce((s: number, c: number) => s + c, 0);
          return { name, count: total, percentage: data.totalResults ? Math.round((total / data.totalResults) * 100) : 0 };
        }),
        priceDistribution: data.priceDistribution || [],
        opportunityScore: data.opportunityScore || 0,
        demandLabel: data.demandLabel || '',
        competitionLabel: data.competitionLabel || '',
        opportunityLabel: data.opportunityLabel || '',
        avgSoldPerItem: data.avgSoldPerItem,
        sellThroughRate: data.sellThroughRate,
        listingsPerSeller: data.listingsPerSeller,
      };
      setReport(mapped);
    } catch (err: any) {
      toast.error(err.message || 'Kategori analizi basarisiz');
    } finally {
      setLoading(false);
      setCategoryAnalyzing(null);
    }
  }, [marketplace, userId]);

  const handleSaveNiche = useCallback(async () => {
    if (!report) return;
    setSavingNiche(true);
    try {
      await apiPost('save_niche', userId, {
        query: report.keyword,
        marketplace: marketplace || 'EBAY_US',
        totalResults: report.totalListings,
        avgPrice: report.avgPrice,
        medianPrice: report.medianPrice,
        uniqueSellers: report.uniqueSellers,
        demandScore: report.demandScore,
        competitionScore: report.competitionScore,
      });
      toast.success(t('nicheSaved'));
      await fetchSavedNiches();
    } catch (err: any) {
      toast.error(err.message || t('saveFailed'));
    } finally {
      setSavingNiche(false);
    }
  }, [report, userId, fetchSavedNiches]);

  const handleDeleteNiche = useCallback(async (id: string) => {
    try {
      await apiPost('delete_niche', userId, { id });
      setSavedNiches(prev => prev.filter(n => n.id !== id));
      toast.success(t('nicheDeleted'));
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    }
  }, [userId]);

  const handleLoadNiche = (niche: any) => {
    // Saved niches from DB have `query` field, mapped niches have `keyword`
    const mapped: NicheReport = {
      id: niche.id,
      keyword: niche.keyword || niche.query || '',
      demandScore: niche.demandScore || 0,
      competitionScore: niche.competitionScore || 0,
      totalListings: niche.totalListings || niche.totalResults || 0,
      uniqueSellers: niche.uniqueSellers || 0,
      avgPrice: niche.avgPrice || 0,
      medianPrice: niche.medianPrice || 0,
      priceMin: niche.priceMin || niche.priceSpread?.min || 0,
      priceMax: niche.priceMax || niche.priceSpread?.max || 0,
      freeShippingPct: niche.freeShippingPct || 0,
      sellerConcentration: niche.sellerConcentration || 0,
      topProducts: (niche.topProducts || []).map(mapNicheProduct),
      aspects: niche.aspects || [],
      priceDistribution: niche.priceDistribution || [],
      savedAt: niche.savedAt || niche.createdAt,
      opportunityScore: niche.opportunityScore || 0,
      demandLabel: niche.demandLabel || '',
      competitionLabel: niche.competitionLabel || '',
      opportunityLabel: niche.opportunityLabel || '',
      avgSoldPerItem: niche.avgSoldPerItem,
      sellThroughRate: niche.sellThroughRate,
      listingsPerSeller: niche.listingsPerSeller,
    };
    setReport(mapped);
    setKeyword(mapped.keyword);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Box>
      {/* Search */}
      <Paper sx={{
        p: 2, mb: 2,
        background: '#fff',
        boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
        borderRadius: 3,
        border: '1px solid rgba(99,102,241,0.08)',
      }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, color: '#1e1b4b' }}>
          <Gauge size={18} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
          {t('nicheAnalysis')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label={t('keywordOrCategory')}
            placeholder="or: vintage jewelry, phone case, led lights"
            helperText={t('nicheAnalysisHelper')}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setAutoLoaded(false); handleAnalyze(); } }}
            sx={{ flex: '2 1 250px' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>{t('marketplace')}</InputLabel>
            <Select value={marketplace} label="Pazar Yeri" onChange={e => setMarketplace(e.target.value)}>
              {MARKETPLACES_DATA.map(m => (
                <MenuItem key={m.value} value={m.value}>{m.flag} {t(m.labelKey)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={() => { setAutoLoaded(false); handleAnalyze(); }} disabled={loading} sx={{
            minWidth: 110,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            borderRadius: 2,
            transition: 'all 0.2s ease',
            '&:hover': { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' },
          }}>
            {loading ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Analiz Et'}
          </Button>
          <Chip
            icon={<Lightbulb size={14} />}
            label={t('tips')}
            size="small"
            variant={showTips ? 'filled' : 'outlined'}
            onClick={() => setShowTips(v => !v)}
            sx={{
              cursor: 'pointer', alignSelf: 'center',
              ...(showTips ? {
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: '#fff',
              } : {
                borderColor: 'rgba(99,102,241,0.3)',
                color: '#6366f1',
              }),
            }}
          />
        </Box>

        {/* Tips */}
        <Collapse in={showTips}>
          <Paper sx={{ p: 2, mt: 1.5, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>Ipuclari</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>Dusuk rekabet + yuksek talep = en iyi firsatlar</li>
                <li>Firsat skoru 70+ olan nislere odaklanin</li>
                <li>Nis kaydedin ve duzenli olarak fiyat/rekabet degisimlerini kontrol edin</li>
                <li>En cok satan urunleri inceleyerek hangi ozelliklerin onemli oldugunu anlayin</li>
              </ul>
            </Typography>
          </Paper>
        </Collapse>
      </Paper>

      {/* Auto-loaded trending banner */}
      {autoLoaded && report && (
        <Paper sx={{ p: 1.5, mb: 2, background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingUp size={16} color="#6366f1" />
          <Typography variant="body2" color="text.secondary">
            {t('sampleNicheAnalysis')}
          </Typography>
        </Paper>
      )}

      {/* Trending Categories — shown when no report */}
      {!report && !loading && (
        <Paper sx={{
          p: 2, mb: 2,
          background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)',
          border: '1px solid rgba(99,102,241,0.1)',
          borderRadius: 3,
          boxShadow: '0 2px 12px rgba(99,102,241,0.06)',
        }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, color: '#1e1b4b' }}>
            <TrendingUp size={16} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
            {t('popularCategories')}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: '#64748b' }}>
            {t('popularCategoriesHint')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {POPULAR_CATEGORIES_DATA.map(cat => (
              <Paper
                key={cat.id}
                variant="outlined"
                onClick={() => { setAutoLoaded(false); handleCategoryAnalyze(cat.id, t(cat.nameKey)); }}
                sx={{
                  p: 2, cursor: 'pointer', textAlign: 'center',
                  minWidth: isMobile ? '48%' : 130, flex: '1 1 130px', maxWidth: 170,
                  background: '#fff',
                  borderRadius: 3,
                  border: '1px solid rgba(99,102,241,0.1)',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                  transition: 'all 0.25s ease',
                  '&:hover': { borderColor: '#6366f1', bgcolor: '#f8faff', transform: 'translateY(-3px)', boxShadow: '0 4px 16px rgba(99,102,241,0.15)' },
                  opacity: categoryAnalyzing === cat.id ? 0.6 : 1,
                }}
              >
                <Typography sx={{ fontSize: '1.5rem', mb: 0.5 }}>{cat.emoji}</Typography>
                <Typography variant="caption" fontWeight={600} sx={{ lineHeight: 1.2 }}>{t(cat.nameKey)}</Typography>
                {categoryAnalyzing === cat.id && <CircularProgress size={14} sx={{ mt: 0.5, display: 'block', mx: 'auto' }} />}
              </Paper>
            ))}
          </Box>
        </Paper>
      )}

      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 2, '& .MuiLinearProgress-bar': { background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' } }} />}

      {/* Niche Report Card */}
      {report && (
        <Box>
          {/* Score Cards */}
          <Paper sx={{
            p: 2, mb: 2,
            background: '#fff',
            boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
            borderRadius: 3,
            border: '1px solid rgba(99,102,241,0.08)',
          }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e1b4b' }}>
                &ldquo;{report.keyword}&rdquo; {t('nicheReport')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => { setReport(null); setKeyword(''); }}
                >
                  Kesfetmeye Don
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={savingNiche ? <CircularProgress size={14} /> : <Save size={14} />}
                  onClick={handleSaveNiche}
                  disabled={savingNiche}
                  sx={{ borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}
                >
                  {t('save')}
                </Button>
                {onNavigate && (
                  <>
                    <Button size="small" variant="outlined" startIcon={<Search size={14} />} onClick={() => onNavigate('product_database', { keyword: report.keyword })} sx={{ borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}>
                      {t('viewProducts')}
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<Target size={14} />} onClick={() => onNavigate('seo_analyzer', { keyword: report.keyword })} sx={{ borderRadius: 2, borderColor: '#6366f1', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { borderColor: '#4f46e5', bgcolor: 'rgba(99,102,241,0.04)' } }}>
                      SEO
                    </Button>
                  </>
                )}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', mb: 2 }}>
              <Paper sx={{ minWidth: { xs: '45%', sm: 140 }, background: '#fff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.1)', boxShadow: '0 1px 8px rgba(99,102,241,0.06)', transition: 'all 0.2s ease', '&:hover': { boxShadow: '0 2px 16px rgba(99,102,241,0.12)' } }}>
                <ScoreDisplay label="Talep Skoru" score={report.demandScore} />
              </Paper>
              <Paper sx={{ minWidth: { xs: '45%', sm: 140 }, background: '#fff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.1)', boxShadow: '0 1px 8px rgba(99,102,241,0.06)', transition: 'all 0.2s ease', '&:hover': { boxShadow: '0 2px 16px rgba(99,102,241,0.12)' } }}>
                <ScoreDisplay label="Rekabet Skoru" score={report.competitionScore} invert />
              </Paper>
              <Paper sx={{ minWidth: { xs: '90%', sm: 140 }, background: '#fff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.1)', boxShadow: '0 2px 12px rgba(99,102,241,0.08)', transition: 'all 0.2s ease', '&:hover': { boxShadow: '0 4px 20px rgba(99,102,241,0.15)' } }}>
                <ScoreDisplay label={t('opportunityScore')} score={report.opportunityScore || 0} />
              </Paper>
            </Box>

            {/* Score Explanations */}
            <Box sx={{ mt: 2, mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {report.demandLabel && (
                <Alert severity={report.demandScore >= 70 ? 'success' : report.demandScore >= 40 ? 'warning' : 'error'} sx={{ py: 0 }}>
                  <Typography variant="body2"><strong>Talep:</strong> {report.demandLabel}</Typography>
                </Alert>
              )}
              {report.competitionLabel && (
                <Alert severity={report.competitionScore <= 30 ? 'success' : report.competitionScore <= 60 ? 'warning' : 'error'} sx={{ py: 0 }}>
                  <Typography variant="body2"><strong>Rekabet:</strong> {report.competitionLabel}</Typography>
                </Alert>
              )}
              {report.opportunityLabel && (
                <Alert severity={(report.opportunityScore || 0) >= 70 ? 'success' : (report.opportunityScore || 0) >= 50 ? 'info' : (report.opportunityScore || 0) >= 30 ? 'warning' : 'error'} sx={{ py: 0 }}>
                  <Typography variant="body2"><strong>{t('result')}:</strong> {report.opportunityLabel}</Typography>
                </Alert>
              )}
            </Box>

            {/* Stats Grid */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              <StatCard icon={<Package size={16} />} label={t('totalListings')} value={report.totalListings.toLocaleString()} />
              <StatCard icon={<Users size={16} />} label={t('uniqueSellers')} value={report.uniqueSellers.toLocaleString()} />
              <StatCard icon={<DollarSign size={16} />} label={t('avgPrice')} value={`$${report.avgPrice.toFixed(2)}`} />
              <StatCard icon={<Target size={16} />} label={t('medianPrice')} value={`$${report.medianPrice.toFixed(2)}`} />
              <StatCard icon={<ArrowUpDown size={16} />} label={t('priceRange')} value={`$${report.priceMin.toFixed(0)} - $${report.priceMax.toFixed(0)}`} />
              <StatCard icon={<ShoppingBag size={16} />} label={t('freeShipping')} value={`%${report.freeShippingPct.toFixed(0)}`} />
              <StatCard icon={<Users size={16} />} label={t('sellerDensity')} value={`%${report.sellerConcentration.toFixed(0)}`} sub={t('top10SellerShare')} />
              {report.avgSoldPerItem !== undefined && (
                <StatCard icon={<TrendingUp size={16} />} label={t('avgSalesPerProduct')} value={report.avgSoldPerItem || 0} sub={t('top20Average')} />
              )}
              {report.sellThroughRate !== undefined && (
                <StatCard icon={<BarChart2 size={16} />} label={t('sellThroughRate')} value={`%${(report.sellThroughRate || 0).toFixed(1)}`} sub={t('demandSupplyRatio')} />
              )}
              {report.listingsPerSeller !== undefined && (
                <StatCard icon={<Users size={16} />} label={t('listingsPerSeller')} value={(report.listingsPerSeller || 0).toFixed(1)} sub={t('avgPerSeller')} />
              )}
            </Box>
          </Paper>

          {/* Price Distribution */}
          {report.priceDistribution && report.priceDistribution.length > 0 && (
            <Paper sx={{
              p: 2, mb: 2,
              background: '#fff',
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              borderRadius: 3,
              border: '1px solid rgba(99,102,241,0.08)',
            }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#1e1b4b' }}>
                <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
                {t('priceDistribution')}
              </Typography>
              <SimpleHistogram data={report.priceDistribution} />
            </Paper>
          )}

          {/* Aspect Analysis */}
          {report.aspects && report.aspects.length > 0 && (
            <Paper sx={{
              p: 2, mb: 2,
              background: '#fff',
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              borderRadius: 3,
              border: '1px solid rgba(99,102,241,0.08)',
            }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#1e1b4b' }}>
                <FolderTree size={16} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
                {t('aspectAnalysis')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {report.aspects.slice(0, 30).map(a => (
                  <Chip
                    key={a.name}
                    label={`${a.name} (${a.count})`}
                    size="small"
                    sx={{
                      bgcolor: `rgba(99, 102, 241, ${Math.min(a.percentage / 100, 0.3)})`,
                      color: a.percentage > 40 ? '#fff' : '#1e1b4b',
                      fontWeight: a.percentage > 30 ? 600 : 400,
                      borderLeft: '3px solid',
                      borderLeftColor: `rgba(99, 102, 241, ${Math.min(a.percentage / 50, 1)})`,
                      borderRadius: 2,
                      transition: 'all 0.2s ease',
                      '&:hover': { boxShadow: '0 2px 8px rgba(99,102,241,0.2)', transform: 'translateY(-1px)' },
                    }}
                  />
                ))}
              </Box>
            </Paper>
          )}

          {/* Top Products */}
          {report.topProducts && report.topProducts.length > 0 && (
            <Paper sx={{
              p: 2, mb: 2,
              background: '#fff',
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              borderRadius: 3,
              border: '1px solid rgba(99,102,241,0.08)',
            }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#1e1b4b' }}>
                <Star size={16} style={{ verticalAlign: 'middle', marginRight: 6, color: '#f59e0b' }} />
                {t('topSellingProducts')}
              </Typography>
              {isMobile ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {nicheProductSort.sorted.slice(0, 10).map(p => (
                    <Paper key={p.itemId} sx={{ p: 1.5, background: '#fff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', transition: 'all 0.2s ease', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Typography variant="body2" fontWeight={500} sx={{
                          flex: 1, mr: 1,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          <a href={p.itemUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', textDecoration: 'none' }}>
                            {p.title}
                          </a>
                        </Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexShrink: 0, color: '#6366f1' }}>${p.price.toFixed(2)}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                        <SoldBadge count={p.estimatedSold} />
                        {p.seller && <Typography variant="caption" color="text.secondary">{p.seller}</Typography>}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                        <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('title')}</TableCell>
                        <TableCell align="right" sortDirection={nicheProductSort.sortKey === 'price' ? nicheProductSort.sortDir : false}>
                          <TableSortLabel active={nicheProductSort.sortKey === 'price'} direction={nicheProductSort.sortKey === 'price' ? nicheProductSort.sortDir : 'desc'} onClick={() => nicheProductSort.handleSort('price')}>
                            {t('price')}
                          </TableSortLabel>
                        </TableCell>
                        <TableCell align="center" sortDirection={nicheProductSort.sortKey === 'estimatedSold' ? nicheProductSort.sortDir : false}>
                          <TableSortLabel active={nicheProductSort.sortKey === 'estimatedSold'} direction={nicheProductSort.sortKey === 'estimatedSold' ? nicheProductSort.sortDir : 'desc'} onClick={() => nicheProductSort.handleSort('estimatedSold')}>
                            {t('sales')}
                          </TableSortLabel>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>{t('seller')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {nicheProductSort.sorted.slice(0, 20).map(p => (
                        <TableRow key={p.itemId} hover sx={{ transition: 'all 0.15s ease', '&:hover': { bgcolor: '#f8faff', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' } }}>
                          <TableCell sx={{ maxWidth: 350 }}>
                            <Typography
                              variant="body2"
                              component="a"
                              href={p.itemUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{
                                color: '#6366f1', textDecoration: 'none', fontWeight: 500,
                                '&:hover': { textDecoration: 'underline', color: '#4f46e5' },
                                display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                              }}
                            >
                              {p.title}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 700, color: '#6366f1' }}>${p.price.toFixed(2)}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            <SoldBadge count={p.estimatedSold} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{p.seller}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          )}
        </Box>
      )}

      {!report && !loading && (
        <EmptyState message={t('startNicheAnalysis')} sub={t('nicheAnalysisHint')} />
      )}

      {/* Saved Niches */}
      <Divider sx={{ my: 3 }} />
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, color: '#1e1b4b' }}>
        <Bookmark size={18} style={{ verticalAlign: 'middle', marginRight: 6, color: '#6366f1' }} />
        {t('savedNiches')}
      </Typography>

      {loadingNiches ? (
        <Box sx={{ py: 2 }}>
          {[1, 2].map(i => <Skeleton key={i} variant="rectangular" height={60} sx={{ mb: 1, borderRadius: 1 }} />)}
        </Box>
      ) : savedNiches.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          {t('noSavedNiches')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {savedNiches.map(niche => (
            <Paper key={niche.id} sx={{
              p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
              background: '#fff',
              borderRadius: 3,
              border: '1px solid rgba(99,102,241,0.08)',
              borderLeft: `4px solid ${SCORE_COLOR((niche as any).opportunityScore || Math.max(niche.demandScore - niche.competitionScore, 0))}`,
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
              transition: 'all 0.2s ease',
              '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.08)', transform: 'translateY(-1px)' },
            }}>
              <Box sx={{ flex: 1, minWidth: 150 }}>
                <Typography variant="body2" fontWeight={600}>{(niche as any).keyword || (niche as any).query || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {(niche.savedAt || (niche as any).createdAt) ? formatDate(niche.savedAt || (niche as any).createdAt) : ''}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip
                  label={`${t('demand')}: ${niche.demandScore}`}
                  size="small"
                  sx={{ bgcolor: `${SCORE_COLOR(niche.demandScore)}22`, color: SCORE_COLOR(niche.demandScore), fontWeight: 600 }}
                />
                <Chip
                  label={`Rekabet: ${niche.competitionScore}`}
                  size="small"
                  sx={{ bgcolor: `${SCORE_COLOR(niche.competitionScore, true)}22`, color: SCORE_COLOR(niche.competitionScore, true), fontWeight: 600 }}
                />
                <Chip label={`${niche.totalListings.toLocaleString()} ${t('products')}`} size="small" variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Tooltip title={t('loadReport')}>
                  <IconButton size="small" onClick={() => handleLoadNiche(niche)} sx={{ borderRadius: 2, bgcolor: 'rgba(99,102,241,0.06)', color: '#6366f1', transition: 'all 0.2s ease', '&:hover': { bgcolor: 'rgba(99,102,241,0.15)' } }}>
                    <Eye size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('delete')}>
                  <IconButton size="small" color="error" onClick={() => niche.id && handleDeleteNiche(niche.id)} sx={{ borderRadius: 2, transition: 'all 0.2s ease' }}>
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TAB 4: Seller Tracker
// ---------------------------------------------------------------------------

function SellerTracker({ userId, userListings, onNavigate }: { userId: string; userListings?: any[]; onNavigate?: (tool: string, data?: any) => void }) {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime } = useLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [sellers, setSellers] = useState<TrackedSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const sellerSort = useTableSort<TrackedSeller>(sellers, 'feedbackScore', 'desc');

  const fetchSellers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('tracked_sellers', userId);
      setSellers(data.sellers || []);
    } catch (err: any) {
      toast.error(err.message || t('sellersLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchSellers(); }, [fetchSellers]);

  const handleAddSeller = useCallback(async () => {
    if (!username.trim()) return;
    setAdding(true);
    try {
      await apiPost('track_seller', userId, { username: username.trim() });
      toast.success(t('sellerTracked'));
      setUsername('');
      await fetchSellers();
    } catch (err: any) {
      toast.error(err.message || t('sellerAddFailed'));
    } finally {
      setAdding(false);
    }
  }, [username, userId, fetchSellers]);

  const handleRemoveSeller = useCallback(async (id: string) => {
    try {
      await apiPost('untrack_seller', userId, { id });
      setSellers(prev => prev.filter(s => s.id !== id));
      toast.success(t('sellerUntracked'));
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    }
  }, [userId]);

  const handleSaveNotes = useCallback(async (id: string) => {
    try {
      await apiPost('update_seller', userId, { id, notes: notesText });
      setSellers(prev => prev.map(s => s.id === id ? { ...s, notes: notesText } : s));
      setEditingNotes(null);
      toast.success(t('noteSaved'));
    } catch (err: any) {
      toast.error(err.message || t('noteSaveFailed'));
    }
  }, [userId, notesText]);

  const handleViewProducts = useCallback((sellerUsername: string) => {
    // Open in new tab or navigate to product database with seller filter
    const url = `https://www.ebay.com/sch/${encodeURIComponent(sellerUsername)}/m.html`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  if (loading) {
    return (
      <Box sx={{ py: 4 }}>
        {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" height={70} sx={{ mb: 1, borderRadius: 1 }} />)}
      </Box>
    );
  }

  return (
    <Box>
      {/* Add Seller Form */}
      <Paper sx={{
        p: 2, mb: 2, borderRadius: 3,
        background: 'linear-gradient(135deg, #fafbff 0%, #f0f1ff 100%)',
        border: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
      }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, color: '#312e81' }}>
          <Users size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {t('trackSeller')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label={t('ebayUsername')}
            placeholder="or: top_seller_2024, best.deals.shop"
            helperText={t('sellerUsernameHelp')}
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddSeller()}
            sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Users size={16} /></InputAdornment>,
            }}
          />
          <Button
            variant="contained"
            onClick={handleAddSeller}
            disabled={adding || !username.trim()}
            sx={{ minWidth: 100, bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            {adding ? <CircularProgress size={18} /> : t('track')}
          </Button>
        </Box>
      </Paper>

      {/* Seller List */}
      {sellers.length === 0 ? (
        <Box>
          <EmptyState
            message="Henuz takip ettiginiz satici yok"
            sub="Rakip saticilari ekleyerek fiyat ve stok degisikliklerini izleyin. Yukaridaki alana eBay kullanici adi girin."
          />
          <Paper sx={{ p: 2, mt: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>Satici Takibi Nasil Kullanilir?</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>Rakip saticilarin eBay kullanici adini girin</li>
                <li>Yeni urun, fiyat degisikligi ve stok guncellemelerini otomatik takip edin</li>
                <li>Satici puanini ve olumlu geri bildirim oranini izleyin</li>
                <li>Saticinin urunlerini gorup kendi nisleriyle karsilastirin</li>
              </ul>
            </Typography>
          </Paper>
        </Box>
      ) : isMobile ? (
        /* Mobile Card View */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {sellers.map(seller => (
            <Paper key={seller.id} sx={{ p: 1.5, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: '0.95rem', color: '#1e1b4b' }}>{seller.sellerUsername}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                    <Chip
                      icon={<Star size={12} />}
                      label={(seller.feedbackScore || 0).toLocaleString()}
                      size="small"
                      variant="outlined"
                      sx={{ height: 22, borderColor: 'rgba(99,102,241,0.3)', fontWeight: 600, color: '#6366f1' }}
                    />
                    <Chip
                      label={`%${seller.feedbackPct || '0'} olumlu`}
                      size="small"
                      sx={{
                        height: 22,
                        bgcolor: parseFloat(seller.feedbackPct || '0') >= 98 ? '#ecfdf5' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#fffbeb' : '#fef2f2',
                        color: parseFloat(seller.feedbackPct || '0') >= 98 ? '#059669' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#d97706' : '#dc2626',
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                </Box>
                <IconButton size="small" color="error" onClick={() => handleRemoveSeller(seller.id)}>
                  <Trash2 size={16} />
                </IconButton>
              </Box>

              {/* Notes */}
              <Box sx={{ mb: 1 }}>
                {editingNotes === seller.id ? (
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={notesText}
                      onChange={e => setNotesText(e.target.value)}
                      multiline
                      maxRows={3}
                    />
                    <IconButton size="small" color="primary" onClick={() => handleSaveNotes(seller.id)}>
                      <Save size={14} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingNotes(null)}>
                      <X size={14} />
                    </IconButton>
                  </Box>
                ) : (
                  <Typography
                    variant="caption"
                    sx={{ cursor: 'pointer', color: seller.notes ? 'text.primary' : 'text.secondary', '&:hover': { color: 'primary.main' } }}
                    onClick={() => { setEditingNotes(seller.id); setNotesText(seller.notes || ''); }}
                  >
                    {seller.notes || 'Not ekle...'}
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {onNavigate && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Package size={14} />}
                      onClick={() => onNavigate('product_database', { keyword: seller.sellerUsername })}
                    >
                      {t('viewProducts')}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Eye size={14} />}
                      onClick={() => onNavigate('competitive_intelligence', { seller: seller.sellerUsername })}
                    >
                      {t('competitiveIntelligence')}
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ExternalLink size={14} />}
                  onClick={() => handleViewProducts(seller.sellerUsername)}
                >
                  {t('viewOnEbay')}
                </Button>
              </Box>

              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, textAlign: 'right' }}>
                Son kontrol: {seller.lastCheckedAt ? formatDateTime(seller.lastCheckedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        /* Desktop Table View */
        <TableContainer component={Paper} sx={{ borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: 'linear-gradient(135deg, #f8f9ff 0%, #eef0ff 100%)' }}>
                <TableCell sx={{ fontWeight: 600, color: '#4338ca' }}>{t('username')}</TableCell>
                <TableCell align="center" sortDirection={sellerSort.sortKey === 'feedbackScore' ? sellerSort.sortDir : false}>
                  <TableSortLabel active={sellerSort.sortKey === 'feedbackScore'} direction={sellerSort.sortKey === 'feedbackScore' ? sellerSort.sortDir : 'desc'} onClick={() => sellerSort.handleSort('feedbackScore')}>
                    Puan
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">Olumlu %</TableCell>
                <TableCell>Notlar</TableCell>
                <TableCell align="center">Son Kontrol</TableCell>
                <TableCell align="center">Aksiyonlar</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sellerSort.sorted.map(seller => (
                <TableRow key={seller.id} hover sx={{ '&:hover': { bgcolor: 'rgba(99,102,241,0.03)' } }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700} sx={{ fontSize: '0.9rem', color: '#1e1b4b' }}>{seller.sellerUsername}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      icon={<Star size={12} />}
                      label={(seller.feedbackScore || 0).toLocaleString()}
                      size="small"
                      variant="outlined"
                      sx={{ borderColor: 'rgba(99,102,241,0.3)', fontWeight: 600, color: '#6366f1' }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        color: parseFloat(seller.feedbackPct || '0') >= 98 ? '#059669' : parseFloat(seller.feedbackPct || '0') >= 95 ? '#d97706' : '#dc2626',
                      }}
                    >
                      %{seller.feedbackPct || '0'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    {editingNotes === seller.id ? (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          value={notesText}
                          onChange={e => setNotesText(e.target.value)}
                          multiline
                          maxRows={2}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="small" color="primary" onClick={() => handleSaveNotes(seller.id)}>
                          <Save size={14} />
                        </IconButton>
                        <IconButton size="small" onClick={() => setEditingNotes(null)}>
                          <X size={14} />
                        </IconButton>
                      </Box>
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                        onClick={() => { setEditingNotes(seller.id); setNotesText(seller.notes || ''); }}
                      >
                        {seller.notes || 'Not ekle...'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="caption" color="text.secondary">
                      {seller.lastCheckedAt ? formatDateTime(seller.lastCheckedAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                      {onNavigate && (
                        <>
                          <Tooltip title={t('viewProducts')}>
                            <IconButton size="small" onClick={() => onNavigate('product_database', { keyword: seller.sellerUsername })}>
                              <Package size={16} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('competitiveIntelligence')}>
                            <IconButton size="small" onClick={() => onNavigate('competitive_intelligence', { seller: seller.sellerUsername })}>
                              <Eye size={16} />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip title={t('viewOnEbay')}>
                        <IconButton size="small" onClick={() => handleViewProducts(seller.sellerUsername)}>
                          <ExternalLink size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('remove')}>
                        <IconButton size="small" color="error" onClick={() => handleRemoveSeller(seller.id)}>
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

const SECTIONS = [
  {
    labelKey: 'sectionResearch',
    icon: <Search size={18} />,
    descriptionKey: 'sectionResearchDesc',
    welcomeKey: 'sectionResearchWelcome',
    subTabs: [
      { labelKey: 'tabProductDatabase', icon: <Package size={14} /> },
      { labelKey: 'tabCategoryNiche', icon: <Gauge size={14} /> },
      { labelKey: 'tabKeywordAnalysis', icon: <Tag size={14} /> },
      { labelKey: 'tabArbitrageFinder', icon: <Globe size={14} /> },
      { labelKey: 'tabMarketComparison', icon: <Globe size={14} /> },
      { labelKey: 'tabCategoryExplorer', icon: <Layers size={14} /> },
      { labelKey: 'tabNicheComparison', icon: <BarChart2 size={14} /> },
    ],
  },
  {
    labelKey: 'sectionTracking',
    icon: <Bookmark size={18} />,
    descriptionKey: 'sectionTrackingDesc',
    welcomeKey: 'sectionTrackingWelcome',
    subTabs: [
      { labelKey: 'tabProductTracker', icon: <Bookmark size={14} /> },
      { labelKey: 'tabSellerTracker', icon: <Users size={14} /> },
      { labelKey: 'tabCompetitorAnalysis', icon: <Eye size={14} /> },
    ],
  },
  {
    labelKey: 'sectionOptimization',
    icon: <TrendingUp size={18} />,
    descriptionKey: 'sectionOptimizationDesc',
    welcomeKey: 'sectionOptimizationWelcome',
    subTabs: [
      { labelKey: 'tabSeoAnalysis', icon: <Target size={14} /> },
      { labelKey: 'tabAiAssistant', icon: <Sparkles size={14} /> },
      { labelKey: 'tabListingOptimizer', icon: <Zap size={14} /> },
      { labelKey: 'tabFinancialCalc', icon: <DollarSign size={14} /> },
    ],
  },
];

function SectionWelcome({ section, userListings = [], sectionIndex }: { section: typeof SECTIONS[number]; userListings?: any[]; sectionIndex?: number }) {
  const t = useTranslations('ebayResearch');
  const hasListings = userListings.length > 0;

  const personalizedMessage = hasListings
    ? sectionIndex === 0
      ? `${userListings.length} aktif listelemeniz var. Araclarimiz senin kategorilerin ve urunlerin uzerinden otomatik analiz yapacak.`
      : sectionIndex === 1
        ? 'Rakiplerini otomatik tespit ettik. Takip etmeye basla.'
        : sectionIndex === 2
          ? 'Listelerinizi analiz ettik. Iyilestirme onerilerimizi gorun.'
          : null
    : null;

  return (
    <Paper
      sx={{
        p: { xs: 2, sm: 4 },
        textAlign: 'center',
        background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 50%, #e0f2fe 100%)',
        borderRadius: 4,
        boxShadow: '0 4px 24px rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.1)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ width: 80, height: 80, borderRadius: '50%', background: 'linear-gradient(135deg, #ede9fe 0%, #e0f2fe 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>{React.cloneElement(section.icon as React.ReactElement, { size: 36, strokeWidth: 1.5, style: { color: '#6366f1' } })}</Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
        {t(section.labelKey)}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 480, mx: 'auto', wordBreak: 'break-word', px: 1 }}>
        {t(section.welcomeKey)}
      </Typography>
      {personalizedMessage && (
        <Typography variant="body2" color="primary.main" fontWeight={600} sx={{ mb: 2, maxWidth: 480, mx: 'auto', wordBreak: 'break-word', px: 1 }}>
          {personalizedMessage}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        Baslamak icin yukaridaki araclardan birini secin.
      </Typography>
    </Paper>
  );
}

function EbayResearchPage() {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime, formatNumber } = useLocale();
  const { user } = useAuth() as any;
  const userId = user?.id as string | undefined;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mainTab, setMainTab] = useState(0);
  const [subTab, setSubTab] = useState(0); // auto-select first tool
  const [userListings, setUserListings] = useState<any[]>([]);
  const [userListingsLoading, setUserListingsLoading] = useState(true);
  const [userListingsError, setUserListingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Try localStorage cache first (1-hour TTL)
    const CACHE_KEY = `kolayxport_ebay_listings_${userId}`;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { listings, ts } = JSON.parse(cached);
        if (Date.now() - ts < 3600000 && listings?.length > 0) {
          setUserListings(listings);
          setUserListingsLoading(false);
          return;
        }
      }
    } catch { /* ignore cache errors */ }

    let attempt = 0;
    const maxAttempts = 3;

    const fetchListings = async () => {
      setUserListingsLoading(true);
      setUserListingsError(null);
      while (attempt < maxAttempts) {
        try {
          const r = await fetch(`/api/clawd/ebay?action=my_legacy_listings&user_id=${userId}&marketplace_id=EBAY_US`, {
            credentials: 'same-origin',
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            if (r.status === 401 || r.status === 403) {
              setUserListingsError('auth');
              setUserListings([]);
              setUserListingsLoading(false);
              return;
            }
            throw new Error(`${r.status}: ${errText}`);
          }
          const data = await r.json();
          const listings = data.listings || [];
          setUserListings(listings);
          if (listings.length > 0) {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ listings, ts: Date.now() })); } catch { /* quota */ }
          }
          setUserListingsLoading(false);
          return;
        } catch (err: any) {
          attempt++;
          if (attempt >= maxAttempts) {
            setUserListingsError('network');
            setUserListings([]);
            setUserListingsLoading(false);
            return;
          }
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    };
    fetchListings();
  }, [userId]);

  const [globalSearch, setGlobalSearch] = useState('');
  const [navigateData, setNavigateData] = useState<any>(null);

  const handleMainTabChange = (_: any, v: number) => {
    setMainTab(v);
    setSubTab(0); // auto-select first tool in new section
  };

  // Cross-tool navigation handler
  const handleNavigate = useCallback((tool: string, data?: any) => {
    setNavigateData(data || null);
    switch (tool) {
      case 'product_database': setMainTab(0); setSubTab(0); break;
      case 'niche_finder': setMainTab(0); setSubTab(1); break;
      case 'keyword_intelligence': setMainTab(0); setSubTab(2); break;
      case 'product_tracker': setMainTab(1); setSubTab(0); break;
      case 'seller_tracker': setMainTab(1); setSubTab(1); break;
      case 'competitive_intelligence': setMainTab(1); setSubTab(2); break;
      case 'seo_analyzer': setMainTab(2); setSubTab(0); break;
      case 'ai_hub': setMainTab(2); setSubTab(1); break;
      case 'listing_optimizer': setMainTab(2); setSubTab(2); break;
      case 'financial': setMainTab(2); setSubTab(3); break;
      case 'marketplace_comparison': setMainTab(0); setSubTab(4); break;
      case 'category_explorer': setMainTab(0); setSubTab(5); break;
      case 'niche_comparison': setMainTab(0); setSubTab(6); break;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const clearNavigateData = useCallback(() => setNavigateData(null), []);

  // Global search: detect eBay URL vs keyword vs @seller
  const handleGlobalSearch = useCallback(() => {
    const q = globalSearch.trim();
    if (!q) return;
    if (q.includes('ebay.com/itm/')) {
      // eBay URL → go to product tracker
      handleNavigate('product_tracker', { addUrl: q });
    } else if (q.startsWith('@')) {
      // Seller name → go to seller tracker
      handleNavigate('seller_tracker', { username: q.slice(1) });
    } else {
      // Keyword → go to product database with search
      handleNavigate('product_database', { keyword: q });
    }
    setGlobalSearch('');
  }, [globalSearch, handleNavigate]);

  if (!userId) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  const currentSection = SECTIONS[mainTab];

  return (
    <Box sx={{ maxWidth: 1800, mx: 'auto', px: isMobile ? 0.5 : 1, py: 1, width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
      <Toaster position="top-right" />

      {/* Header */}
      <Box sx={{ mb: 2, overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e1b4b', letterSpacing: '-0.02em' }}>
          eBay Urun Istihbarati
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          Pazar arastirmasi, urun takibi, nis analizi ve rakip izleme
        </Typography>
      </Box>

      {/* Global Search Bar */}
      <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', borderRadius: 3, boxShadow: '0 4px 20px rgba(99,102,241,0.15)' }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('searchPlaceholder')}
          helperText={t('searchHelper')}
          value={globalSearch}
          onChange={e => setGlobalSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGlobalSearch()}
          InputProps={{
            startAdornment: <InputAdornment position="start"><Search size={18} style={{ color: '#6366f1' }} /></InputAdornment>,
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: '#fff', '& fieldset': { border: 'none' } }, '& .MuiFormHelperText-root': { color: 'rgba(255,255,255,0.7)' } }}
        />
        <Button variant="contained" onClick={handleGlobalSearch} disabled={!globalSearch.trim()} sx={{ minWidth: isMobile ? 50 : 80, borderRadius: 2, bgcolor: '#fff', color: '#6366f1', fontWeight: 700, '&:hover': { bgcolor: '#f0edff' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.5)', color: 'rgba(99,102,241,0.4)' } }}>
          {isMobile ? <Search size={18} /> : 'Ara'}
        </Button>
      </Paper>

      {/* Main Section Tabs */}
      <Paper sx={{ mb: 2, overflow: 'hidden', width: '100%', maxWidth: '100%', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)', background: '#fff' }}>
        <Tabs
          value={mainTab}
          onChange={handleMainTabChange}
          variant={isMobile ? 'scrollable' : 'fullWidth'}
          scrollButtons={isMobile ? 'auto' : false}
          allowScrollButtonsMobile
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              minHeight: isMobile ? 48 : 64,
              py: 1.5,
              minWidth: isMobile ? 'auto' : undefined,
              px: isMobile ? 1.5 : 2,
            },
          }}
        >
          {SECTIONS.map((section, i) => (
            <Tab
              key={i}
              label={
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {section.icon}
                    <span style={{ fontWeight: 700, fontSize: isMobile ? '0.8rem' : '0.95rem', whiteSpace: 'nowrap' }}>{t(section.labelKey)}</span>
                  </Box>
                  {!isMobile && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                      {t(section.descriptionKey)}
                    </Typography>
                  )}
                </Box>
              }
            />
          ))}
        </Tabs>
      </Paper>

      {/* Sub-tab pills */}
      <Box sx={{ display: 'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', gap: 1, mb: 2, overflowX: isMobile ? 'auto' : 'visible', overflowY: 'hidden', width: '100%', maxWidth: '100%', pb: isMobile ? 0.5 : 0, WebkitOverflowScrolling: 'touch', '&::-webkit-scrollbar': { display: 'none' }, msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
        {currentSection.subTabs.map((st, i) => (
          <Chip
            key={i}
            icon={st.icon as React.ReactElement}
            label={t(st.labelKey)}
            clickable
            onClick={() => setSubTab(i)}
            sx={{
              fontWeight: subTab === i ? 700 : 500,
              fontSize: '0.8rem',
              height: 36,
              px: 0.5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
              ...(subTab === i
                ? {
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    border: 'none',
                    '& .MuiChip-icon': { fontSize: 14, color: '#fff' },
                  }
                : {
                    background: '#f8faff',
                    border: '1px solid rgba(99,102,241,0.15)',
                    color: '#4b5563',
                    '&:hover': {
                      background: '#f0edff',
                      borderColor: '#6366f1',
                    },
                  }),
            }}
          />
        ))}
      </Box>

      {/* User listings status bar */}
      {userListingsLoading && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#f0f7ff', overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <CircularProgress size={16} sx={{ flexShrink: 0 }} />
          <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            eBay listeleriniz yukleniyor...
          </Typography>
        </Paper>
      )}
      {!userListingsLoading && userListings.length > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: '#f0fff4', overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <Typography variant="body2" color="success.main" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
            {userListings.length} aktif listelemeniz yuklendi — araclar otomatik olarak verilerinizi kullanacak.
          </Typography>
        </Paper>
      )}
      {!userListingsLoading && userListings.length === 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: userListingsError === 'auth' ? '#fff0f0' : '#fff8f0', overflow: 'hidden', width: '100%', maxWidth: '100%', boxSizing: 'border-box', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color={userListingsError === 'auth' ? 'error.main' : 'warning.main'} sx={{ wordBreak: 'break-word', flex: 1, minWidth: 0 }}>
            {userListingsError === 'auth'
              ? 'eBay hesabiniz bagli degil. Ayarlardan eBay hesabinizi baglayiniz.'
              : 'eBay listeleriniz yuklenemedi. Tum araclar manual arama ile calisir.'}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => {
            setUserListingsLoading(true);
            setUserListingsError(null);
            fetch(`/api/clawd/ebay?action=my_legacy_listings&user_id=${userId}&marketplace_id=EBAY_US`, {
              credentials: 'same-origin',
            })
              .then(async (r) => r.ok ? r.json() : { listings: [] })
              .then(data => {
                setUserListings(data.listings || []);
                if (data.listings?.length > 0) {
                  try { localStorage.setItem(`kolayxport_ebay_listings_${userId}`, JSON.stringify({ listings: data.listings, ts: Date.now() })); } catch { /* */ }
                }
              })
              .catch(() => { setUserListings([]); setUserListingsError('network'); })
              .finally(() => setUserListingsLoading(false));
          }}>
            Tekrar Dene
          </Button>
        </Paper>
      )}

      {/* Section 0: Arastirma */}
      {mainTab === 0 && subTab === 0 && <ProductDatabase userId={userId} userListings={userListings} userListingsLoading={userListingsLoading} onNavigate={handleNavigate} navigateData={navigateData} onConsumeNavigateData={clearNavigateData} />}
      {mainTab === 0 && subTab === 1 && <NicheFinder userId={userId} userListings={userListings} onNavigate={handleNavigate} navigateData={navigateData} onConsumeNavigateData={clearNavigateData} />}
      {mainTab === 0 && subTab === 2 && <KeywordIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} onNavigate={handleNavigate} />}
      {mainTab === 0 && subTab === 3 && <ArbitrageScanner userId={userId} />}
      {mainTab === 0 && subTab === 4 && <MarketplaceComparison userId={userId} onNavigate={handleNavigate} />}
      {mainTab === 0 && subTab === 5 && <CategoryExplorer userId={userId} onNavigate={handleNavigate} />}
      {mainTab === 0 && subTab === 6 && <NicheComparison userId={userId} onNavigate={handleNavigate} />}

      {/* Section 1: Takip */}
      {mainTab === 1 && subTab === 0 && <ProductTracker userId={userId} userListings={userListings} onNavigate={handleNavigate} />}
      {mainTab === 1 && subTab === 1 && <SellerTracker userId={userId} userListings={userListings} onNavigate={handleNavigate} />}
      {mainTab === 1 && subTab === 2 && <CompetitiveIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} onNavigate={handleNavigate} />}

      {/* Section 2: Optimizasyon */}
      {mainTab === 2 && subTab === 0 && <SeoAnalyzer userId={userId} onNavigate={handleNavigate} navigateData={navigateData} onConsumeNavigateData={clearNavigateData} />}
      {mainTab === 2 && subTab === 1 && <AiOptimizationHub userId={userId} onNavigate={handleNavigate} navigateData={navigateData} onConsumeNavigateData={clearNavigateData} />}
      {mainTab === 2 && subTab === 2 && <ListingOptimizer userId={userId} marketplace="EBAY_US" userListings={userListings} onNavigate={handleNavigate} />}
      {mainTab === 2 && subTab === 3 && <FinancialIntelligence userId={userId} marketplace="EBAY_US" userListings={userListings} onNavigate={handleNavigate} />}
    </Box>
  );
}

// --- Layout wrapper ---
function EbayResearchPageWithLayout(props: any): JSX.Element {
  const t = useTranslations('ebayResearch');
  const { formatDate, formatDateTime, formatNumber } = useLocale();
  return (
    <AppLayout title={t('pageTitle')}>
      <EbayResearchPage {...props} />
    </AppLayout>
  );
}

export default withAuth(EbayResearchPageWithLayout);
