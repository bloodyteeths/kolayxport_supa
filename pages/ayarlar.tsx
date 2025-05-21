import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
// @ts-ignore
import axios from 'axios';
import { Grid } from '@mui/material';
import {
  Container, TextField, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel, FormHelperText, Box, Snackbar, Alert, AlertColor, SelectChangeEvent, Tooltip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton
} from '@mui/material';
import { fedexOptionsData, FedExOption } from '../lib/fedex/fedex.config'; // For dutiesPaymentTypes
import Layout from '../components/Layout'; // Assuming you have a Layout component
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';

// Mirrored from API route
interface UserSettingsResponse {
  integrationSettings?: {
    veeqoApiKey?: string | null;
    shippoToken?: string | null;
    fedexApiKey?: string | null;
    fedexApiSecret?: string | null;
    fedexAccountNumber?: string | null;
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
    fedexApiKey: '',
    fedexApiSecret: '',
    fedexAccountNumber: '',
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
  const [loadingFullSync, setLoadingFullSync] = useState(false);
  const [fullSyncStarted, setFullSyncStarted] = useState(false);
  const [loadingShippoSync, setLoadingShippoSync] = useState(false);
  const [shippoSyncStarted, setShippoSyncStarted] = useState(false);
  const [loadingRecentSync, setLoadingRecentSync] = useState(false);

  // Full sync handler
  const handleFullSync = async () => {
    setLoadingFullSync(true);
    setFullSyncStarted(false);
    try {
      const response = await fetch('/api/orders/full-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Senkronizasyon başlatılamadı');
      }

      const result = await response.json();
      // Show success message or handle the response
      alert('Senkronizasyon başlatıldı. Bu işlem arka planda devam edecek.');
    } catch (error) {
      console.error('Full sync error:', error);
      alert(error instanceof Error ? error.message : 'Senkronizasyon başlatılamadı');
    } finally {
      setLoadingFullSync(false);
    }
  };

  // Shippo sync handler
  const handleShippoSync = async () => {
    setLoadingShippoSync(true);
    setShippoSyncStarted(false);
    try {
      const response = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Shippo senkronizasyonu başlatılamadı');
      }

      const result = await response.json();
      alert('Shippo senkronizasyonu başlatıldı. Bu işlem arka planda devam edecek.');
    } catch (error) {
      console.error('Shippo sync error:', error);
      alert(error instanceof Error ? error.message : 'Shippo senkronizasyonu başlatılamadı');
    } finally {
      setLoadingShippoSync(false);
    }
  };

  const [formData, setFormData] = useState<UserSettingsResponse>(initialFormData);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null); // For initial fetch error
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importerJsonError, setImporterJsonError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: AlertColor }>({ open: false, message: '', severity: 'success' });

  // --- Sync History State ---
  const [syncHistory, setSyncHistory] = useState<any[]>([]);
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
      setFetchError(null); // Reset fetch error on new attempt
      try {
        const response = await axios.get<UserSettingsResponse>('/api/user/settings', { withCredentials: true });
        setFormData({
          integrationSettings: response.data.integrationSettings || initialFormData.integrationSettings,
          shipperProfile: response.data.shipperProfile || initialFormData.shipperProfile,
        });
        setInitialDataLoaded(true);
      } catch (error) {
        console.error('Ayarlar alınırken hata:', error);
        setFetchError('Ayarlar yüklenirken hata oluştu.'); // Set fetch error message
        // Snackbar for fetch error is optional, Alert is primary as requested
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
    return (
      <Layout>
        <Container sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Yükleniyor...</Typography>
        </Container>
      </Layout>
    );
  }

  return (
    <Layout>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
          Kullanıcı Ayarları
        </Typography>
        
        {fetchError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {fetchError}
          </Alert>
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

              {/* Veeqo Full & Recent Sync Section */}
              {formData.integrationSettings?.veeqoApiKey && (
                <Grid item xs={12}>
                  <Paper elevation={1} sx={{ p: 2, bgcolor: 'info.light', color: 'info.contrastText' }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Veeqo Siparişlerini Senkronize Et
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      Veeqo'dan siparişleri senkronize etmek için aşağıdaki butonları kullanın. "Yakın Tarihli" sadece son güncellenenleri, "Tüm Siparişler" ise tüm siparişleri çeker.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleFullSync}
                        disabled={loadingFullSync || isLoading}
                        startIcon={loadingFullSync ? <CircularProgress size={20} color="inherit" /> : null}
                    >
                        {loadingFullSync ? 'Tüm Siparişler Senkronize Ediliyor...' : 'Tüm Siparişleri Senkron Et'}
                      </Button>
                      <Button
                        variant="outlined"
                        color="secondary"
                        onClick={async () => {
                          setLoadingRecentSync(true);
                          try {
                            const response = await fetch('/api/orders/sync', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                            });
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.message || 'Yakın tarihli senkronizasyon başlatılamadı');
                            }
                            await response.json();
                            alert('Yakın tarihli siparişler senkronize edildi.');
                          } catch (error) {
                            console.error('Recent sync error:', error);
                            alert(error instanceof Error ? error.message : 'Yakın tarihli senkronizasyon başlatılamadı');
                          } finally {
                            setLoadingRecentSync(false);
                          }
                        }}
                        disabled={loadingRecentSync || isLoading}
                        startIcon={loadingRecentSync ? <CircularProgress size={20} color="inherit" /> : null}
                      >
                        {loadingRecentSync ? 'Yakın Tarihli Senkronize Ediliyor...' : 'Yakın Tarihli Siparişleri Senkron Et'}
                    </Button>
                    </Box>
                  </Paper>
                </Grid>
              )}
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Shippo Token" name="shippoToken" type="password" value={formData.integrationSettings?.shippoToken || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
              </Grid>
              {/* Shippo Full Sync Section */}
              {formData.integrationSettings?.shippoToken && (
                <Grid item xs={12}>
                  <Paper elevation={1} sx={{ p: 2, bgcolor: 'info.light', color: 'info.contrastText', mt: 2 }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Shippo siparişlerini senkronize et
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      Shippo'dan tüm siparişleri tek seferde senkronize etmek için bu butonu kullanın. Bu işlem biraz zaman alabilir.
                    </Typography>
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={handleShippoSync}
                      disabled={loadingShippoSync}
                      startIcon={loadingShippoSync ? <CircularProgress size={20} color="inherit" /> : null}
                    >
                      {loadingShippoSync ? 'Shippo Senkronizasyonu Başlatılıyor...' : 'Shippo Senkronizasyonu'}
                    </Button>
                  </Paper>
                </Grid>
              )}
              <Grid item xs={12} md={4}>
                <TextField fullWidth label="FedEx API Key" name="fedexApiKey" type="password" value={formData.integrationSettings?.fedexApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth label="FedEx API Secret" name="fedexApiSecret" type="password" value={formData.integrationSettings?.fedexApiSecret || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField fullWidth label="FedEx Account Number" name="fedexAccountNumber" value={formData.integrationSettings?.fedexAccountNumber || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
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
    </Layout>
  );
};

// If you are using a custom App with a Layout pattern
// AyarlarPage.getLayout = function getLayout(page: React.ReactElement) {
//   return <Layout>{page}</Layout>;
// };

export default AyarlarPage; 