import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Box, Button, Chip, CircularProgress, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { Activity } from 'lucide-react';
import { useTranslations } from 'next-intl';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import ConnectEmptyState from '@/components/ui/ConnectEmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { useConnections } from '@/lib/hooks/useConnections';
import { useLiveEvent } from '@/components/live/useLiveEvent';
import ActivityFeedCard from '@/components/etsy-history/ActivityFeedCard';
import CacheFreshnessChip from '@/components/etsy-history/CacheFreshnessChip';
import { fetchJson, type ActivityItem } from '@/components/etsy-history/types';
import SeoExperimentList from '@/components/etsy-seo/SeoExperimentList';

type Tab = 'changes' | 'seo';
const ATTRIBUTION_FILTERS = ['all', 'external', 'kolayxport_draft', 'kolayxport_stock', 'unknown'] as const;
type AttributionFilter = (typeof ATTRIBUTION_FILTERS)[number];
type ShopInfo = { shopId: string; shopName: string };
type ActivityResponse = { items: ActivityItem[]; nextCursor: string | null };

function ChangesFeed({ shopId }: { shopId: string }) {
  const t = useTranslations('listingHistory');
  const [filter, setFilter] = useState<AttributionFilter>('all');
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = useCallback(
    (c?: string | null) => {
      const qs = new URLSearchParams();
      if (shopId) qs.set('shop_id', shopId);
      if (filter !== 'all') qs.set('attribution', filter);
      if (c) qs.set('cursor', c);
      return `/api/etsy/activity?${qs.toString()}`;
    },
    [shopId, filter],
  );

  const loadFirst = useCallback(async () => {
    try {
      const data = await fetchJson<ActivityResponse>(url());
      setItems(data.items);
      setCursor(data.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [url]);

  useEffect(() => {
    setItems(null);
    void loadFirst();
  }, [loadFirst]);

  // Live: prepend new changes without disturbing pages the user already loaded.
  const mergeLatest = useCallback(async () => {
    try {
      const data = await fetchJson<ActivityResponse>(url());
      setItems((prev) => {
        if (!prev) return data.items;
        const known = new Set(prev.map((i) => i.id));
        const added = data.items.filter((i) => !known.has(i.id));
        if (!added.length) return prev;
        setFresh(new Set(added.map((a) => a.id)));
        if (freshTimer.current) clearTimeout(freshTimer.current);
        freshTimer.current = setTimeout(() => setFresh(new Set()), 4000);
        return [...added, ...prev];
      });
    } catch {
      /* the next event or reconnect retries */
    }
  }, [url]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvent(['listing.changed', 'listing.removed', 'sync.finished', 'sync.status'], (event) => {
    if (event.type === 'listing' && shopId && event.shopId !== shopId) return;
    if (event.type === 'sync' && event.kind === 'status' && event.phase !== 'reconnected' && event.phase !== 'polling') return;
    // Versions are written right before the event; a short debounce batches bursts (bulk syncs).
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void mergeLatest(), 800);
  });

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      if (freshTimer.current) clearTimeout(freshTimer.current);
    },
    [],
  );

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchJson<ActivityResponse>(url(cursor));
      setItems((prev) => {
        const known = new Set((prev || []).map((i) => i.id));
        return [...(prev || []), ...data.items.filter((i) => !known.has(i.id))];
      });
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 0.5, WebkitOverflowScrolling: 'touch' }}>
        {ATTRIBUTION_FILTERS.map((f) => (
          <Chip
            key={f}
            label={t(`filters.${f}`)}
            size="small"
            color={filter === f ? 'primary' : 'default'}
            variant={filter === f ? 'filled' : 'outlined'}
            onClick={() => setFilter(f)}
            sx={{ minHeight: 32, flexShrink: 0 }}
          />
        ))}
      </Box>
      {error && !items ? (
        <ErrorState compact error={error} title={t('errors.loadFailed')} onRetry={loadFirst} />
      ) : items === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {t('activity.empty')}
        </Typography>
      ) : (
        <>
          {items.map((item) => (
            <ActivityFeedCard key={item.id} item={item} highlight={fresh.has(item.id)} />
          ))}
          {cursor && (
            <Button onClick={loadMore} disabled={loadingMore} sx={{ textTransform: 'none', minHeight: 44 }}>
              {loadingMore ? <CircularProgress size={18} /> : t('activity.loadMore')}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}

function EtsyActivityPage() {
  const t = useTranslations('listingHistory');
  const router = useRouter();
  const { has } = useConnections();
  const etsyConnected = has('etsy');
  const tab: Tab = router.query.tab === 'seo' ? 'seo' : 'changes';
  const [shops, setShops] = useState<ShopInfo[] | null>(null);
  const [shopId, setShopId] = useState<string>('');

  useEffect(() => {
    if (etsyConnected === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/integrations/etsy/shops', { credentials: 'same-origin' });
        const data = res.ok ? await res.json() : { shops: [] };
        if (cancelled) return;
        const list: ShopInfo[] = (data.shops || [])
          .filter((s: any) => s.isActive !== false)
          .map((s: any) => ({ shopId: String(s.shopId), shopName: s.shopName || String(s.shopId) }));
        setShops(list);
        if (list.length === 1) setShopId(list[0].shopId);
      } catch {
        if (!cancelled) setShops([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [etsyConnected]);

  const setTab = (next: Tab) => {
    void router.replace({ pathname: router.pathname, query: { ...router.query, tab: next } }, undefined, { shallow: true, scroll: false });
  };

  const freshnessShop = useMemo(() => shopId || (shops && shops.length ? shops[0].shopId : ''), [shopId, shops]);

  return (
    <AppLayout title={t('pageTitle')}>
      <Box sx={{ p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 960, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box
            sx={{
              p: 1.25,
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Activity size={22} color="#fff" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
              {t('pageTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('pageSubtitle')}
            </Typography>
          </Box>
        </Box>

        {etsyConnected === false ? (
          <Paper sx={{ borderRadius: '12px' }}>
            <ConnectEmptyState provider="etsy" description={t('connectDescription')} />
          </Paper>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 0.75 }}>
                {(['changes', 'seo'] as const).map((k) => (
                  <Chip
                    key={k}
                    label={t(`tabs.${k}`)}
                    color={tab === k ? 'primary' : 'default'}
                    variant={tab === k ? 'filled' : 'outlined'}
                    onClick={() => setTab(k)}
                    sx={{ fontWeight: 700, minHeight: 36, borderRadius: '18px' }}
                  />
                ))}
              </Box>
              {shops && shops.length > 1 && (
                <TextField
                  select
                  size="small"
                  label={t('shopLabel')}
                  value={shopId}
                  onChange={(e) => setShopId(e.target.value)}
                  sx={{ minWidth: 160, ml: { sm: 'auto' } }}
                >
                  <MenuItem value="">{t('allShops')}</MenuItem>
                  {shops.map((s) => (
                    <MenuItem key={s.shopId} value={s.shopId}>
                      {s.shopName}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
            {freshnessShop && (
              <Box sx={{ mb: 1.5, maxWidth: '100%' }}>
                <CacheFreshnessChip shopId={freshnessShop} />
              </Box>
            )}

            {shops === null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={24} />
              </Box>
            ) : tab === 'changes' ? (
              <ChangesFeed shopId={shopId} />
            ) : (
              <SeoExperimentList shopId={shopId || undefined} />
            )}
          </>
        )}
      </Box>
    </AppLayout>
  );
}

export default withAuth(EtsyActivityPage);
