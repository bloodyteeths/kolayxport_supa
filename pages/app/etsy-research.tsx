import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Box, CircularProgress, Typography, useMediaQuery, useTheme,
  TextField, InputAdornment, Button, Tabs, Tab,
} from '@mui/material';
import { Search, BarChart2, Link, Store } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';

// Lazy load sub-components
const UnifiedResearch = lazy(() => import('@/components/etsy/research/UnifiedResearch'));
const ListingGrader = lazy(() => import('@/components/etsy/research/ListingGrader'));
const CompetitorIntelligence = lazy(() => import('@/components/etsy/research/CompetitorIntelligence'));

const pillTabsSx = {
  mb: 2,
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTabs-flexContainer': { gap: '6px', justifyContent: 'center' },
  '& .MuiTab-root': {
    minHeight: 40, borderRadius: '20px', textTransform: 'none' as const,
    fontSize: '0.9rem', fontWeight: 500, px: 2.5, py: 0.5,
    border: '1px solid #e0e0e0', color: '#666',
    transition: 'all 0.2s',
    '&.Mui-selected': {
      bgcolor: 'primary.main', color: 'primary.contrastText',
      border: '1px solid transparent', fontWeight: 700,
    },
  },
};

interface ShopInfo {
  shopId: string;
  shopName: string;
}

function EtsyResearchPage() {
  const { user } = useAuth();
  const t = useTranslations('etsyResearch');
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const activeView = useEtsyResearchStore(s => s.activeView);
  const setActiveView = useEtsyResearchStore(s => s.setActiveView);

  // Map activeView to tab index
  const tabIndex = activeView === 'research' ? 0 : activeView === 'grader' ? 1 : 2;

  // Persist the active tab in the URL (?tab=research|grader|shopIntel).
  const router = useRouter();
  const tabParam = typeof router.query.tab === 'string' ? router.query.tab : '';
  useEffect(() => {
    if (!router.isReady) return;
    if (tabParam === 'research' || tabParam === 'grader' || tabParam === 'shopIntel') {
      if (tabParam !== useEtsyResearchStore.getState().activeView) setActiveView(tabParam);
    }
  }, [router.isReady, tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeView = useCallback((view: 'research' | 'grader' | 'shopIntel') => {
    setActiveView(view);
    router.replace(
      { pathname: router.pathname, query: { ...router.query, tab: view } },
      undefined,
      { shallow: true, scroll: false },
    );
  }, [router, setActiveView]);

  const handleTabChange = (_: any, newValue: number) => {
    changeView(newValue === 0 ? 'research' : newValue === 1 ? 'grader' : 'shopIntel');
  };

  // R0: the "Trending Niches" discovery fetch was removed (hardcoded queries, not trends).

  // Fetch shops
  useEffect(() => {
    if (!(user as any)?.id) return;
    (async () => {
      try {
        const res = await fetch('/api/integrations/etsy/shops');
        if (!res.ok) return;
        const data = await res.json();
        const shopList: ShopInfo[] = (data.shops || []).map((s: any) => ({
          shopId: s.shopId,
          shopName: s.shopName || s.shopId,
        }));
        setShops(shopList);
        if (shopList.length > 0) setSelectedShopId(shopList[0].shopId);
      } catch (err) {
        console.error('Failed to fetch Etsy shops:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [(user as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch listings for grader/SEO
  useEffect(() => {
    if (!selectedShopId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=listings_with_images&shop_id=${selectedShopId}&limit=100&offset=0&state=active`
        );
        if (!res.ok) return;
        const data = await res.json();
        setListings(data.results || []);
      } catch (err) {
        console.error('Failed to fetch listings:', err);
      }
    })();
  }, [selectedShopId]);

  if (loading) {
    return (
      <AppLayout title={t('pageTitle')}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress />
        </Box>
      </AppLayout>
    );
  }

  if (shops.length === 0) {
    return (
      <AppLayout title={t('pageTitle')}>
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {t('noShopsConnected')}
          </Typography>
        </Box>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('pageTitle')}>
      <Box sx={{ maxWidth: 1400, mx: 'auto', width: '100%', p: { xs: 0.5, sm: 1, md: 1.5 } }}>
        {/* Horizontal pill tabs */}
        <Tabs value={tabIndex} onChange={handleTabChange} sx={pillTabsSx} variant="scrollable" scrollButtons="auto">
          <Tab icon={<BarChart2 size={16} />} iconPosition="start" label={t('tab_research')} />
          <Tab icon={<Link size={16} />} iconPosition="start" label={t('tab_grader')} />
          <Tab icon={<Store size={16} />} iconPosition="start" label={t('tab_shopIntel')} />
        </Tabs>

        {/* Search bar — shown for Research tab */}
        {activeView === 'research' && <SearchBar />}

        {/* Content */}
        <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
          {activeView === 'research' && (
            <UnifiedResearch
              userListings={listings}
              onNavigateToShopIntel={() => changeView('shopIntel')}
            />
          )}
          {activeView === 'grader' && (
            <ListingGrader shopId={selectedShopId} userListings={listings} />
          )}
          {activeView === 'shopIntel' && (
            <CompetitorIntelligence />
          )}
        </Suspense>

        {/* R0 (research.md §14.1): AiOptimizePanel FAB removed; AI help lives in Cmd+K. */}
      </Box>
    </AppLayout>
  );
}

function SearchBar() {
  const t = useTranslations('etsyResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const {
    query, minPrice, maxPrice, sortOn, loading,
    setQuery, setMinPrice, setMaxPrice, setSortOn, parallelSearch,
  } = useEtsyResearchStore();

  return (
    <Box sx={{ mb: 2 }}>
      {/* R0: gradient hero removed; plain bordered search surface. */}
      <Box sx={{ p: { xs: 1.5, md: 2 }, borderRadius: '12px', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label={t('whatAreYouSelling')}
            value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            size="small" sx={{ flex: 2, minWidth: isMobile ? '100%' : 200 }}
            placeholder={t('searchExamplePlaceholder')}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && parallelSearch()}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} color="#667eea" /></InputAdornment>,
            }}
          />
          {!isMobile && (
            <>
              <TextField label={t('minPriceLabel')} value={minPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinPrice(e.target.value)}
                size="small" type="number" sx={{ width: 80 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={t('maxPriceLabel')} value={maxPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxPrice(e.target.value)}
                size="small" type="number" sx={{ width: 80 }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={t('sorting')} value={sortOn} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOn(e.target.value)}
                size="small" select sx={{ width: 130 }} SelectProps={{ native: true }}>
                <option value="score">{t('bestMatch')}</option>
                <option value="price">{t('price')}</option>
                <option value="created">{t('newlyAdded')}</option>
                <option value="updated">{t('lastUpdated')}</option>
              </TextField>
            </>
          )}
          <Button variant="contained" onClick={parallelSearch}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
            sx={{
              borderRadius: '10px', px: 3,
              ...(isMobile && { width: '100%' }),
            }}
          >
            {t('research')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export default withAuth(EtsyResearchPage);
