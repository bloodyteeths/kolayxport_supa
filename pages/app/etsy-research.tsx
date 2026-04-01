import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Box, CircularProgress, Typography, Paper, List, ListItemButton,
  ListItemIcon, ListItemText, Drawer, IconButton, useMediaQuery, useTheme,
  TextField, InputAdornment, Button,
} from '@mui/material';
import {
  BarChart2, Hash, Store, Compass, Activity,
  TrendingUp, Target, Menu, ChevronLeft, LayoutDashboard, Search,
} from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';

// Lazy load sub-components for performance
const ResearchDashboard = lazy(() => import('@/components/etsy/research/ResearchDashboard'));
const NicheAnalyzer = lazy(() => import('@/components/etsy/research/NicheAnalyzer'));
const KeywordIntelligence = lazy(() => import('@/components/etsy/research/KeywordIntelligence'));
const CompetitorIntelligence = lazy(() => import('@/components/etsy/research/CompetitorIntelligence'));
const KeywordDiscovery = lazy(() => import('@/components/etsy/research/KeywordDiscovery'));
const TrendAnalyzer = lazy(() => import('@/components/etsy/research/TrendAnalyzer'));
const ListingSEO = lazy(() => import('@/components/etsy/research/ListingSEO'));

const GRADIENTS = {
  primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
};

interface ShopInfo {
  shopId: string;
  shopName: string;
}

// Section definitions matching the original structure
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: -1, tab: -1 },
  { id: 'niche', label: 'Niş Analizi', icon: BarChart2, section: 1, tab: 100, desc: 'Talep, fiyat ve rekabet' },
  { id: 'keywords', label: 'Kelime & Tag', icon: Hash, section: 1, tab: 101, desc: 'Tag boşlukları ve kelimeler' },
  { id: 'competitors', label: 'Mağaza & AI', icon: Store, section: 1, tab: 102, desc: 'Rakip analizi ve AI' },
  { id: 'discovery', label: 'Kelime Keşif', icon: Compass, section: 2, tab: 0, desc: 'Yeni kelimeler bul' },
  { id: 'trends', label: 'Trendler', icon: Activity, section: 2, tab: 1, desc: 'Mevsimsel analiz' },
  { id: 'seo', label: 'Mağazam', icon: Target, section: 0, tab: 9, desc: 'SEO, kâr, sıralama' },
];

const SIDEBAR_WIDTH = 220;

