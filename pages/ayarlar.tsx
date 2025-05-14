import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import axios, { AxiosError } from 'axios'; // Import AxiosError
import Grid from '@mui/material/Grid';
import {
  Container, TextField, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel, FormHelperText, Box, Snackbar, Alert, AlertColor, SelectChangeEvent
} from '@mui/material';
import { fedexOptionsData, FedExOption } from '../lib/fedexConfig'; // For dutiesPaymentTypes
import Layout from '../components/Layout'; // Assuming you have a Layout component

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
  const [formData, setFormData] = useState<UserSettingsResponse>(initialFormData);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null); // For initial fetch error
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importerJsonError, setImporterJsonError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: AlertColor }>({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      setFetchError(null); // Reset fetch error on new attempt
      try {
        const response = await axios.get<UserSettingsResponse>('/api/user/settings');
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
      await axios.patch('/api/user/settings', formData);
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
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Veeqo API Key" name="veeqoApiKey" type="password" value={formData.integrationSettings?.veeqoApiKey || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField fullWidth label="Shippo Token" name="shippoToken" type="password" value={formData.integrationSettings?.shippoToken || ''} onChange={(e) => handleInputChange('integrationSettings', e.target.name, e.target.value)} />
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