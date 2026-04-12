import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Box, CircularProgress, Typography, useMediaQuery, useTheme,
  TextField, InputAdornment, Button, Tabs, Tab,
} from '@mui/material';
import { Search, BarChart2, Link, Store } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { useTranslations } from 'next-intl';

// Lazy load sub-components
const UnifiedResearch = lazy(() => import('@/components/etsy/research/UnifiedResearch'));
const ListingGrader = lazy(() => import('@/components/etsy/research/ListingGrader'));
const CompetitorIntelligence = lazy(() => import('@/components/etsy/research/CompetitorIntelligence'));
const AiOptimizePanel = lazy(() => import('@/components/etsy/research/AiOptimizePanel'));

const GRADIENTS = {
  primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
};

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
      background: GRADIENTS.primary, color: '#fff',
      border: '1px solid transparent', fontWeight: 700,
      boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
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
  const { setQuery, parallelSearch, fetchDiscoveryData } = useEtsyResearchStore();

  // Map activeView to tab index
  const tabIndex = activeView === 'research' ? 0 : activeView === 'grader' ? 1 : 2;
  const handleTabChange = (_: any, newValue: number) => {
    setActiveView(newValue === 0 ? 'research' : newValue === 1 ? 'grader' : 'shopIntel');
  };

  // Auto-fetch discovery data on mount
  useEffect(() => { fetchDiscoveryData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Toaster position="top-right" />
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
              onNavigateToShopIntel={() => setActiveView('shopIntel')}
            />
          )}
          {activeView === 'grader' && (
            <ListingGrader shopId={selectedShopId} userListings={listings} />
          )}
          {activeView === 'shopIntel' && (
            <CompetitorIntelligence />
          )}
        </Suspense>

        {/* Floating AI Panel */}
        <Suspense fallback={null}>
          <AiOptimizePanel />
        </Suspense>
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
    <Box sx={{
      background: GRADIENTS.primary, borderRadius: '16px', p: { xs: 1.5, md: 2 }, mb: 2,
      position: 'relative', overflow: 'hidden',
    }}>
      <Box sx={{ position: 'absolute', top: -30, right: -30, width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)' }} />
      <Box sx={{ p: { xs: 1.5, md: 2 }, borderRadius: '12px', bgcolor: '#fff', position: 'relative', zIndex: 1 }}>
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
              background: GRADIENTS.primary, borderRadius: '10px', px: 3,
              boxShadow: '0 4px 12px rgba(102,126,234,0.4)',
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
