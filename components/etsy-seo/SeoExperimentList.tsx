import React, { useCallback, useEffect, useState } from 'react';
import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import SeoExperimentCard from './SeoExperimentCard';
import type { SeoExperimentItem } from './types';

const FILTERS = ['all', 'collecting', 'ready'] as const;
type Filter = (typeof FILTERS)[number];

/** SEO experiments for one shop (or all of the user's shops). */
export default function SeoExperimentList({ shopId }: { shopId?: string }) {
  const t = useTranslations('seoExperiments');
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<SeoExperimentItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (shopId) qs.set('shop_id', shopId);
      const res = await fetch(`/api/etsy/seo-experiments?${qs.toString()}`, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setItems(body.items || []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [shopId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // New cohorts start when listings change; refresh quietly.
  useLiveRevalidate(['listing.changed'], load, { throttleMs: 10_000 });

  const visible = (items || []).filter((e) =>
    filter === 'all' ? true : filter === 'ready' ? e.status === 'ready' : e.status === 'collecting' || e.status === 'low_traffic',
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography variant="body2" color="text.secondary">
        {t('intro')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={t(`filters.${f}`)}
            size="small"
            color={filter === f ? 'primary' : 'default'}
            variant={filter === f ? 'filled' : 'outlined'}
            onClick={() => setFilter(f)}
            sx={{ minHeight: 32 }}
          />
        ))}
      </Box>
      {error && !items ? (
        <ErrorState compact error={error} title={t('loadFailed')} onRetry={load} />
      ) : items === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : visible.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {t('empty')}
        </Typography>
      ) : (
        visible.map((e) => <SeoExperimentCard key={e.id} exp={e} />)
      )}
    </Box>
  );
}
