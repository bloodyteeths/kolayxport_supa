import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
// @ts-ignore
import axios from 'axios';
import { Grid } from '@mui/material';
import {
  Container, TextField, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel, FormHelperText, Box, Snackbar, Alert, AlertColor, SelectChangeEvent, Tooltip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton
} from '@mui/material';
import { fedexOptionsData, FedExOption } from '../lib/fedex/fedex.config'; // For dutiesPaymentTypes
import AppLayout from '../components/AppLayout'; // Use AppLayout for consistent sidebar
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';
import SubscriptionDashboard from '../components/SubscriptionDashboard';
import { useRouter } from 'next/router';

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

// Basic lists for dropdowns - expand as needed
const countryCodes = [
  { value: 'TR', label: 'Türkiye' },
  { value: 'US', label: 'United States' },
  { value: 'DE', label: 'Germany' },
  { value: 'GB', label: 'United Kingdom' },
];

const tinTypes = [
  "VAT", "EORI", "IOSS", "OSS", "PAN", "GST", "TIN", "EIN", "SSN", "NIE", "DNI", "CNPJ", "CPF", "DUNS", "FEDERAL_TAX_ID", "STATE_TAX_ID", "BUSINESS_NATIONAL", "PERSONAL_NATIONAL", "BUSINESS_UNION", "PERSONAL_UNION"
].map(type => ({ value: type, label: type.replace(/_/g, ' ') }));

