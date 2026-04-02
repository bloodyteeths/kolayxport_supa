import React, { useEffect, useMemo } from 'react';
import {
  Box, Typography, Paper, Chip, Grid, IconButton, Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  Bookmark, Trash2, ShoppingBag, Tag, Shirt, Home, Smartphone,
  Sparkles, Baby, UtensilsCrossed, TrendingUp, Package, Users,
  BookOpen, Gamepad2, Pencil, Wrench, Hammer, Car, Dumbbell, Store,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useTrendyolResearchStore } from '@/lib/stores/useTrendyolResearchStore';

// ================================================================
// CONSTANTS
// ================================================================

const GROUP_ICONS: Record<string, React.ReactNode> = {
  'Aksesuar': <Tag size={16} />,
  'Anne & Bebek & Cocuk': <Baby size={16} />,
  'Ayakkabi': <ShoppingBag size={16} />,
  'Bahce & Elektrikli El Aletleri': <Wrench size={16} />,
  'Banyo Yapi & Hirdavat': <Hammer size={16} />,
  'Elektronik': <Smartphone size={16} />,
  'Ev & Mobilya': <Home size={16} />,
  'Giyim': <Shirt size={16} />,
  'Hobi & Eglence': <Gamepad2 size={16} />,
  'Kirtasiye & Ofis Malzemeleri': <Pencil size={16} />,
  'Kitap': <BookOpen size={16} />,
  'Kozmetik & Kisisel Bakim': <Sparkles size={16} />,
  'Otomobil & Motosiklet': <Car size={16} />,
  'Spor & Outdoor': <Dumbbell size={16} />,
  'Supermarket': <Store size={16} />,
};

const GROUP_COLORS: Record<string, string> = {
  'Aksesuar': '#e91e63',
  'Anne & Bebek & Cocuk': '#4caf50',
  'Ayakkabi': '#795548',
  'Bahce & Elektrikli El Aletleri': '#607d8b',
  'Banyo Yapi & Hirdavat': '#9e9e9e',
  'Elektronik': '#2196f3',
  'Ev & Mobilya': '#667eea',
  'Giyim': '#f44336',
  'Hobi & Eglence': '#ff9800',
  'Kirtasiye & Ofis Malzemeleri': '#00bcd4',
  'Kitap': '#8bc34a',
  'Kozmetik & Kisisel Bakim': '#9c27b0',
  'Otomobil & Motosiklet': '#455a64',
  'Spor & Outdoor': '#ff5722',
  'Supermarket': '#f2994a',
};

const TRENDYOL_ORANGE = '#F27A1A';

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

