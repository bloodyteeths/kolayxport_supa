import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
// @ts-ignore
import axios from 'axios';
import { Grid } from '@mui/material';
import {
  Container, TextField, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel, FormHelperText, Box, Snackbar, Alert, AlertColor, SelectChangeEvent, Tooltip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Chip, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import { fedexOptionsData, FedExOption } from '../lib/fedex/fedex.config'; // For dutiesPaymentTypes
import AppLayout from '../components/AppLayout'; // Use AppLayout for consistent sidebar
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';
import SubscriptionDashboard from '../components/SubscriptionDashboard';
import ImporterFormCollapsible from '../components/ImporterFormCollapsible';
import { useRouter } from 'next/router';
// supabase browser client removed — auth now handled by NextAuth cookies
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';

// Mirrored from API route
interface UserSettingsResponse {
  subscription?: {
    subscriptionPlan: 'trial' | 'starter' | 'growth' | 'enterprise' | null;
    subscriptionStatus: 'trialing' | 'active' | 'canceled' | 'past_due' | null;
    billingInterval: 'month' | 'year' | null;
    trialExpiresAt: string | null;
    usageResetAt: string | null;
    orderSyncCount: number;
    labelCount: number;
  };
  shippingSettings?: {
    etgbRecipientEmail?: string | null;
    etgbEnabled?: boolean;
  } | null;
  integrationSettings?: {
    veeqoApiKey?: string | null;
    shippoToken?: string | null;
    trendyolApiKey?: string | null;
    trendyolApiSecret?: string | null;
    trendyolSupplierId?: string | null;
    fedexApiKey?: string | null;
    fedexApiSecret?: string | null;
    fedexAccountNumber?: string | null;
    upsApiKey?: string | null;
    upsApiSecret?: string | null;
    upsAccountNumber?: string | null;
    etsyAccessToken?: string | null;
    etsyShopId?: string | null;
    etsyTokenExpiresAt?: string | null;
    parasutClientId?: string | null;
    parasutClientSecret?: string | null;
    parasutUsername?: string | null;
    parasutPassword?: string | null;
    parasutCompanyId?: string | null;
    parasutBaseUrl?: string | null;
    parasutRedirectUri?: string | null;
  } | null; // Allow null for the whole object
  shipperProfile?: {
    shipperName?: string | null;
    shipperPersonName?: string | null;
    shipperPhoneNumber?: string | null;
    shipperStreet1?: string | null;
    shipperStreet2?: string | null;
    shipperCity?: string | null;
    shipperStateCode?: string | null;
    shipperPostalCode?: string | null;
    shipperCountryCode?: string | null;
    shipperTinNumber?: string | null;
    shipperTinType?: string | null;
    importerOfRecord?: string | null;
    fedexFolderId?: string | null;
    defaultCurrencyCode?: string | null;
    dutiesPaymentType?: string | null;
    defaultShippingChargesPaymentType?: string | null;
  } | null; // Allow null for the whole object
}

const initialFormData: UserSettingsResponse = {
  shippingSettings: {
    etgbRecipientEmail: '',
    etgbEnabled: false,
  },
  integrationSettings: {
    veeqoApiKey: '',
    shippoToken: '',
    trendyolApiKey: '',
    trendyolApiSecret: '',
    trendyolSupplierId: '',
    fedexApiKey: '',
    fedexApiSecret: '',
    fedexAccountNumber: '',
    upsApiKey: '',
    upsApiSecret: '',
    upsAccountNumber: '',
    parasutClientId: '',
    parasutClientSecret: '',
    parasutUsername: '',
    parasutPassword: '',
    parasutCompanyId: '',
    parasutBaseUrl: '',
    parasutRedirectUri: '',
  },
  shipperProfile: {
    shipperName: '',
    shipperPersonName: '',
    shipperPhoneNumber: '',
    shipperStreet1: '',
    shipperStreet2: '',
    shipperCity: '',
    shipperStateCode: '',
    shipperPostalCode: '',
    shipperCountryCode: '',
    shipperTinNumber: '',
    shipperTinType: '',
    importerOfRecord: '', 
    fedexFolderId: '',
    defaultCurrencyCode: 'USD',
    dutiesPaymentType: 'SENDER',
    defaultShippingChargesPaymentType: 'SENDER',
  },
};

// Basic lists for dropdowns - keys only, labels come from t()
const COUNTRY_CODE_KEYS = ['TR', 'US', 'DE', 'GB'] as const;

const tinTypes = [
  "VAT", "EORI", "IOSS", "OSS", "PAN", "GST", "TIN", "EIN", "SSN", "NIE", "DNI", "CNPJ", "CPF", "DUNS", "FEDERAL_TAX_ID", "STATE_TAX_ID", "BUSINESS_NATIONAL", "PERSONAL_NATIONAL", "BUSINESS_UNION", "PERSONAL_UNION"
].map(type => ({ value: type, label: type.replace(/_/g, ' ') }));

const CURRENCY_CODE_KEYS = ['TRY', 'USD', 'EUR'] as const;

const AyarlarPage = () => {
  const router = useRouter();
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { locale, config, formatDateTime } = useLocale();

  // --- Full Sync State ---
  const [isFullSyncLoading, setIsFullSyncLoading] = useState(false);

  const [formData, setFormData] = useState<UserSettingsResponse>(initialFormData);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null); // For initial fetch error
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importerJsonError, setImporterJsonError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: AlertColor }>({ open: false, message: '', severity: 'success' });
  const [subscriptionData, setSubscriptionData] = useState<UserSettingsResponse['subscription'] | null>(null);

  // --- Sync History State ---
  const [syncHistory, setSyncHistory] = useState<any[]>([]);

  // --- Full Sync Handler ---
  const handleFullSync = async () => {
    if (!window.confirm(t('fullSyncConfirm'))) return;
    setIsFullSyncLoading(true);
    try {
      const res = await fetch('/api/orders/fullSync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('fullSyncFailed'));
      setSnackbar({ open: true, message: t('fullSyncStarted'), severity: 'success' });
      fetchSyncHistory();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || t('fullSyncFailed'), severity: 'error' });
    } finally {
      setIsFullSyncLoading(false);
    }
  };


  // --- eBay Connection State ---
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayTokenExpires, setEbayTokenExpires] = useState<string | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);

  // --- Etsy Shops State ---
  const [etsyShops, setEtsyShops] = useState<any[]>([]);
  const [etsyShopsLoading, setEtsyShopsLoading] = useState(false);
  const [etsyShopsError, setEtsyShopsError] = useState<string | null>(null);

  // --- Etsy Shops Functions ---
  const fetchEtsyShops = async () => {
    setEtsyShopsLoading(true);
    setEtsyShopsError(null);
    try {
      const response = await axios.get('/api/integrations/etsy/shops');
      setEtsyShops(response.data.shops || []);
    } catch (error: any) {
      setEtsyShopsError(error.response?.data?.error || 'Failed to fetch Etsy shops');
      console.error('Failed to fetch Etsy shops:', error);
    } finally {
      setEtsyShopsLoading(false);
    }
  };


  const handleDisconnectEtsyShop = async (shopId: string) => {
    if (!window.confirm(t('disconnectEtsyConfirm'))) return;
    
    try {
      await axios.post('/api/integrations/etsy/shops', {
        shopId,
        action: 'delete'
      });
      
      setSnackbar({
        open: true,
        message: t('etsyShopDisconnected'),
        severity: 'success'
      });
      
      // Refresh shops list
      await fetchEtsyShops();
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: t('shopDisconnectFailed'),
        severity: 'error'
      });
      console.error('Failed to disconnect shop:', error);
    }
  };

  // --- eBay Functions ---
  const fetchEbayStatus = async () => {
    setEbayLoading(true);
    try {
      const response = await axios.get('/api/integrations/ebay/status');
      setEbayConnected(response.data.connected);
      setEbayTokenExpires(response.data.tokenExpiresAt);
    } catch {
      setEbayConnected(false);
    } finally {
      setEbayLoading(false);
    }
  };

  const handleDisconnectEbay = async () => {
    if (!window.confirm(t('disconnectEbayConfirm'))) return;
    try {
      await axios.delete('/api/integrations/ebay/status');
      setEbayConnected(false);
      setEbayTokenExpires(null);
      setSnackbar({ open: true, message: t('ebayDisconnected'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('ebayDisconnectFailed'), severity: 'error' });
    }
  };

  const [syncHistoryLoading, setSyncHistoryLoading] = useState(false);
  const [syncHistoryError, setSyncHistoryError] = useState<string | null>(null);
  const [syncHistoryCursor, setSyncHistoryCursor] = useState<string | null>(null);
  const [syncHistoryEnd, setSyncHistoryEnd] = useState(false);
  const [retryingSyncId, setRetryingSyncId] = useState<string | null>(null);

  const fetchSyncHistory = async (opts: { append?: boolean } = {}) => {
    setSyncHistoryLoading(true);
    setSyncHistoryError(null);
    try {
      const params = new URLSearchParams();
      if (syncHistoryCursor) params.append('cursor', syncHistoryCursor);
      const res = await fetch(`/api/sync/history?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        if (opts.append) {
          setSyncHistory(prev => [...prev, ...data.syncs]);
        } else {
          setSyncHistory(data.syncs);
        }
        setSyncHistoryCursor(data.nextCursor);
        setSyncHistoryEnd(!data.nextCursor || data.syncs.length === 0);
      } else {
        setSyncHistoryError(data.error || t('syncHistoryFailed'));
      }
    } catch (err: any) {
      setSyncHistoryError(err.message || t('syncHistoryFailed'));
    } finally {
      setSyncHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncHistory();
    fetchEtsyShops();
    fetchEbayStatus();

    // Show Etsy OAuth callback result from query params
    const { success, error, details } = router.query;
    if (success === 'etsy_connected') {
      setSnackbar({ open: true, message: t('etsyShopConnected'), severity: 'success' });
      router.replace('/ayarlar', undefined, { shallow: true });
    } else if (success === 'ebay_connected') {
      setSnackbar({ open: true, message: t('ebayConnectedSuccess'), severity: 'success' });
      router.replace('/ayarlar', undefined, { shallow: true });
    } else if (error === 'ebay_auth_failed' || error === 'ebay_token_failed' || error === 'ebay_callback_failed') {
      const detailMsg = details ? ` ${decodeURIComponent(details as string)}` : '';
      setSnackbar({ open: true, message: `${t('ebayConnectionFailed')}${detailMsg}`, severity: 'error' });
      router.replace('/ayarlar', undefined, { shallow: true });
    } else if (error === 'etsy_callback_failed' || error === 'etsy_auth_failed' || error === 'etsy_token_failed') {
      const detailMsg = details ? ` ${decodeURIComponent(details as string)}` : '';
      setSnackbar({ open: true, message: `${t('etsyConnectionFailed')}${detailMsg}`, severity: 'error' });
      router.replace('/ayarlar', undefined, { shallow: true });
    }
    // eslint-disable-next-line
  }, [router.query]);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const response = await axios.get<UserSettingsResponse>('/api/user/settings', {
          timeout: 10000
        });
        setFormData({
          shippingSettings: response.data.shippingSettings || initialFormData.shippingSettings,
          integrationSettings: response.data.integrationSettings || initialFormData.integrationSettings,
          shipperProfile: response.data.shipperProfile || initialFormData.shipperProfile,
        });
        setSubscriptionData(response.data.subscription || null);
        setInitialDataLoaded(true);
      } catch (error: any) {
        console.error(t('fetchError'), error);
        setFetchError(t('settingsLoadError'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleInputChange = (
    section: keyof UserSettingsResponse,
    name: string,
    value: string | boolean
  ) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...(prev[section] as object),
        [name]: value,
      },
    }));

    // Clear JSON error when component handles its own validation
    if (section === 'shipperProfile' && name === 'importerOfRecord') {
      setImporterJsonError(null);
    }
  };
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await axios.patch('/api/user/settings', formData, { withCredentials: true });
      setSnackbar({ open: true, message: t('settingsSaved'), severity: 'success' });
    } catch (error: any) {
      console.error(t('settingsSaveFailed'), error);
      let errorMessage = t('settingsSaveFailed');
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage += ` ${error.response.data.error}`;
      } else if (error.message) {
        errorMessage += ` ${error.message}`;
      }
      setSnackbar({ open: true, message: errorMessage, severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetrySync = async (syncId: string) => {
    if (!window.confirm(t('retrySyncConfirm'))) return;
    setRetryingSyncId(syncId);
    try {
      const res = await fetch(`/api/sync/retry?id=${encodeURIComponent(syncId)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('retryFailed'));
      fetchSyncHistory();
    } catch (err: any) {
      alert(err.message || t('retryFailed'));
    } finally {
      setRetryingSyncId(null);
    }
  };

  if (isLoading && !initialDataLoaded) {
    console.log('Showing loading screen - isLoading:', isLoading, 'initialDataLoaded:', initialDataLoaded);
    return (
      <AppLayout title={t('loadingTitle')}>
        <Container sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>{tc('loading')}</Typography>
        </Container>
      </AppLayout>
    );
  }

  console.log('Rendering main ayarlar page - isLoading:', isLoading, 'initialDataLoaded:', initialDataLoaded, 'subscriptionData:', !!subscriptionData);

  const handleUpgrade = () => {
    router.push('/fiyatlandirma');
  };

  const handleManageSubscription = async () => {
    try {
      const response = await axios.post('/api/stripe/create-portal-session');
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error: any) {
      console.error('Failed to open billing portal:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || t('subscriptionManageFailed'),
        severity: 'error'
      });
    }
  };

  const handleViewBillingHistory = () => {
    router.push('/faturalar');
  };

  try {
    return (
      <AppLayout title={t('pageTitle')}>
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4, overflowX: 'hidden', maxWidth: '100%', px: { xs: 1.5, sm: 3 } }}>
          {fetchError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {fetchError}
            </Alert>
          )}

          {/* Subscription Dashboard */}
          {subscriptionData && initialDataLoaded && (
            <SubscriptionDashboard
              subscriptionData={subscriptionData}
              onUpgrade={handleUpgrade}
              onManageSubscription={handleManageSubscription}
              onViewBillingHistory={handleViewBillingHistory}
            />
          )}

          <form onSubmit={handleSubmit}>
            <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 }, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
              <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1, fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
                {t('apiIntegrations')}
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="Veeqo API Key" name="veeqoApiKey" type="password" value={formData.integrationSettings?.veeqoApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label="Shippo Token" name="shippoToken" type="password" value={formData.integrationSettings?.shippoToken || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="Trendyol API Key" name="trendyolApiKey" type="password" value={formData.integrationSettings?.trendyolApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="Trendyol API Secret" name="trendyolApiSecret" type="password" value={formData.integrationSettings?.trendyolApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="Trendyol Supplier ID" name="trendyolSupplierId" value={formData.integrationSettings?.trendyolSupplierId || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="FedEx API Key" name="fedexApiKey" type="password" value={formData.integrationSettings?.fedexApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="FedEx API Secret" name="fedexApiSecret" type="password" value={formData.integrationSettings?.fedexApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="FedEx Account Number" name="fedexAccountNumber" value={formData.integrationSettings?.fedexAccountNumber || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="UPS API Key" name="upsApiKey" type="password" value={formData.integrationSettings?.upsApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="UPS API Secret" name="upsApiSecret" type="password" value={formData.integrationSettings?.upsApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label="UPS Account Number" name="upsAccountNumber" value={formData.integrationSettings?.upsAccountNumber || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                {/* Paraşüt Integration */}
                <Grid item xs={12}>
                  <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>{t('parasutIntegration')}</Typography>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('parasutClientId')} name="parasutClientId" value={formData.integrationSettings?.parasutClientId || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('parasutClientSecret')} name="parasutClientSecret" type="password" value={formData.integrationSettings?.parasutClientSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('parasutUsername')} name="parasutUsername" value={formData.integrationSettings?.parasutUsername || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('parasutPassword')} name="parasutPassword" type="password" value={formData.integrationSettings?.parasutPassword || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('parasutCompanyId')} name="parasutCompanyId" value={formData.integrationSettings?.parasutCompanyId || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={`Parasut Base URL (${tc('optional')})`} name="parasutBaseUrl" placeholder={t('parasutBaseUrlPlaceholder')} value={formData.integrationSettings?.parasutBaseUrl || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={`Parasut Redirect URI (${tc('optional')})`} name="parasutRedirectUri" placeholder={t('parasutRedirectUriPlaceholder')} value={formData.integrationSettings?.parasutRedirectUri || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
              </Grid>
            </Paper>

            <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 }, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
              <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1, fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
                {t('marketplaceConnections')}
              </Typography>
              
              {/* Etsy Connection */}
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, mb: 2, gap: 1 }}>
                  <Typography variant="h6" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t('etsyShopConnections')}
                  </Typography>
                  <Button
                    variant="contained"
                    color="primary"
                    href="/api/integrations/etsy/connect"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {t('connectNewShop')}
                  </Button>
                </Box>

                <Box sx={{ mb: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                  <Typography variant="body2" color="warning.dark" fontWeight="bold">
                    {t('etsyTrackingDisabled')}
                  </Typography>
                  <Typography variant="caption" color="warning.dark">
                    {t('etsyTrackingDisabledDesc')}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('multiShopDesc')}
                </Typography>

                {etsyShopsLoading ? (
                  <Typography>{t('loadingEtsyShops')}</Typography>
                ) : etsyShopsError ? (
                  <Typography color="error">{tc('error')}: {etsyShopsError}</Typography>
                ) : etsyShops.length === 0 ? (
                  <Box sx={{ p: 3, textAlign: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t('noEtsyShops')}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="primary"
                      href="/api/integrations/etsy/connect"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
                    >
                      {t('connectFirstShop')}
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {etsyShops.map((shop) => (
                      <Paper key={shop.id} elevation={1} sx={{ p: 2, border: '1px solid #e0e0e0' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box>
                            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
                              {shop.shopName || `Shop ${shop.shopId}`}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Shop ID: {shop.shopId}
                            </Typography>
                            {shop.tokenExpiresAt && (
                              <Typography variant="caption" color="text.secondary">
                                {t('tokenValidity')}: {formatDateTime(shop.tokenExpiresAt)}
                              </Typography>
                            )}
                          </Box>
                          <Box>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => handleDisconnectEtsyShop(shop.id)}
                            >
                              {t('disconnect')}
                            </Button>
                          </Box>
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                )}
              </Box>

              {/* eBay Connection */}
              <Box sx={{ mb: 3, mt: 4, pt: 3, borderTop: '1px solid #e0e0e0' }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, mb: 2, gap: 1 }}>
                  <Typography variant="h6" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t('ebayAccountConnection')}
                  </Typography>
                  {!ebayConnected && (
                    <Button
                      variant="contained"
                      color="primary"
                      href="/api/integrations/ebay/connect"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {t('connectEbay')}
                    </Button>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('ebayDesc')}
                </Typography>

                {ebayLoading ? (
                  <Typography>{t('checkingEbayStatus')}</Typography>
                ) : ebayConnected ? (
                  <Paper elevation={1} sx={{ p: 2, border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1.5 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight="bold" color="success.main" sx={{ mb: 0.5 }}>
                          {t('ebayConnected')}
                        </Typography>
                        {ebayTokenExpires && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t('tokenValidity')}: {formatDateTime(ebayTokenExpires)}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          href="/api/integrations/ebay/connect"
                        >
                          {t('reconnect')}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={handleDisconnectEbay}
                        >
                          {t('disconnect')}
                        </Button>
                      </Box>
                    </Box>
                  </Paper>
                ) : (
                  <Box sx={{ p: 3, textAlign: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t('noEbayConnected')}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="primary"
                      href="/api/integrations/ebay/connect"
                    >
                      {t('connectYourEbay')}
                    </Button>
                  </Box>
                )}
              </Box>
            </Paper>

            {(() => {
              const etgbContent = (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {t('etgbDesc')}
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6} md={6}>
                      <TextField
                        fullWidth
                        label={t('etgbRecipientEmail')}
                        name="etgbRecipientEmail"
                        type="email"
                        value={formData.shippingSettings?.etgbRecipientEmail || ''}
                        onChange={(e) => handleInputChange('shippingSettings', e.target.name, e.target.value)}
                        helperText={t('etgbRecipientEmailHelper')}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={6}>
                      <FormControl fullWidth>
                        <InputLabel id="etgb-enabled-label">{t('etgbFeature')}</InputLabel>
                        <Select
                          labelId="etgb-enabled-label"
                          name="etgbEnabled"
                          label={t('etgbFeature')}
                          value={formData.shippingSettings?.etgbEnabled ? 'true' : 'false'}
                          onChange={(e: SelectChangeEvent<string>) =>
                            handleInputChange('shippingSettings', 'etgbEnabled', e.target.value === 'true')
                          }
                        >
                          <MenuItem value="true">{tc('active')}</MenuItem>
                          <MenuItem value="false">{tc('passive')}</MenuItem>
                        </Select>
                        <FormHelperText>{t('etgbFeatureHelper')}</FormHelperText>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">
                        {t('etgbNote')}
                      </Typography>
                    </Grid>
                  </Grid>
                </>
              );

              if (config.etgbProminence === 'collapsed') {
                return (
                  <Paper elevation={3} sx={{ p: 0, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
                    <Accordion>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="h5" component="h2" sx={{ fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
                          {t('etgbSettings')}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ p: { xs: 2, sm: 3 } }}>
                        {etgbContent}
                      </AccordionDetails>
                    </Accordion>
                  </Paper>
                );
              }

              return (
                <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 }, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
                  <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1, fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
                    {t('etgbSettings')}
                  </Typography>
                  {etgbContent}
                </Paper>
              );
            })()}

            <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 }, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
              <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1, fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
                {t('senderProfile')}
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={t('companyName')} name="shipperName" value={formData.shipperProfile?.shipperName || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={t('authorizedPerson')} name="shipperPersonName" value={formData.shipperProfile?.shipperPersonName || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={t('phone')} name="shipperPhoneNumber" value={formData.shipperProfile?.shipperPhoneNumber || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} sm={6} md={6}>
                  <TextField fullWidth label={t('fedexFolderId')} name="fedexFolderId" value={formData.shipperProfile?.fedexFolderId || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label={t('address1')} name="shipperStreet1" value={formData.shipperProfile?.shipperStreet1 || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label={t('address2')} name="shipperStreet2" value={formData.shipperProfile?.shipperStreet2 || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('city')} name="shipperCity" value={formData.shipperProfile?.shipperCity || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('stateRegionCode')} name="shipperStateCode" value={formData.shipperProfile?.shipperStateCode || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('postalCode')} name="shipperPostalCode" value={formData.shipperProfile?.shipperPostalCode || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="shipperCountryCode-label">{t('countryCode')}</InputLabel>
                    <Select
                      labelId="shipperCountryCode-label"
                      name="shipperCountryCode"
                      label={t('countryCode')}
                      value={formData.shipperProfile?.shipperCountryCode || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {COUNTRY_CODE_KEYS.map(code => <MenuItem key={code} value={code}>{t(`countryCodes.${code}`)}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField fullWidth label={t('taxNumber')} name="shipperTinNumber" value={formData.shipperProfile?.shipperTinNumber || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="shipperTinType-label">{t('taxType')}</InputLabel>
                    <Select
                      labelId="shipperTinType-label"
                      name="shipperTinType"
                      label={t('taxType')}
                      value={formData.shipperProfile?.shipperTinType || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {tinTypes.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="defaultCurrencyCode-label">{t('defaultCurrency')}</InputLabel>
                    <Select
                      labelId="defaultCurrencyCode-label"
                      name="defaultCurrencyCode"
                      label={t('defaultCurrency')}
                      value={formData.shipperProfile?.defaultCurrencyCode || 'USD'}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {CURRENCY_CODE_KEYS.map(code => <MenuItem key={code} value={code}>{t(`currencyCodes.${code}`)}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="dutiesPaymentType-label">{t('customsDutyPayment')}</InputLabel>
                    <Select
                      labelId="dutiesPaymentType-label"
                      name="dutiesPaymentType"
                      label={t('customsDutyPayment')}
                      value={formData.shipperProfile?.dutiesPaymentType || 'SENDER'}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {(fedexOptionsData.dutiesPaymentTypes as FedExOption[]).map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="defaultShippingChargesPaymentType-label">Default Shipping Charges Payment Type</InputLabel>
                    <Select
                      labelId="defaultShippingChargesPaymentType-label"
                      name="defaultShippingChargesPaymentType"
                      label="Default Shipping Charges Payment Type"
                      value={formData.shipperProfile?.defaultShippingChargesPaymentType || 'SENDER'}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {(fedexOptionsData.shippingChargesPaymentTypes as FedExOption[]).map(opt => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <ImporterFormCollapsible
                    value={formData.shipperProfile?.importerOfRecord || ''}
                    onChange={(jsonString) => handleInputChange('shipperProfile', 'importerOfRecord', jsonString)}
                    error={importerJsonError}
                  />
                </Grid>
              </Grid>
            </Paper>

            {/* --- Sync History Section --- */}
            <Paper elevation={3} sx={{ p: { xs: 2, sm: 3 }, mb: 4, overflow: 'hidden', maxWidth: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography variant="h5" component="h2" sx={{ fontWeight: 'bold', flex: 1, fontSize: { xs: '1.2rem', sm: '1.5rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t('syncHistory')}
                </Typography>
                <IconButton onClick={() => { setSyncHistoryCursor(null); setSyncHistoryEnd(false); fetchSyncHistory(); }} disabled={syncHistoryLoading}>
                  <RefreshIcon />
                </IconButton>
              </Box>
              <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                <Table size="small" sx={{ minWidth: { xs: 500, sm: 700 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('syncTableHeaders.syncType')}</TableCell>
                      <TableCell>{t('syncTableHeaders.status')}</TableCell>
                      <TableCell>{t('syncTableHeaders.start')}</TableCell>
                      <TableCell>{t('syncTableHeaders.end')}</TableCell>
                      <TableCell>{t('syncTableHeaders.processed')}</TableCell>
                      <TableCell>{t('syncTableHeaders.successful')}</TableCell>
                      <TableCell>{t('syncTableHeaders.failed')}</TableCell>
                      <TableCell>{t('syncTableHeaders.errors')}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {syncHistory.length === 0 && !syncHistoryLoading && (
                      <TableRow>
                        <TableCell colSpan={9} align="center">
                          {t('noSyncHistory')}
                        </TableCell>
                      </TableRow>
                    )}
                    {syncHistory.map((row, idx) => {
                      let statusColor = 'text.primary';
                      let statusLabel = row.status;
                      if (row.status === 'completed') { statusColor = 'success.main'; statusLabel = t('syncStatusCompleted'); }
                      else if (row.status === 'failed') { statusColor = 'error.main'; statusLabel = t('syncStatusFailed'); }
                      else if (row.status === 'in_progress') { statusColor = 'info.main'; statusLabel = t('syncStatusInProgress'); }
                      return (
                        <TableRow key={row.id}>
                          <TableCell>{row.type}</TableCell>
                          <TableCell sx={{ color: statusColor, fontWeight: 'bold' }}>{statusLabel}</TableCell>
                          <TableCell>{row.startedAt ? formatDateTime(row.startedAt) : '-'}</TableCell>
                          <TableCell>{row.endedAt ? formatDateTime(row.endedAt) : '-'}</TableCell>
                          <TableCell>{row.processedOrders}</TableCell>
                          <TableCell>{row.successfulOrders}</TableCell>
                          <TableCell>{row.failedOrders}</TableCell>
                          <TableCell>
                            {row.errors && row.errors.length > 0 ? (
                              <Tooltip title={t('clickToSeeErrors')}>
                                <Button size="small" color="error" onClick={() => alert(JSON.stringify(row.errors, null, 2))}>
                                  {row.errors.length}
                                </Button>
                              </Tooltip>
                            ) : 0}
                          </TableCell>
                          <TableCell>
                            {row.status === 'failed' && (
                              <Tooltip title={t('retrySync')}>
                                <span>
                                  <IconButton
                                    color="primary"
                                    onClick={() => handleRetrySync(row.id)}
                                    disabled={retryingSyncId === row.id}
                                  >
                                    <ReplayIcon />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                {syncHistoryLoading && <CircularProgress size={24} />}
                {!syncHistoryLoading && syncHistory.length > 0 && !syncHistoryEnd && (
                  <Button variant="outlined" onClick={() => fetchSyncHistory({ append: true })} startIcon={<ExpandMoreIcon />}>
                    {t('loadMore')}
                  </Button>
                )}
                {!syncHistoryLoading && syncHistoryEnd && syncHistory.length > 0 && (
                  <Typography sx={{ color: 'text.secondary', ml: 2 }}>
                    {t('noMoreRecords')}
                  </Typography>
                )}
              </Box>
            </Paper>

            {/* --- Full Sync Button --- */}
            <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
              <Button
                variant="contained"
                color="secondary"
                disabled={isFullSyncLoading}
                onClick={handleFullSync}
                startIcon={isFullSyncLoading ? <CircularProgress size={20} color="inherit" /> : <ReplayIcon />}
                fullWidth
                sx={{ maxWidth: { sm: 'fit-content' }, whiteSpace: 'nowrap', fontSize: { xs: '0.8rem', sm: '0.875rem' } }}
              >
                {isFullSyncLoading ? t('syncing') : t('fullSync')}
              </Button>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mt: 3 }}>
              <Button type="submit" variant="contained" color="primary" disabled={isSubmitting || isLoading} size="large" fullWidth sx={{ maxWidth: { sm: 'fit-content' } }}>
                {isSubmitting ? <CircularProgress size={24} color="inherit" /> : t('saveSettings')}
              </Button>
            </Box>
          </form>
          
          <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar(prev => ({...prev, open: false}))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
            <Alert onClose={() => setSnackbar(prev => ({...prev, open: false}))} severity={snackbar.severity} sx={{ width: '100%' }}>
              {snackbar.message}
            </Alert>
          </Snackbar>
        </Container>
      </AppLayout>
    );
  } catch (error) {
    console.error('Error rendering ayarlar page:', error);
    return (
      <AppLayout title={t('errorPageTitle')}>
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            {tc('error')}
          </Typography>
          <Typography>
            {tc('errorOccurred')}
          </Typography>
        </Container>
      </AppLayout>
    );
  }
};

// If you are using a custom App with a Layout pattern
// AyarlarPage.getLayout = function getLayout(page: React.ReactElement) {
//   return <Layout>{page}</Layout>;
// };

export default AyarlarPage; 