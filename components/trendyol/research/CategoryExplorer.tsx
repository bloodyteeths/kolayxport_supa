import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Chip, Button, Divider,
  Select, MenuItem, FormControl, InputLabel, Tooltip,
  CircularProgress, Skeleton, Collapse, Rating,
  useMediaQuery, IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Heart, ShoppingCart, Eye, Star, Truck, Zap, Shield,
  ChevronDown, ChevronUp, Bookmark, BookmarkCheck, Sparkles,
  Package, Users, Tag, BarChart2, TrendingUp, Store,
  ExternalLink, BadgeCheck, Timer,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TRENDYOL_CATEGORIES } from '@/lib/integrations/trendyolSearch';
import { useTrendyolResearchStore, useSortedProducts } from '@/lib/stores/useTrendyolResearchStore';
import type { TrendyolProduct } from '@/lib/arbitrage/types';

// ================================================================
// CONSTANTS
// ================================================================

const CATEGORY_GROUPS = [
  'Ev & Dekor',
  'Mutfak',
  'Takı & Aksesuar',
  'Tekstil',
  'Yiyecek',
  'Kozmetik',
  'Hediyelik',
] as const;

const GROUP_ICONS: Record<string, React.ReactNode> = {
  'Ev & Dekor': <Package size={14} />,
  'Mutfak': <ShoppingCart size={14} />,
  'Takı & Aksesuar': <Star size={14} />,
  'Tekstil': <Tag size={14} />,
  'Yiyecek': <Store size={14} />,
  'Kozmetik': <Sparkles size={14} />,
  'Hediyelik': <Heart size={14} />,
};

const GROUP_COLORS: Record<string, string> = {
  'Ev & Dekor': '#667eea',
  'Mutfak': '#f2994a',
  'Takı & Aksesuar': '#e91e63',
  'Tekstil': '#2196f3',
  'Yiyecek': '#4caf50',
  'Kozmetik': '#9c27b0',
  'Hediyelik': '#ff5722',
};

const glassCard = {
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: '16px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  transition: 'transform 0.2s, box-shadow 0.2s',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
  },
};

// ================================================================
// HELPERS
// ================================================================

function formatTRY(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(value);
}

function parseSocialProof(value?: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[+,]/g, '').trim();
  if (cleaned.endsWith('K')) return parseFloat(cleaned) * 1000;
  if (cleaned.endsWith('M')) return parseFloat(cleaned) * 1000000;
  return parseInt(cleaned) || 0;
}

// ================================================================
// SUB-COMPONENTS
// ================================================================

interface StatBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}

function StatBadge({ icon, label, value, color }: StatBadgeProps) {
  return (
    <Paper sx={{
      ...glassCard, p: 1.5, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 0.5, minWidth: 0,
    }}>
      <Box sx={{ color, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
      </Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, color }}>
        {value}
      </Typography>
    </Paper>
  );
}

interface ProductCardProps {
  product: TrendyolProduct;
  isMobile: boolean;
  expanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
}

