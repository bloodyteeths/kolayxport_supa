import React, { lazy, Suspense, useEffect } from 'react';
import {
  Box, CircularProgress, Typography, useMediaQuery, useTheme,
  TextField, InputAdornment, Button, Tabs, Tab, Select, MenuItem,
  FormControl, InputLabel,
} from '@mui/material';
import { Search, BarChart2, Key, TrendingUp } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAmazonResearchStore } from '@/lib/stores/useAmazonResearchStore';
import { useTranslations } from 'next-intl';

const UnifiedResearch = lazy(() => import('@/components/amazon/research/UnifiedResearch'));
const KeywordIntelligence = lazy(() => import('@/components/amazon/research/KeywordIntelligence'));
const CompetitorIntelligence = lazy(() => import('@/components/amazon/research/CompetitorIntelligence'));

const GRADIENTS = {
  primary: 'linear-gradient(135deg, #FF9900 0%, #FF6600 100%)', // Amazon orange
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
      boxShadow: '0 2px 12px rgba(255,153,0,0.3)',
    },
  },
};

const MARKETPLACE_OPTIONS = [
  { value: 'US', label: '🇺🇸 US' },
  { value: 'TR', label: '🇹🇷 Turkey' },
  { value: 'DE', label: '🇩🇪 Germany' },
  { value: 'UK', label: '🇬🇧 UK' },
  { value: 'FR', label: '🇫🇷 France' },
  { value: 'IT', label: '🇮🇹 Italy' },
  { value: 'ES', label: '🇪🇸 Spain' },
];

function AmazonResearchPage() {
  const t = useTranslations('amazonResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const {
    query, setQuery, marketplace, setMarketplace,
    activeView, setActiveView,
    loading, searchProducts, analyzeNiche,
    fetchTrackedProducts, fetchSavedNiches,
  } = useAmazonResearchStore();

  useEffect(() => {
    fetchTrackedProducts();
    fetchSavedNiches();
  }, []);

  const handleSearch = () => {
    searchProducts();
    analyzeNiche();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const tabIndex = activeView === 'research' ? 0 : activeView === 'keywords' ? 1 : 2;

  return (
    <AppLayout>
      <Toaster position="top-center" />

      <Box sx={{ px: isMobile ? 1.5 : 3, py: 2, maxWidth: 1400, mx: 'auto' }}>
        {/* Header */}
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
          {t('title')}
        </Typography>

        {/* Search bar */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} />
                </InputAdornment>
              ),
            }}
          />

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
            >
              {MARKETPLACE_OPTIONS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            sx={{
              background: GRADIENTS.primary,
              minWidth: 120,
              '&:hover': { background: 'linear-gradient(135deg, #FF8800 0%, #FF5500 100%)' },
            }}
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : t('search')}
          </Button>
        </Box>

        {/* Tabs */}
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setActiveView(v === 0 ? 'research' : v === 1 ? 'keywords' : 'competitors')}
          sx={pillTabsSx}
        >
          <Tab icon={<BarChart2 size={16} />} iconPosition="start" label={t('tabResearch')} />
          <Tab icon={<Key size={16} />} iconPosition="start" label={t('tabKeywords')} />
          <Tab icon={<TrendingUp size={16} />} iconPosition="start" label={t('tabCompetitors')} />
        </Tabs>

        {/* Content */}
        <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}>
          {activeView === 'research' && <UnifiedResearch />}
          {activeView === 'keywords' && <KeywordIntelligence />}
          {activeView === 'competitors' && <CompetitorIntelligence />}
        </Suspense>
      </Box>
    </AppLayout>
  );
}

export default withAuth(AmazonResearchPage);