function EtsyResearchPage() {
  const { user } = useAuth();
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const { setQuery, searchMarket } = useEtsyResearchStore();

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
        if (shopList.length > 0) {
          setSelectedShopId(shopList[0].shopId);
        }
      } catch (err) {
        console.error('Failed to fetch Etsy shops:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [(user as any)?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch listings for Mağazam section
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

  const handleNavigate = useCallback((navId: string) => {
    setActiveNav(navId);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleNavigateFromDashboard = useCallback((section: number, tab?: number) => {
    const item = NAV_ITEMS.find(n => n.section === section && (tab === undefined || n.tab === tab));
    if (item) setActiveNav(item.id);
  }, []);

  const handleKeywordToSearch = useCallback((keyword: string) => {
    setQuery(keyword);
    setActiveNav('niche');
    setTimeout(() => searchMarket(), 100);
  }, [setQuery, searchMarket]);

  if (loading) {
    return (
      <AppLayout title="Etsy Araştırma | KolayXport">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress />
        </Box>
      </AppLayout>
    );
  }

  if (shops.length === 0) {
    return (
      <AppLayout title="Etsy Araştırma | KolayXport">
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            Henüz bağlı bir Etsy mağazanız yok. Ayarlar sayfasından bağlayın.
          </Typography>
        </Box>
      </AppLayout>
    );
  }

  const sidebarContent = (
    <Box sx={{ width: SIDEBAR_WIDTH, pt: 1 }}>
      {isMobile && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, mb: 1 }}>
          <IconButton onClick={() => setSidebarOpen(false)} size="small">
            <ChevronLeft size={20} />
          </IconButton>
        </Box>
      )}
      <List dense disablePadding>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <ListItemButton
              key={item.id}
              selected={isActive}
              onClick={() => handleNavigate(item.id)}
              sx={{
                mx: 1, mb: 0.5, borderRadius: '10px',
                minHeight: 44,
                ...(isActive ? {
                  background: GRADIENTS.primary,
                  color: '#fff',
                  '& .MuiListItemIcon-root': { color: '#fff' },
                  '& .MuiListItemText-secondary': { color: 'rgba(255,255,255,0.7)' },
                  boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
                } : {
                  '&:hover': { bgcolor: 'rgba(102,126,234,0.06)' },
                }),
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Icon size={18} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={!isMobile && item.desc ? item.desc : undefined}
                primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: isActive ? 700 : 500 }}
                secondaryTypographyProps={{ fontSize: '0.65rem' }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );

  const renderContent = () => {
    switch (activeNav) {
      case 'dashboard':
        return <ResearchDashboard onNavigateToSection={handleNavigateFromDashboard} />;
      case 'niche':
        return <NicheAnalyzer />;
      case 'keywords':
        return <KeywordIntelligence userListings={listings} />;
      case 'competitors':
        return <CompetitorIntelligence />;
      case 'discovery':
        return <KeywordDiscovery onNavigateToSearch={handleKeywordToSearch} />;
      case 'trends':
        return <TrendAnalyzer />;
      case 'seo':
        return <ListingSEO shopId={selectedShopId} userListings={listings} />;
      default:
        return <ResearchDashboard onNavigateToSection={handleNavigateFromDashboard} />;
    }
  };

  return (
    <AppLayout title="Etsy Araştırma | KolayXport">
      <Toaster position="top-right" />
      <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <Paper sx={{
            width: SIDEBAR_WIDTH, flexShrink: 0, borderRadius: 0,
            borderRight: '1px solid #eee', bgcolor: '#fafbfe',
            position: 'sticky', top: 64, height: 'calc(100vh - 64px)',
            overflowY: 'auto',
          }}>
            {sidebarContent}
          </Paper>
        )}

        {/* Mobile drawer */}
        {isMobile && (
          <Drawer
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            PaperProps={{ sx: { width: SIDEBAR_WIDTH, bgcolor: '#fafbfe' } }}
          >
            {sidebarContent}
          </Drawer>
        )}

        {/* Main content */}
        <Box sx={{ flex: 1, p: { xs: 1.5, sm: 2, md: 3 }, maxWidth: 1400, mx: 'auto', width: '100%' }}>
          {/* Mobile header with menu button */}
          {isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <IconButton onClick={() => setSidebarOpen(true)} sx={{ p: 0.5 }}>
                <Menu size={22} />
              </IconButton>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {NAV_ITEMS.find(n => n.id === activeNav)?.label || 'Dashboard'}
              </Typography>
            </Box>
          )}

          {/* Search bar — shown for analysis sections */}
          {['niche', 'keywords', 'competitors', 'discovery', 'trends'].includes(activeNav) && (
            <SearchBar />
          )}

          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
            {renderContent()}
          </Suspense>
        </Box>
      </Box>
    </AppLayout>
  );
}

function SearchBar() {
  const {
    query, minPrice, maxPrice, sortOn, loading,
    setQuery, setMinPrice, setMaxPrice, setSortOn, searchMarket,
  } = useEtsyResearchStore();

  return (
    <Box sx={{
      background: GRADIENTS.primary, borderRadius: '16px', p: { xs: 1.5, md: 2 }, mb: 2,
      position: 'relative', overflow: 'hidden',
    }}>
      <Box sx={{ position: 'absolute', top: -30, right: -30, width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)' }} />
      <Paper sx={{ p: { xs: 1.5, md: 2 }, borderRadius: '12px', position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label="Ne satıyorsunuz?"
            value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            size="small" sx={{ flex: 2, minWidth: 200 }}
            placeholder="flower girl dress, baby blanket..."
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && searchMarket()}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={16} color="#667eea" /></InputAdornment>,
            }}
          />
          <TextField label="Min $" value={minPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinPrice(e.target.value)}
            size="small" type="number" sx={{ width: 80 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField label="Max $" value={maxPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxPrice(e.target.value)}
            size="small" type="number" sx={{ width: 80 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField label="Sıralama" value={sortOn} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOn(e.target.value)}
            size="small" select sx={{ width: 130 }} SelectProps={{ native: true }}>
            <option value="score">En İyi Eşleşme</option>
            <option value="price">Fiyat</option>
            <option value="created">Yeni Eklenen</option>
            <option value="updated">Son Güncellenen</option>
          </TextField>
          <Button variant="contained" onClick={searchMarket}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
            sx={{
              background: GRADIENTS.primary, borderRadius: '10px', px: 3,
              boxShadow: '0 4px 12px rgba(102,126,234,0.4)',
            }}
          >
            Araştır
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default withAuth(EtsyResearchPage);