function relativeTime(
  timestamp: number,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return t('agoMinutes', { count: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('agoHours', { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t('agoDays', { count: diffDays });
}

// ================================================================
// COMPONENT
// ================================================================

interface DashboardProps {
  onNavigate?: (navId: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const t = useTranslations('trendyolResearch');
  const {
    savedSearches,
    products,
    analysis,
    categoryTree,
    categoryTreeLoading,
    loadSavedSearches,
    removeSavedSearch,
    browseCategory,
    fetchCategoryTree,
  } = useTrendyolResearchStore();

  useEffect(() => {
    loadSavedSearches();
    fetchCategoryTree();
  }, [loadSavedSearches, fetchCategoryTree]);

  // Group categories by top-level (depth 0 → their depth 1 children)
  const groupedCategories = useMemo(() => {
    const topLevel = categoryTree.filter(c => c.depth === 0);
    const groups: Record<string, Array<{ slug: string; name: string }>> = {};
    for (const parent of topLevel) {
      const children = categoryTree
        .filter(c => c.depth === 1 && c.parentPath.startsWith(parent.name + ' > '))
        .slice(0, 6) // Show first 6 subcategories per group
        .map(c => ({ slug: c.slug, name: c.name }));
      if (children.length > 0) {
        groups[parent.name] = children;
      }
    }
    return groups;
  }, [categoryTree]);

  // Quick stats from analysis
  const stats = useMemo(() => {
    if (!products.length || !analysis) return null;
    return {
      totalProducts: products.length,
      uniqueBrands: analysis.uniqueBrands,
      avgPrice: analysis.priceStats.avg,
      minPrice: analysis.priceStats.min,
      maxPrice: analysis.priceStats.max,
    };
  }, [products, analysis]);

  const handleBrowse = (slug: string, label: string) => {
    browseCategory(slug, label);
    onNavigate?.('category');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* ── Section 1: Saved Searches ── */}
      <Paper
        sx={{
          p: 3,
          borderRadius: '16px',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Bookmark size={20} color={TRENDYOL_ORANGE} />
          <Typography variant="h6" fontWeight={600}>
            {t('savedSearches')}
          </Typography>
        </Box>

        {savedSearches.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('noSavedSearches')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {savedSearches.map((search) => (
              <Chip
                key={search.slug}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>{search.label}</span>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ opacity: 0.7 }}
                    >
                      ({search.productCount} {t('products')})
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ opacity: 0.5 }}
                    >
                      {relativeTime(search.timestamp, t)}
                    </Typography>
                  </Box>
                }
                onClick={() => handleBrowse(search.slug, search.label)}
                onDelete={() => removeSavedSearch(search.slug)}
                deleteIcon={
                  <Tooltip title="Remove">
                    <IconButton size="small" sx={{ p: 0.25 }}>
                      <Trash2 size={14} />
                    </IconButton>
                  </Tooltip>
                }
                variant="outlined"
                sx={{
                  borderColor: TRENDYOL_ORANGE,
                  color: TRENDYOL_ORANGE,
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: `${TRENDYOL_ORANGE}10`,
                  },
                }}
              />
            ))}
          </Box>
        )}
      </Paper>

      {/* ── Section 2: Popular Categories ── */}
      <Paper
        sx={{
          p: 3,
          borderRadius: '16px',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <ShoppingBag size={20} color={TRENDYOL_ORANGE} />
          <Typography variant="h6" fontWeight={600}>
            {t('popularCategories')}
          </Typography>
        </Box>

        {categoryTreeLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ color: TRENDYOL_ORANGE }} />
          </Box>
        ) : (
          <Grid container spacing={2}>
            {Object.entries(groupedCategories).map(([group, categories]) => {
              const color = GROUP_COLORS[group] || TRENDYOL_ORANGE;
              const icon = GROUP_ICONS[group] || <Tag size={16} />;
              const totalChildren = categoryTree.filter(c =>
                c.depth === 1 && c.parentPath.startsWith(group + ' > ')
              ).length;

              return (
                <Grid item xs={12} sm={6} md={4} key={group}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: '12px',
                      borderColor: `${color}40`,
                      height: '100%',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        mb: 1.5,
                      }}
                    >
                      <Box sx={{ color }}>{icon}</Box>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {group}
                      </Typography>
                      <Typography variant="caption" sx={{ ml: 'auto', color: 'text.disabled' }}>
                        {totalChildren}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {categories.map((cat) => (
                        <Chip
                          key={cat.slug}
                          label={cat.name}
                          size="small"
                          onClick={() => handleBrowse(cat.slug, cat.name)}
                          sx={{
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            borderColor: `${color}60`,
                            color,
                            '&:hover': {
                              backgroundColor: `${color}15`,
                            },
                          }}
                          variant="outlined"
                        />
                      ))}
                      {totalChildren > 6 && (
                        <Chip
                          label={`+${totalChildren - 6}`}
                          size="small"
                          onClick={() => {
                            onNavigate?.('category');
                          }}
                          sx={{
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'text.secondary',
                          }}
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Paper>

      {/* ── Section 3: Quick Overview Stats ── */}
      {stats && (
        <Paper
          sx={{
            p: 3,
            borderRadius: '16px',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <TrendingUp size={20} color={TRENDYOL_ORANGE} />
            <Typography variant="h6" fontWeight={600}>
              {t('quickOverview')}
            </Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ color: TRENDYOL_ORANGE, mb: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <Package size={24} />
                </Box>
                <Typography variant="h5" fontWeight={700}>
                  {stats.totalProducts.toLocaleString('tr-TR')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('totalProducts')}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ color: '#667eea', mb: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <Users size={24} />
                </Box>
                <Typography variant="h5" fontWeight={700}>
                  {stats.uniqueBrands.toLocaleString('tr-TR')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('uniqueBrands')}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ color: '#4caf50', mb: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <Tag size={24} />
                </Box>
                <Typography variant="h5" fontWeight={700}>
                  {formatTRY(stats.avgPrice)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('avgPrice')}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Box sx={{ color: '#e91e63', mb: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <TrendingUp size={24} />
                </Box>
                <Typography variant="h5" fontWeight={700}>
                  {formatTRY(stats.minPrice)} - {formatTRY(stats.maxPrice)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('priceRange')}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}
    </Box>
  );
}