function ProductCard({ product, isMobile, expanded, onToggle, t }: ProductCardProps) {
  const hasDiscount = product.originalPriceTry > product.priceTry;
  const discountPct = hasDiscount
    ? Math.round(((product.originalPriceTry - product.priceTry) / product.originalPriceTry) * 100)
    : 0;

  return (
    <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
      {/* Image */}
      <Box sx={{ position: 'relative' }}>
        <Box
          component="img"
          src={product.imageUrl}
          alt={product.name}
          sx={{
            width: '100%',
            height: isMobile ? 180 : 200,
            objectFit: 'cover',
            display: 'block',
          }}
          loading="lazy"
        />
        {/* Discount badge */}
        {hasDiscount && discountPct > 0 && (
          <Chip
            label={`-${discountPct}%`}
            size="small"
            sx={{
              position: 'absolute', top: 8, left: 8,
              bgcolor: '#f44336', color: '#fff', fontWeight: 700,
              fontSize: '0.7rem', height: 24,
            }}
          />
        )}
        {/* Free shipping badge */}
        {product.freeShipping && (
          <Chip
            icon={<Truck size={12} />}
            label={t('freeShipping')}
            size="small"
            sx={{
              position: 'absolute', top: 8, right: 8,
              bgcolor: 'rgba(76,175,80,0.9)', color: '#fff',
              fontWeight: 600, fontSize: '0.65rem', height: 24,
              '& .MuiChip-icon': { color: '#fff' },
            }}
          />
        )}
        {/* Seller badges */}
        <Box sx={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 0.5 }}>
          {product.sellerBadgeType === 'FAST_SELLER' && (
            <Chip
              icon={<Zap size={11} />}
              label={t('fastSeller')}
              size="small"
              sx={{
                bgcolor: 'rgba(255,152,0,0.9)', color: '#fff',
                fontWeight: 600, fontSize: '0.6rem', height: 22,
                '& .MuiChip-icon': { color: '#fff' },
              }}
            />
          )}
          {product.hasOfficialSellerBadge && (
            <Chip
              icon={<BadgeCheck size={11} />}
              label={t('authorized')}
              size="small"
              sx={{
                bgcolor: 'rgba(33,150,243,0.9)', color: '#fff',
                fontWeight: 600, fontSize: '0.6rem', height: 22,
                '& .MuiChip-icon': { color: '#fff' },
              }}
            />
          )}
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ p: 1.5 }}>
        {/* Brand */}
        {product.brand && (
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#667eea', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {product.brand}
          </Typography>
        )}

        {/* Name */}
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600, mt: 0.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', lineHeight: 1.4, minHeight: '2.8em',
          }}
        >
          {product.name}
        </Typography>

        {/* Price */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#f44336' }}>
            {formatTRY(product.priceTry)}
          </Typography>
          {hasDiscount && (
            <Typography variant="caption" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
              {formatTRY(product.originalPriceTry)}
            </Typography>
          )}
        </Box>

        {/* Rating */}
        {product.ratingScore > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Rating
              value={product.ratingScore}
              precision={0.1}
              readOnly
              size="small"
              sx={{ fontSize: '0.9rem' }}
            />
            <Typography variant="caption" color="text.secondary">
              ({product.ratingCount})
            </Typography>
          </Box>
        )}

        {/* Social proof badges */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {product.favoriteCount && (
            <Chip
              icon={<Heart size={11} />}
              label={product.favoriteCount}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 22, '& .MuiChip-icon': { color: '#e91e63' } }}
            />
          )}
          {product.orderCount && (
            <Chip
              icon={<ShoppingCart size={11} />}
              label={product.orderCount}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 22, '& .MuiChip-icon': { color: '#4caf50' } }}
            />
          )}
          {product.pageViewCount && (
            <Chip
              icon={<Eye size={11} />}
              label={product.pageViewCount}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 22, '& .MuiChip-icon': { color: '#2196f3' } }}
            />
          )}
          {product.basketCount && (
            <Chip
              icon={<ShoppingCart size={11} />}
              label={`🛒 ${product.basketCount}`}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 22 }}
            />
          )}
        </Box>

        {/* Mobile expandable details */}
        {isMobile && (
          <>
            <Box
              onClick={onToggle}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                mt: 1, cursor: 'pointer', color: 'text.secondary',
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {expanded ? t('showLess') : t('showMore')}
              </Typography>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Box>
            <Collapse in={expanded}>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {product.merchantName && (
                  <Typography variant="caption" color="text.secondary">
                    {t('seller')}: {product.merchantName}
                  </Typography>
                )}
                {product.rushDelivery && (
                  <Chip
                    icon={<Timer size={11} />}
                    label={t('rushDelivery')}
                    size="small"
                    color="warning"
                    sx={{ fontSize: '0.65rem', height: 22, width: 'fit-content' }}
                  />
                )}
                {product.sameDayShipping && (
                  <Chip
                    icon={<Zap size={11} />}
                    label={t('sameDayShipping')}
                    size="small"
                    color="success"
                    sx={{ fontSize: '0.65rem', height: 22, width: 'fit-content' }}
                  />
                )}
                {product.productAttributes && product.productAttributes.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {product.productAttributes.slice(0, 4).map((attr, i) => (
                      <Chip
                        key={i}
                        label={`${attr.attributeName}: ${attr.attributeValueName}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 20 }}
                      />
                    ))}
                  </Box>
                )}
                <Button
                  href={product.url}
                  target="_blank"
                  rel="noopener"
                  size="small"
                  variant="outlined"
                  startIcon={<ExternalLink size={12} />}
                  sx={{ mt: 0.5, fontSize: '0.7rem', textTransform: 'none' }}
                >
                  {t('viewOnTrendyol')}
                </Button>
              </Box>
            </Collapse>
          </>
        )}

        {/* Desktop: always show link */}
        {!isMobile && (
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {product.rushDelivery && (
              <Tooltip title={t('rushDelivery')}>
                <Timer size={14} color="#ff9800" />
              </Tooltip>
            )}
            {product.sameDayShipping && (
              <Tooltip title={t('sameDayShipping')}>
                <Zap size={14} color="#4caf50" />
              </Tooltip>
            )}
            <IconButton
              href={product.url}
              target="_blank"
              rel="noopener"
              size="small"
              sx={{ ml: 'auto' }}
            >
              <ExternalLink size={14} />
            </IconButton>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

// ================================================================
// MAIN COMPONENT
// ================================================================

export default function CategoryExplorer() {
  const t = useTranslations('trendyolResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [activeGroup, setActiveGroup] = useState<string>(CATEGORY_GROUPS[0]);
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);

  // Store
  const selectedSlug = useTrendyolResearchStore(s => s.selectedSlug);
  const selectedLabel = useTrendyolResearchStore(s => s.selectedLabel);
  const totalCount = useTrendyolResearchStore(s => s.totalCount);
  const loading = useTrendyolResearchStore(s => s.loading);
  const analysis = useTrendyolResearchStore(s => s.analysis);
  const aiReport = useTrendyolResearchStore(s => s.aiReport);
  const aiReportLoading = useTrendyolResearchStore(s => s.aiReportLoading);
  const sortBy = useTrendyolResearchStore(s => s.sortBy);
  const brandFilter = useTrendyolResearchStore(s => s.brandFilter);
  const savedSearches = useTrendyolResearchStore(s => s.savedSearches);

  const browseCategory = useTrendyolResearchStore(s => s.browseCategory);
  const loadMorePages = useTrendyolResearchStore(s => s.loadMorePages);
  const generateAiReport = useTrendyolResearchStore(s => s.generateAiReport);
  const saveCategorySearch = useTrendyolResearchStore(s => s.saveCategorySearch);
  const loadSavedSearches = useTrendyolResearchStore(s => s.loadSavedSearches);
  const setSortBy = useTrendyolResearchStore(s => s.setSortBy);
  const setBrandFilter = useTrendyolResearchStore(s => s.setBrandFilter);

  const sortedProducts = useSortedProducts();

  // Load saved searches on mount
  useEffect(() => {
    loadSavedSearches();
  }, [loadSavedSearches]);

  // Categories for the active group
  const groupCategories = useMemo(
    () => TRENDYOL_CATEGORIES.filter(c => c.group === activeGroup),
    [activeGroup],
  );

  // Unique brands for filter dropdown
  const uniqueBrands = useMemo(() => {
    const brands = new Set<string>();
    sortedProducts.forEach(p => { if (p.brand) brands.add(p.brand); });
    return Array.from(brands).sort();
  }, [sortedProducts]);

  // Is current search saved?
  const isSaved = savedSearches.some(s => s.slug === selectedSlug);

  // Handle category click
  const handleCategoryClick = (slug: string, label: string) => {
    setBrandFilter('');
    setSortBy('default');
    setExpandedCardId(null);
    browseCategory(slug, label, 1);
  };

  return (
    <Box>
      {/* ---- Saved Searches ---- */}
      {savedSearches.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', mb: 0.5, display: 'block' }}>
            {t('savedSearches')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {savedSearches.slice(0, 8).map(s => (
              <Chip
                key={s.slug}
                icon={<BookmarkCheck size={12} />}
                label={`${s.label} (${s.productCount})`}
                size="small"
                onClick={() => handleCategoryClick(s.slug, s.label)}
                sx={{
                  fontWeight: 600, fontSize: '0.7rem',
                  bgcolor: selectedSlug === s.slug ? '#667eea' : undefined,
                  color: selectedSlug === s.slug ? '#fff' : undefined,
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ---- Category Group Selector ---- */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {CATEGORY_GROUPS.map(group => (
          <Chip
            key={group}
            icon={GROUP_ICONS[group] as React.ReactElement}
            label={group}
            onClick={() => setActiveGroup(group)}
            sx={{
              fontWeight: 700, fontSize: '0.78rem',
              bgcolor: activeGroup === group ? GROUP_COLORS[group] : undefined,
              color: activeGroup === group ? '#fff' : undefined,
              border: activeGroup === group ? 'none' : '1px solid #e0e0e0',
              '& .MuiChip-icon': {
                color: activeGroup === group ? '#fff' : GROUP_COLORS[group],
              },
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: activeGroup === group ? GROUP_COLORS[group] : 'rgba(0,0,0,0.04)',
              },
            }}
          />
        ))}
      </Box>

      {/* ---- Category Cards for Selected Group ---- */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 1,
        mb: 2,
      }}>
        {groupCategories.map(cat => (
          <Paper
            key={cat.slug}
            onClick={() => handleCategoryClick(cat.slug, cat.labelTr)}
            sx={{
              ...glassCard,
              p: 1.5,
              cursor: 'pointer',
              textAlign: 'center',
              bgcolor: selectedSlug === cat.slug ? GROUP_COLORS[activeGroup] : undefined,
              color: selectedSlug === cat.slug ? '#fff' : undefined,
              '&:hover': {
                ...glassCard['&:hover'],
                bgcolor: selectedSlug === cat.slug
                  ? GROUP_COLORS[activeGroup]
                  : `${GROUP_COLORS[activeGroup]}10`,
              },
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>
              {cat.labelTr}
            </Typography>
            <Typography variant="caption" sx={{
              opacity: selectedSlug === cat.slug ? 0.85 : 0.6,
              fontSize: '0.65rem',
            }}>
              {cat.label}
            </Typography>
          </Paper>
        ))}
      </Box>

      {/* ---- Loading Skeleton ---- */}
      {loading && sortedProducts.length === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
          <CircularProgress sx={{ color: GROUP_COLORS[activeGroup] }} />
          <Typography variant="body2" color="text.secondary">{t('loadingProducts')}</Typography>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 2, width: '100%', mt: 1,
          }}>
            {[1, 2, 3].map(i => (
              <Skeleton key={i} variant="rounded" height={280} sx={{ borderRadius: '16px' }} />
            ))}
          </Box>
        </Box>
      )}

      {/* ---- Results Section ---- */}
      {sortedProducts.length > 0 && (
        <>
          {/* Stats Bar */}
          {analysis && (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
              gap: 1, mb: 2,
            }}>
              <StatBadge
                icon={<Package size={14} />}
                label={t('totalProducts')}
                value={totalCount.toLocaleString('tr-TR')}
                color="#667eea"
              />
              <StatBadge
                icon={<TrendingUp size={14} />}
                label={t('avgPrice')}
                value={formatTRY(analysis.priceStats.avg)}
                color="#f2994a"
              />
              <StatBadge
                icon={<Users size={14} />}
                label={t('uniqueSellers')}
                value={analysis.uniqueMerchants.toLocaleString('tr-TR')}
                color="#2196f3"
              />
              <StatBadge
                icon={<Tag size={14} />}
                label={t('uniqueBrands')}
                value={analysis.uniqueBrands.toLocaleString('tr-TR')}
                color="#9c27b0"
              />
              <StatBadge
                icon={<Star size={14} />}
                label={t('avgRating')}
                value={analysis.avgRating.toFixed(1)}
                color="#ff9800"
              />
              <StatBadge
                icon={<Truck size={14} />}
                label={t('freeShippingPct')}
                value={`${Math.round(analysis.freeShippingPct)}%`}
                color="#4caf50"
              />
            </Box>
          )}

          {/* Sort & Filter Row */}
          <Box sx={{
            display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>{t('sortBy')}</InputLabel>
              <Select
                value={sortBy}
                label={t('sortBy')}
                onChange={e => setSortBy(e.target.value as any)}
              >
                <MenuItem value="default">{t('sortDefault')}</MenuItem>
                <MenuItem value="price_asc">{t('sortPriceAsc')}</MenuItem>
                <MenuItem value="price_desc">{t('sortPriceDesc')}</MenuItem>
                <MenuItem value="rating">{t('sortRating')}</MenuItem>
                <MenuItem value="favorites">{t('sortFavorites')}</MenuItem>
                <MenuItem value="orders">{t('sortOrders')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>{t('filterBrand')}</InputLabel>
              <Select
                value={brandFilter}
                label={t('filterBrand')}
                onChange={e => setBrandFilter(e.target.value)}
                MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
              >
                <MenuItem value="">{t('allBrands')}</MenuItem>
                {uniqueBrands.map(brand => (
                  <MenuItem key={brand} value={brand}>{brand}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
              <Button
                variant={isSaved ? 'contained' : 'outlined'}
                size="small"
                startIcon={isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                onClick={saveCategorySearch}
                sx={{
                  textTransform: 'none', fontWeight: 600, fontSize: '0.75rem',
                  ...(isSaved && { bgcolor: '#667eea', '&:hover': { bgcolor: '#5a6fd6' } }),
                }}
              >
                {isSaved ? t('saved') : t('saveSearch')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={aiReportLoading ? <CircularProgress size={14} /> : <Sparkles size={14} />}
                onClick={() => generateAiReport(selectedLabel)}
                disabled={aiReportLoading}
                sx={{
                  textTransform: 'none', fontWeight: 600, fontSize: '0.75rem',
                  borderColor: '#667eea', color: '#667eea',
                }}
              >
                {t('generateAiReport')}
              </Button>
            </Box>
          </Box>

          {/* AI Report */}
          {aiReport && (
            <Paper sx={{ ...glassCard, p: 2, mb: 2, borderLeft: '4px solid #667eea' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Sparkles size={16} color="#667eea" /> {t('aiMarketReport')}
              </Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'text.secondary' }}
              >
                {aiReport}
              </Typography>
            </Paper>
          )}

          {/* Product Grid */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
            },
            gap: 2,
            mb: 2,
          }}>
            {sortedProducts.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                isMobile={isMobile}
                expanded={expandedCardId === product.id}
                onToggle={() => setExpandedCardId(prev => prev === product.id ? null : product.id)}
                t={t}
              />
            ))}
          </Box>

          {/* Load More */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Button
              variant="outlined"
              onClick={() => loadMorePages(3)}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : <ChevronDown size={16} />}
              sx={{
                textTransform: 'none', fontWeight: 600, px: 4, py: 1,
                borderRadius: '24px', borderColor: '#667eea', color: '#667eea',
              }}
            >
              {loading ? t('loadingMore') : t('loadMore')}
            </Button>
          </Box>
        </>
      )}

      {/* ---- Empty State ---- */}
      {!loading && sortedProducts.length === 0 && selectedSlug && (
        <Paper sx={{ ...glassCard, p: 4, textAlign: 'center' }}>
          <BarChart2 size={48} color="#ccc" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 2 }}>
            {t('noProducts')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('noProductsDesc')}
          </Typography>
        </Paper>
      )}

      {/* ---- Initial State (no category selected) ---- */}
      {!loading && !selectedSlug && sortedProducts.length === 0 && (
        <Paper sx={{ ...glassCard, p: 4, textAlign: 'center' }}>
          <Package size={48} color="#667eea" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 2 }}>
            {t('selectCategory')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('selectCategoryDesc')}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