const currencyCodes = [
  { value: 'TRY', label: 'Turkish Lira (TRY)' },
  { value: 'USD', label: 'US Dollar (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
];

const AyarlarPage = () => {
  const router = useRouter();

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
    if (!window.confirm('Tüm siparişleri tekrar senkronize etmek istediğinize emin misiniz? Bu işlem uzun sürebilir.')) return;
    setIsFullSyncLoading(true);
    try {
      const res = await fetch('/api/orders/fullSync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tam senkronizasyon başlatılamadı');
      setSnackbar({ open: true, message: 'Tam senkronizasyon başlatıldı. Senkron geçmişinden ilerlemeyi takip edebilirsiniz.', severity: 'success' });
      fetchSyncHistory();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Tam senkronizasyon başlatılamadı', severity: 'error' });
    } finally {
      setIsFullSyncLoading(false);
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
        setSyncHistoryError(data.error || 'Senkron geçmişi alınamadı.');
      }
    } catch (err: any) {
      setSyncHistoryError(err.message || 'Senkron geçmişi alınamadı.');
    } finally {
      setSyncHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncHistory();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const response = await axios.get<UserSettingsResponse>('/api/user/settings', { 
          withCredentials: true,
          timeout: 10000
        });
        setFormData({
          integrationSettings: response.data.integrationSettings || initialFormData.integrationSettings,
          shipperProfile: response.data.shipperProfile || initialFormData.shipperProfile,
        });
        setSubscriptionData(response.data.subscription || null);
        setInitialDataLoaded(true);
      } catch (error: any) {
        console.error('Ayarlar alınırken hata:', error);
        setFetchError('Ayarlar yüklenirken hata oluştu. Lütfen sayfayı yenileyin.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleInputChange = (
    section: keyof UserSettingsResponse,
    name: string,
    value: string
  ) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...(prev[section] as object),
        [name]: value,
      },
    }));

    if (section === 'shipperProfile' && name === 'importerOfRecord') {
      try {
        if (value.trim() !== '') JSON.parse(value);
        setImporterJsonError(null);
      } catch (err) {
        setImporterJsonError('Geçersiz JSON formatı.');
      }
    }
  };
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (importerJsonError) {
      setSnackbar({ open: true, message: 'Lütfen Importer of Record JSON hatasını düzeltin.', severity: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      await axios.patch('/api/user/settings', formData, { withCredentials: true });
      setSnackbar({ open: true, message: 'Ayarlar başarıyla kaydedildi!', severity: 'success' });
    } catch (error: any) {
      console.error('Ayarlar kaydedilirken hata:', error);
      let errorMessage = 'Ayarlar kaydedilemedi.';
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage += ` Hata: ${error.response.data.error}`;
      } else if (error.message) {
        errorMessage += ` Hata: ${error.message}`;
      }
      setSnackbar({ open: true, message: errorMessage, severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetrySync = async (syncId: string) => {
    if (!window.confirm('Bu senkronizasyonu yeniden başlatmak istediğinize emin misiniz?')) return;
    setRetryingSyncId(syncId);
    try {
      const res = await fetch(`/api/sync/retry?id=${encodeURIComponent(syncId)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tekrar başlatılamadı');
      fetchSyncHistory();
    } catch (err: any) {
      alert(err.message || 'Tekrar başlatılamadı');
    } finally {
      setRetryingSyncId(null);
    }
  };

  if (isLoading && !initialDataLoaded) {
    console.log('Showing loading screen - isLoading:', isLoading, 'initialDataLoaded:', initialDataLoaded);
    return (
      <AppLayout title="Ayarlar - Yükleniyor">
        <Container sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Yükleniyor...</Typography>
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
        message: error.response?.data?.error || 'Abonelik yönetimi açılamadı.', 
        severity: 'error' 
      });
    }
  };

  const handleViewBillingHistory = () => {
    router.push('/faturalar');
  };

  try {
    return (
      <AppLayout title="Ayarlar">
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
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
            <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
              <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1 }}>
                API Entegrasyonları
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Veeqo API Key" name="veeqoApiKey" type="password" value={formData.integrationSettings?.veeqoApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Shippo Token" name="shippoToken" type="password" value={formData.integrationSettings?.shippoToken || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Trendyol API Key" name="trendyolApiKey" type="password" value={formData.integrationSettings?.trendyolApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Trendyol API Secret" name="trendyolApiSecret" type="password" value={formData.integrationSettings?.trendyolApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Trendyol Supplier ID" name="trendyolSupplierId" value={formData.integrationSettings?.trendyolSupplierId || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="FedEx API Key" name="fedexApiKey" type="password" value={formData.integrationSettings?.fedexApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="FedEx API Secret" name="fedexApiSecret" type="password" value={formData.integrationSettings?.fedexApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="FedEx Account Number" name="fedexAccountNumber" value={formData.integrationSettings?.fedexAccountNumber || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="UPS API Key" name="upsApiKey" type="password" value={formData.integrationSettings?.upsApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="UPS API Secret" name="upsApiSecret" type="password" value={formData.integrationSettings?.upsApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="UPS Account Number" name="upsAccountNumber" value={formData.integrationSettings?.upsAccountNumber || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
                </Grid>
              </Grid>
            </Paper>

            <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
              <Typography variant="h5" component="h2" gutterBottom sx={{ mb: 2, borderBottom: '1px solid #ddd', pb: 1 }}>
                Gönderici Profili
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Şirket Adı" name="shipperName" value={formData.shipperProfile?.shipperName || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Yetkili Kişi" name="shipperPersonName" value={formData.shipperProfile?.shipperPersonName || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Telefon" name="shipperPhoneNumber" value={formData.shipperProfile?.shipperPhoneNumber || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="FedEx Klasör ID" name="fedexFolderId" value={formData.shipperProfile?.fedexFolderId || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Adres 1" name="shipperStreet1" value={formData.shipperProfile?.shipperStreet1 || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Adres 2" name="shipperStreet2" value={formData.shipperProfile?.shipperStreet2 || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Şehir" name="shipperCity" value={formData.shipperProfile?.shipperCity || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Eyalet/Bölge Kodu" name="shipperStateCode" value={formData.shipperProfile?.shipperStateCode || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Posta Kodu" name="shipperPostalCode" value={formData.shipperProfile?.shipperPostalCode || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="shipperCountryCode-label">Ülke Kodu</InputLabel>
                    <Select
                      labelId="shipperCountryCode-label"
                      name="shipperCountryCode"
                      label="Ülke Kodu"
                      value={formData.shipperProfile?.shipperCountryCode || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {countryCodes.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Vergi No" name="shipperTinNumber" value={formData.shipperProfile?.shipperTinNumber || ''} onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)} required />
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="shipperTinType-label">Vergi Tipi</InputLabel>
                    <Select
                      labelId="shipperTinType-label"
                      name="shipperTinType"
                      label="Vergi Tipi"
                      value={formData.shipperProfile?.shipperTinType || ''}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {tinTypes.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="defaultCurrencyCode-label">Varsayılan Para Birimi</InputLabel>
                    <Select
                      labelId="defaultCurrencyCode-label"
                      name="defaultCurrencyCode"
                      label="Varsayılan Para Birimi"
                      value={formData.shipperProfile?.defaultCurrencyCode || 'USD'}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {currencyCodes.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth required>
                    <InputLabel id="dutiesPaymentType-label">Gümrük Ödeme Tipi</InputLabel>
                    <Select
                      labelId="dutiesPaymentType-label"
                      name="dutiesPaymentType"
                      label="Gümrük Ödeme Tipi"
                      value={formData.shipperProfile?.dutiesPaymentType || 'SENDER'}
                      onChange={(e: SelectChangeEvent<string>) => handleInputChange('shipperProfile', e.target.name as string, e.target.value as string)}
                    >
                      {(fedexOptionsData.dutiesPaymentTypes as FedExOption[]).map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={4}>
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
                  <TextField
                    fullWidth
                    label="Importer of Record (JSON)"
                    name="importerOfRecord"
                    multiline
                    rows={4}
                    value={formData.shipperProfile?.importerOfRecord || ''}
                    onChange={(e) => handleInputChange('shipperProfile', e.target.name, e.target.value)}
                    error={!!importerJsonError}
                    helperText={importerJsonError || 'Serbest formatlı JSON objesi girin veya boş bırakın.'}
                    placeholder='{ "contact": { "personName": "...", ... } }'
                  />
                </Grid>
              </Grid>
            </Paper>

            {/* --- Sync History Section --- */}
            <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography variant="h5" component="h2" sx={{ fontWeight: 'bold', flex: 1 }}>
                  Senkron Geçmişi
                </Typography>
                <IconButton onClick={() => { setSyncHistoryCursor(null); setSyncHistoryEnd(false); fetchSyncHistory(); }} disabled={syncHistoryLoading}>
                  <RefreshIcon />
                </IconButton>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Eşitleme Türü</TableCell>
                      <TableCell>Durum</TableCell>
                      <TableCell>Başlangıç</TableCell>
                      <TableCell>Bitiş</TableCell>
                      <TableCell>İşlenen</TableCell>
                      <TableCell>Başarılı</TableCell>
                      <TableCell>Başarısız</TableCell>
                      <TableCell>Hatalar</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {syncHistory.length === 0 && !syncHistoryLoading && (
                      <TableRow>
                        <TableCell colSpan={9} align="center">
                          Henüz senkron geçmişi bulunmamaktadır.
                        </TableCell>
                      </TableRow>
                    )}
                    {syncHistory.map((row, idx) => {
                      let statusColor = 'text.primary';
                      let statusLabel = row.status;
                      if (row.status === 'completed') { statusColor = 'success.main'; statusLabel = 'Tamamlandı'; }
                      else if (row.status === 'failed') { statusColor = 'error.main'; statusLabel = 'Başarısız'; }
                      else if (row.status === 'in_progress') { statusColor = 'info.main'; statusLabel = 'Devam Ediyor'; }
                      return (
                        <TableRow key={row.id}>
                          <TableCell>{row.type}</TableCell>
                          <TableCell sx={{ color: statusColor, fontWeight: 'bold' }}>{statusLabel}</TableCell>
                          <TableCell>{row.startedAt ? new Date(row.startedAt).toLocaleString('tr-TR') : '-'}</TableCell>
                          <TableCell>{row.endedAt ? new Date(row.endedAt).toLocaleString('tr-TR') : '-'}</TableCell>
                          <TableCell>{row.processedOrders}</TableCell>
                          <TableCell>{row.successfulOrders}</TableCell>
                          <TableCell>{row.failedOrders}</TableCell>
                          <TableCell>
                            {row.errors && row.errors.length > 0 ? (
                              <Tooltip title="Hata detaylarını görmek için tıklayın">
                                <Button size="small" color="error" onClick={() => alert(JSON.stringify(row.errors, null, 2))}>
                                  {row.errors.length}
                                </Button>
                              </Tooltip>
                            ) : 0}
                          </TableCell>
                          <TableCell>
                            {row.status === 'failed' && (
                              <Tooltip title="Tekrar Dene">
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
                    Daha Fazla Yükle
                  </Button>
                )}
                {!syncHistoryLoading && syncHistoryEnd && syncHistory.length > 0 && (
                  <Typography sx={{ color: 'text.secondary', ml: 2 }}>
                    Daha fazla kayıt bulunamadı.
                  </Typography>
                )}
              </Box>
            </Paper>

            {/* --- Full Sync Button --- */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button
                variant="contained"
                color="secondary"
                disabled={isFullSyncLoading}
                onClick={handleFullSync}
                startIcon={isFullSyncLoading ? <CircularProgress size={20} color="inherit" /> : <ReplayIcon />}
              >
                {isFullSyncLoading ? 'Tam Senkronizasyon Başlatılıyor...' : 'Tam Senkronizasyon (Full Sync)'}
              </Button>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
              <Button type="submit" variant="contained" color="primary" disabled={isSubmitting || isLoading || !!importerJsonError} size="large">
                {isSubmitting ? <CircularProgress size={24} color="inherit" /> : 'Ayarları Kaydet'}
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
      <AppLayout title="Ayarlar - Hata">
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Hata
          </Typography>
          <Typography>
            Sayfa yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.
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