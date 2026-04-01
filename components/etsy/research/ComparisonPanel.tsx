import React, { useMemo } from 'react';
import {
  Box, Typography, IconButton, Collapse, Chip, LinearProgress,
  useTheme, useMediaQuery,
} from '@mui/material';
import { X, Pin, TrendingUp, TrendingDown, Minus, DollarSign, Heart, Eye, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { GRADIENTS, glassCard } from './shared/ui';

function pctDiff(val: number, avg: number): { pct: number; dir: 'up' | 'down' | 'same' } {
  if (!avg || !val) return { pct: 0, dir: 'same' };
  const pct = ((val - avg) / avg) * 100;
  return { pct: Math.abs(pct), dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'same' };
}

function DiffChip({ val, avg, higherIsBetter = true }: { val: number; avg: number; higherIsBetter?: boolean }) {
  const { pct, dir } = pctDiff(val, avg);
  const t = useTranslations('etsy.comparisonPanel');
  if (dir === 'same') return <Chip size="small" label={`≈ ${t('average')}`} sx={{ fontSize: '0.7rem' }} />;
  const isGood = (dir === 'up') === higherIsBetter;
  const Icon = dir === 'up' ? TrendingUp : TrendingDown;
  return (
    <Chip
      size="small"
      icon={<Icon size={12} />}
      label={`${dir === 'up' ? '+' : '-'}${pct.toFixed(0)}%`}
      sx={{
        fontSize: '0.7rem', fontWeight: 600,
        bgcolor: isGood ? 'rgba(17,153,142,0.1)' : 'rgba(235,51,73,0.1)',
        color: isGood ? '#11998e' : '#eb3349',
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
}

function StatRow({ label, icon: Icon, yours, market, higherIsBetter = true, format = (v: number) => String(v) }: {
  label: string;
  icon: any;
  yours: number;
  market: number;
  higherIsBetter?: boolean;
  format?: (v: number) => string;
}) {
  const t = useTranslations('etsy.comparisonPanel');
  const max = Math.max(yours, market) || 1;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Icon size={14} color="#667eea" />
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#555' }}>{label}</Typography>
        </Box>
        <DiffChip val={yours} avg={market} higherIsBetter={higherIsBetter} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#999' }}>{t('yours')}</Typography>
          <LinearProgress
            variant="determinate"
            value={(yours / max) * 100}
            sx={{
              height: 6, borderRadius: 3,
              bgcolor: 'rgba(102,126,234,0.1)',
              '& .MuiLinearProgress-bar': { background: GRADIENTS.primary, borderRadius: 3 },
            }}
          />
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>{format(yours)}</Typography>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#999' }}>{t('marketAvg')}</Typography>
          <LinearProgress
            variant="determinate"
            value={(market / max) * 100}
            sx={{
              height: 6, borderRadius: 3,
              bgcolor: 'rgba(0,0,0,0.06)',
              '& .MuiLinearProgress-bar': { bgcolor: '#999', borderRadius: 3 },
            }}
          />
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: '#666' }}>{format(market)}</Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function ComparisonPanel() {
  const t = useTranslations('etsy.comparisonPanel');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const pinnedListing = useEtsyResearchStore((s) => s.pinnedListing);
  const comparisonVisible = useEtsyResearchStore((s) => s.comparisonVisible);
  const pinListing = useEtsyResearchStore((s) => s.pinListing);
  const toggleComparison = useEtsyResearchStore((s) => s.toggleComparison);
  const items = useEtsyResearchStore((s) => s.items);

  const marketAvg = useMemo(() => {
    if (!items.length) return { price: 0, favorites: 0, views: 0, tags: 0 };
    const sum = items.reduce(
      (acc, item) => ({
        price: acc.price + (item.price || 0),
        favorites: acc.favorites + (item.num_favorers || 0),
        views: acc.views + (item.views || 0),
        tags: acc.tags + (item.tags?.length || 0),
      }),
      { price: 0, favorites: 0, views: 0, tags: 0 }
    );
    const n = items.length;
    return { price: sum.price / n, favorites: sum.favorites / n, views: sum.views / n, tags: sum.tags / n };
  }, [items]);

  if (!pinnedListing) return null;

  const yourPrice = pinnedListing.price || 0;
  const yourFavs = pinnedListing.num_favorers || 0;
  const yourViews = pinnedListing.views || 0;
  const yourTags = pinnedListing.tags?.length || 0;

  return (
    <Collapse in={comparisonVisible}>
      <Box sx={{
        ...glassCard,
        p: 2, mb: 2,
        border: '2px solid rgba(102,126,234,0.3)',
        background: 'rgba(255,255,255,0.92)',
      }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Pin size={16} color="#667eea" />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('comparison')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => pinListing(null)}>
            <X size={16} />
          </IconButton>
        </Box>

        {/* Pinned listing title */}
        <Typography
          variant="caption"
          sx={{
            display: 'block', mb: 1.5, color: '#667eea', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          📌 {pinnedListing.title}
        </Typography>

        {/* Comparison rows */}
        <Box sx={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <StatRow
            label={t('price')}
            icon={DollarSign}
            yours={yourPrice}
            market={marketAvg.price}
            higherIsBetter={false}
            format={(v) => `$${v.toFixed(2)}`}
          />
          <StatRow
            label={t('favorites')}
            icon={Heart}
            yours={yourFavs}
            market={marketAvg.favorites}
            format={(v) => v.toLocaleString()}
          />
          <StatRow
            label={t('views')}
            icon={Eye}
            yours={yourViews}
            market={marketAvg.views}
            format={(v) => v.toLocaleString()}
          />
          <StatRow
            label={t('tagCount')}
            icon={Tag}
            yours={yourTags}
            market={marketAvg.tags}
            format={(v) => v.toFixed(0)}
          />
        </Box>

        {/* Tag overlap analysis */}
        {pinnedListing.tags && pinnedListing.tags.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: '#555', mb: 0.5, display: 'block' }}>
              {t('yourTags')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {pinnedListing.tags.map((tag) => {
                const isCommon = items.some(
                  (item) => item.listing_id !== pinnedListing.listing_id && item.tags?.includes(tag)
                );
                return (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    sx={{
                      fontSize: '0.65rem', height: 22,
                      bgcolor: isCommon ? 'rgba(102,126,234,0.1)' : 'rgba(235,51,73,0.08)',
                      color: isCommon ? '#667eea' : '#eb3349',
                      fontWeight: isCommon ? 500 : 600,
                    }}
                  />
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: '#999', mt: 0.5, display: 'block', fontSize: '0.6rem' }}>
              {t('tagLegend')}
            </Typography>
          </Box>
        )}
      </Box>
    </Collapse>
  );
}
