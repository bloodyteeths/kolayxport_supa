import React, { useState, useCallback, lazy, Suspense } from 'react';
import {
  Box, CircularProgress, Typography, Paper, List, ListItemButton,
  ListItemIcon, ListItemText, Drawer, IconButton, useMediaQuery, useTheme,
} from '@mui/material';
import {
  LayoutDashboard, FolderTree, DollarSign, Store, Tag,
  Calculator, Sparkles, Menu, ChevronLeft,
} from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTrendyolResearchStore } from '@/lib/stores/useTrendyolResearchStore';
import { useTranslations } from 'next-intl';

// Lazy load sub-components for performance
const Dashboard = lazy(() => import('@/components/trendyol/research/Dashboard'));
const CategoryExplorer = lazy(() => import('@/components/trendyol/research/CategoryExplorer'));
const PriceAnalyzer = lazy(() => import('@/components/trendyol/research/TrendyolPriceAnalyzer'));
const SellerIntelligence = lazy(() => import('@/components/trendyol/research/TrendyolSellerIntelligence'));
const BrandAnalyzer = lazy(() => import('@/components/trendyol/research/TrendyolBrandAnalyzer'));
const ProfitCalculator = lazy(() => import('@/components/trendyol/research/TrendyolProfitCalculator'));
const AiReport = lazy(() => import('@/components/trendyol/research/AiReport'));

const GRADIENTS = {
  primary: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
};

const SIDEBAR_WIDTH = 220;

function TrendyolResearchPage() {
  const { user } = useAuth();
  const t = useTranslations('trendyolResearch');
  const [activeNav, setActiveNav] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const store = useTrendyolResearchStore();

  const NAV_ITEMS = [
    { id: 'dashboard', label: t('navDashboard'), icon: LayoutDashboard, desc: '' },
    { id: 'category', label: t('navCategoryExplorer'), icon: FolderTree, desc: '' },
    { id: 'price', label: t('navPriceAnalyzer'), icon: DollarSign, desc: '' },
    { id: 'sellers', label: t('navSellerIntelligence'), icon: Store, desc: '' },
    { id: 'brands', label: t('navBrandAnalyzer'), icon: Tag, desc: '' },
    { id: 'profit', label: t('navProfitCalc'), icon: Calculator, desc: '' },
    { id: 'ai-report', label: t('navAiReport'), icon: Sparkles, desc: '' },
  ];

  const handleNavigate = useCallback((navId: string) => {
    setActiveNav(navId);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleNavigateFromDashboard = useCallback((navId: string) => {
    setActiveNav(navId);
  }, []);

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
                  boxShadow: '0 2px 8px rgba(249,115,22,0.3)',
                } : {
                  '&:hover': { bgcolor: 'rgba(249,115,22,0.06)' },
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
        return <Dashboard onNavigate={handleNavigateFromDashboard} />;
      case 'category':
        return <CategoryExplorer />;
      case 'price':
        return <PriceAnalyzer />;
      case 'sellers':
        return <SellerIntelligence />;
      case 'brands':
        return <BrandAnalyzer />;
      case 'profit':
        return <ProfitCalculator />;
      case 'ai-report':
        return <AiReport />;
      default:
        return <Dashboard onNavigate={handleNavigateFromDashboard} />;
    }
  };

  return (
    <AppLayout title={t('title')}>
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
        <Box sx={{ flex: 1, p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 1600, mx: 'auto', width: '100%' }}>
          {/* Mobile header with menu button */}
          {isMobile && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <IconButton onClick={() => setSidebarOpen(true)} sx={{ p: 0.5 }}>
                <Menu size={22} />
              </IconButton>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {NAV_ITEMS.find(n => n.id === activeNav)?.label || t('navDashboard')}
              </Typography>
            </Box>
          )}

          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
            {renderContent()}
          </Suspense>
        </Box>
      </Box>
    </AppLayout>
  );
}

export default withAuth(TrendyolResearchPage);
