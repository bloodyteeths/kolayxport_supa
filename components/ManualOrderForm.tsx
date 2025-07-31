import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Typography,
  IconButton,
  Box,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Autocomplete
} from '@mui/material';
import { Close as CloseIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { toast } from 'react-hot-toast';

interface OrderItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  weight: number;
  sku: string;
  hsCode: string;
  countryOfOrigin: string;
}

interface ManualOrderData {
  // Customer info
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  
  // Order info
  orderNumber: string;
  currency: string;
  
  // Shipping address
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  
  // Items
  items: OrderItem[];
}

interface ManualOrderFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const initialOrderData: ManualOrderData = {
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  orderNumber: '',
  currency: 'TRY',
  street1: '',
  street2: '',
  city: '',
  state: '',
  postal: '',
  country: 'TR',
  items: [{
    productName: '',
    quantity: 1,
    unitPrice: 0,
    weight: 0.5,
    sku: '',
    hsCode: '',
    countryOfOrigin: 'TR'
  }]
};

const currencies = [
  { value: 'TRY', label: 'Türk Lirası (TRY)', symbol: '₺' },
  { value: 'USD', label: 'ABD Doları (USD)', symbol: '$' },
  { value: 'EUR', label: 'Euro (EUR)', symbol: '€' },
  { value: 'GBP', label: 'İngiliz Sterlini (GBP)', symbol: '£' },
  { value: 'CAD', label: 'Kanada Doları (CAD)', symbol: 'C$' },
  { value: 'AUD', label: 'Avustralya Doları (AUD)', symbol: 'A$' },
  { value: 'JPY', label: 'Japon Yeni (JPY)', symbol: '¥' },
  { value: 'CHF', label: 'İsviçre Frangı (CHF)', symbol: 'CHF' },
  { value: 'CNY', label: 'Çin Yuanı (CNY)', symbol: '¥' },
  { value: 'SEK', label: 'İsveç Kronu (SEK)', symbol: 'kr' },
  { value: 'NOK', label: 'Norveç Kronu (NOK)', symbol: 'kr' },
  { value: 'DKK', label: 'Danimarka Kronu (DKK)', symbol: 'kr' },
  { value: 'PLN', label: 'Polonya Zlotisi (PLN)', symbol: 'zł' },
  { value: 'CZK', label: 'Çek Korunası (CZK)', symbol: 'Kč' },
  { value: 'HUF', label: 'Macar Forinti (HUF)', symbol: 'Ft' },
  { value: 'RON', label: 'Romen Leyi (RON)', symbol: 'lei' },
  { value: 'BGN', label: 'Bulgar Levası (BGN)', symbol: 'лв' },
  { value: 'HRK', label: 'Hırvat Kunası (HRK)', symbol: 'kn' },
  { value: 'RUB', label: 'Rus Rublesi (RUB)', symbol: '₽' },
  { value: 'INR', label: 'Hindistan Rupisi (INR)', symbol: '₹' },
  { value: 'KRW', label: 'Güney Kore Wonu (KRW)', symbol: '₩' },
  { value: 'SGD', label: 'Singapur Doları (SGD)', symbol: 'S$' },
  { value: 'HKD', label: 'Hong Kong Doları (HKD)', symbol: 'HK$' },
  { value: 'NZD', label: 'Yeni Zelanda Doları (NZD)', symbol: 'NZ$' },
  { value: 'MXN', label: 'Meksika Pezosu (MXN)', symbol: '$' },
  { value: 'BRL', label: 'Brezilya Reali (BRL)', symbol: 'R$' },
  { value: 'ARS', label: 'Arjantin Pezosu (ARS)', symbol: '$' },
  { value: 'CLP', label: 'Şili Pezosu (CLP)', symbol: '$' },
  { value: 'ZAR', label: 'Güney Afrika Randı (ZAR)', symbol: 'R' },
  { value: 'AED', label: 'BAE Dirhemi (AED)', symbol: 'د.إ' },
  { value: 'SAR', label: 'Suudi Arabistan Riyali (SAR)', symbol: '﷼' },
  { value: 'QAR', label: 'Katar Riyali (QAR)', symbol: '﷼' },
  { value: 'KWD', label: 'Kuveyt Dinarı (KWD)', symbol: 'د.ك' },
  { value: 'BHD', label: 'Bahreyn Dinarı (BHD)', symbol: '.د.ب' },
  { value: 'OMR', label: 'Umman Riyali (OMR)', symbol: '﷼' },
  { value: 'JOD', label: 'Ürdün Dinarı (JOD)', symbol: 'د.ا' },
  { value: 'LBP', label: 'Lübnan Lirası (LBP)', symbol: '£' },
  { value: 'EGP', label: 'Mısır Lirası (EGP)', symbol: '£' },
  { value: 'ILS', label: 'İsrail Şekeli (ILS)', symbol: '₪' },
  { value: 'THB', label: 'Tayland Bahtı (THB)', symbol: '฿' },
  { value: 'MYR', label: 'Malezya Ringiti (MYR)', symbol: 'RM' },
  { value: 'IDR', label: 'Endonezya Rupiahı (IDR)', symbol: 'Rp' },
  { value: 'PHP', label: 'Filipin Pezosu (PHP)', symbol: '₱' },
  { value: 'VND', label: 'Vietnam Dongu (VND)', symbol: '₫' }
];

const countries = [
  { value: 'TR', label: 'Türkiye', flag: '🇹🇷' },
  { value: 'US', label: 'Amerika Birleşik Devletleri', flag: '🇺🇸' },
  { value: 'DE', label: 'Almanya', flag: '🇩🇪' },
  { value: 'GB', label: 'Birleşik Krallık', flag: '🇬🇧' },
  { value: 'FR', label: 'Fransa', flag: '🇫🇷' },
  { value: 'IT', label: 'İtalya', flag: '🇮🇹' },
  { value: 'ES', label: 'İspanya', flag: '🇪🇸' },
  { value: 'NL', label: 'Hollanda', flag: '🇳🇱' },
  { value: 'BE', label: 'Belçika', flag: '🇧🇪' },
  { value: 'AT', label: 'Avusturya', flag: '🇦🇹' },
  { value: 'CH', label: 'İsviçre', flag: '🇨🇭' },
  { value: 'SE', label: 'İsveç', flag: '🇸🇪' },
  { value: 'NO', label: 'Norveç', flag: '🇳🇴' },
  { value: 'DK', label: 'Danimarka', flag: '🇩🇰' },
  { value: 'FI', label: 'Finlandiya', flag: '🇫🇮' },
  { value: 'PL', label: 'Polonya', flag: '🇵🇱' },
  { value: 'CZ', label: 'Çek Cumhuriyeti', flag: '🇨🇿' },
  { value: 'HU', label: 'Macaristan', flag: '🇭🇺' },
  { value: 'SK', label: 'Slovakya', flag: '🇸🇰' },
  { value: 'SI', label: 'Slovenya', flag: '🇸🇮' },
  { value: 'HR', label: 'Hırvatistan', flag: '🇭🇷' },
  { value: 'RS', label: 'Sırbistan', flag: '🇷🇸' },
  { value: 'BG', label: 'Bulgaristan', flag: '🇧🇬' },
  { value: 'RO', label: 'Romanya', flag: '🇷🇴' },
  { value: 'GR', label: 'Yunanistan', flag: '🇬🇷' },
  { value: 'CY', label: 'Kıbrıs', flag: '🇨🇾' },
  { value: 'MT', label: 'Malta', flag: '🇲🇹' },
  { value: 'LU', label: 'Lüksemburg', flag: '🇱🇺' },
  { value: 'IE', label: 'İrlanda', flag: '🇮🇪' },
  { value: 'PT', label: 'Portekiz', flag: '🇵🇹' },
  { value: 'CA', label: 'Kanada', flag: '🇨🇦' },
  { value: 'MX', label: 'Meksika', flag: '🇲🇽' },
  { value: 'BR', label: 'Brezilya', flag: '🇧🇷' },
  { value: 'AR', label: 'Arjantin', flag: '🇦🇷' },
  { value: 'CL', label: 'Şili', flag: '🇨🇱' },
  { value: 'CO', label: 'Kolombiya', flag: '🇨🇴' },
  { value: 'PE', label: 'Peru', flag: '🇵🇪' },
  { value: 'UY', label: 'Uruguay', flag: '🇺🇾' },
  { value: 'PY', label: 'Paraguay', flag: '🇵🇾' },
  { value: 'BO', label: 'Bolivya', flag: '🇧🇴' },
  { value: 'EC', label: 'Ekvador', flag: '🇪🇨' },
  { value: 'VE', label: 'Venezuela', flag: '🇻🇪' },
  { value: 'AU', label: 'Avustralya', flag: '🇦🇺' },
  { value: 'NZ', label: 'Yeni Zelanda', flag: '🇳🇿' },
  { value: 'JP', label: 'Japonya', flag: '🇯🇵' },
  { value: 'KR', label: 'Güney Kore', flag: '🇰🇷' },
  { value: 'CN', label: 'Çin', flag: '🇨🇳' },
  { value: 'IN', label: 'Hindistan', flag: '🇮🇳' },
  { value: 'SG', label: 'Singapur', flag: '🇸🇬' },
  { value: 'HK', label: 'Hong Kong', flag: '🇭🇰' },
  { value: 'TW', label: 'Tayvan', flag: '🇹🇼' },
  { value: 'MY', label: 'Malezya', flag: '🇲🇾' },
  { value: 'TH', label: 'Tayland', flag: '🇹🇭' },
  { value: 'ID', label: 'Endonezya', flag: '🇮🇩' },
  { value: 'PH', label: 'Filipinler', flag: '🇵🇭' },
  { value: 'VN', label: 'Vietnam', flag: '🇻🇳' },
  { value: 'RU', label: 'Rusya', flag: '🇷🇺' },
  { value: 'UA', label: 'Ukrayna', flag: '🇺🇦' },
  { value: 'BY', label: 'Belarus', flag: '🇧🇾' },
  { value: 'KZ', label: 'Kazakistan', flag: '🇰🇿' },
  { value: 'UZ', label: 'Özbekistan', flag: '🇺🇿' },
  { value: 'AZ', label: 'Azerbaycan', flag: '🇦🇿' },
  { value: 'GE', label: 'Gürcistan', flag: '🇬🇪' },
  { value: 'AM', label: 'Ermenistan', flag: '🇦🇲' },
  { value: 'IL', label: 'İsrail', flag: '🇮🇱' },
  { value: 'SA', label: 'Suudi Arabistan', flag: '🇸🇦' },
  { value: 'AE', label: 'Birleşik Arap Emirlikleri', flag: '🇦🇪' },
  { value: 'QA', label: 'Katar', flag: '🇶🇦' },
  { value: 'KW', label: 'Kuveyt', flag: '🇰🇼' },
  { value: 'BH', label: 'Bahreyn', flag: '🇧🇭' },
  { value: 'OM', label: 'Umman', flag: '🇴🇲' },
  { value: 'JO', label: 'Ürdün', flag: '🇯🇴' },
  { value: 'LB', label: 'Lübnan', flag: '🇱🇧' },
  { value: 'SY', label: 'Suriye', flag: '🇸🇾' },
  { value: 'IQ', label: 'Irak', flag: '🇮🇶' },
  { value: 'IR', label: 'İran', flag: '🇮🇷' },
  { value: 'AF', label: 'Afganistan', flag: '🇦🇫' },
  { value: 'PK', label: 'Pakistan', flag: '🇵🇰' },
  { value: 'BD', label: 'Bangladeş', flag: '🇧🇩' },
  { value: 'LK', label: 'Sri Lanka', flag: '🇱🇰' },
  { value: 'NP', label: 'Nepal', flag: '🇳🇵' },
  { value: 'BT', label: 'Bhutan', flag: '🇧🇹' },
  { value: 'MV', label: 'Maldivler', flag: '🇲🇻' },
  { value: 'EG', label: 'Mısır', flag: '🇪🇬' },
  { value: 'LY', label: 'Libya', flag: '🇱🇾' },
  { value: 'TN', label: 'Tunus', flag: '🇹🇳' },
  { value: 'DZ', label: 'Cezayir', flag: '🇩🇿' },
  { value: 'MA', label: 'Fas', flag: '🇲🇦' },
  { value: 'ZA', label: 'Güney Afrika', flag: '🇿🇦' },
  { value: 'NG', label: 'Nijerya', flag: '🇳🇬' },
  { value: 'KE', label: 'Kenya', flag: '🇰🇪' },
  { value: 'ET', label: 'Etiyopya', flag: '🇪🇹' },
  { value: 'GH', label: 'Gana', flag: '🇬🇭' },
  { value: 'CI', label: 'Fildişi Sahili', flag: '🇨🇮' },
  { value: 'SN', label: 'Senegal', flag: '🇸🇳' },
  { value: 'TZ', label: 'Tanzanya', flag: '🇹🇿' },
  { value: 'UG', label: 'Uganda', flag: '🇺🇬' },
  { value: 'RW', label: 'Ruanda', flag: '🇷🇼' },
  { value: 'MU', label: 'Mauritius', flag: '🇲🇺' },
  { value: 'SC', label: 'Seyşeller', flag: '🇸🇨' }
];

const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' }
];

export default function ManualOrderForm({ open, onClose, onSuccess }: ManualOrderFormProps) {
  const [orderData, setOrderData] = useState<ManualOrderData>(initialOrderData);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Clear state when switching from US to another country
  React.useEffect(() => {
    if (orderData.country !== 'US' && orderData.state && US_STATES.some(s => s.value === orderData.state)) {
      setOrderData(prev => ({ ...prev, state: '' }));
    }
  }, [orderData.country, orderData.state]);

  const handleClose = () => {
    setOrderData(initialOrderData);
    setErrors({});
    onClose();
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Required fields validation
    if (!orderData.customerName.trim()) newErrors.customerName = 'Müşteri adı gerekli';
    if (!orderData.orderNumber.trim()) newErrors.orderNumber = 'Sipariş numarası gerekli';
    if (!orderData.street1.trim()) newErrors.street1 = 'Adres 1 gerekli';
    if (!orderData.city.trim()) newErrors.city = 'Şehir gerekli';
    if (!orderData.postal.trim()) newErrors.postal = 'Posta kodu gerekli';
    
    // US specific validations
    if (orderData.country === 'US' && !orderData.state.trim()) {
      newErrors.state = 'ABD adresleri için eyalet gerekli';
    }

    // Items validation
    orderData.items.forEach((item, index) => {
      if (!item.productName.trim()) {
        newErrors[`item_${index}_productName`] = 'Ürün adı gerekli';
      }
      if (item.quantity <= 0) {
        newErrors[`item_${index}_quantity`] = 'Miktar 0\'dan büyük olmalı';
      }
      if (item.unitPrice <= 0) {
        newErrors[`item_${index}_unitPrice`] = 'Birim fiyat 0\'dan büyük olmalı';
      }
      if (item.weight <= 0) {
        newErrors[`item_${index}_weight`] = 'Ağırlık 0\'dan büyük olmalı';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error('Lütfen tüm gerekli alanları doldurun');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/orders/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Sipariş oluşturulurken hata oluştu');
      }

      toast.success('Manuel sipariş başarıyla oluşturuldu');
      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Error creating manual order:', error);
      toast.error(error instanceof Error ? error.message : 'Sipariş oluşturulurken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setOrderData(prev => ({
      ...prev,
      items: [...prev.items, {
        productName: '',
        quantity: 1,
        unitPrice: 0,
        weight: 0.5,
        sku: '',
        hsCode: '',
        countryOfOrigin: 'TR'
      }]
    }));
  };

  const removeItem = (index: number) => {
    if (orderData.items.length > 1) {
      setOrderData(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }));
    }
  };

  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    setOrderData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const updateField = (field: keyof Omit<ManualOrderData, 'items'>, value: string) => {
    setOrderData(prev => ({ ...prev, [field]: value }));
  };

  const totalPrice = orderData.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const selectedCurrency = currencies.find(c => c.value === orderData.currency);
  const currencySymbol = selectedCurrency?.symbol || orderData.currency;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh' }
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Manuel Sipariş Ekle</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Grid container spacing={3}>
          {/* Customer Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom color="primary">
              Müşteri Bilgileri
            </Typography>
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Müşteri Adı *"
              value={orderData.customerName}
              onChange={(e) => updateField('customerName', e.target.value)}
              error={!!errors.customerName}
              helperText={errors.customerName}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="E-posta"
              type="email"
              value={orderData.customerEmail}
              onChange={(e) => updateField('customerEmail', e.target.value)}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Telefon"
              value={orderData.customerPhone}
              onChange={(e) => updateField('customerPhone', e.target.value)}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Sipariş Numarası *"
              value={orderData.orderNumber}
              onChange={(e) => updateField('orderNumber', e.target.value)}
              error={!!errors.orderNumber}
              helperText={errors.orderNumber}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={currencies}
              getOptionLabel={(option) => option.label}
              value={currencies.find(c => c.value === orderData.currency) || null}
              onChange={(_, newValue) => updateField('currency', newValue?.value || 'TRY')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Para Birimi"
                  placeholder="Para birimi ara..."
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props}>
                  <Box sx={{ mr: 1, fontSize: '1.2em' }}>{option.symbol}</Box>
                  {option.label}
                </Box>
              )}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              filterOptions={(options, { inputValue }) =>
                options.filter(option =>
                  option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                  option.value.toLowerCase().includes(inputValue.toLowerCase())
                )
              }
            />
          </Grid>

          {/* Shipping Address */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom color="primary">
              Teslimat Adresi
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Adres 1 *"
              value={orderData.street1}
              onChange={(e) => updateField('street1', e.target.value)}
              error={!!errors.street1}
              helperText={errors.street1}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Adres 2"
              value={orderData.street2}
              onChange={(e) => updateField('street2', e.target.value)}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Şehir *"
              value={orderData.city}
              onChange={(e) => updateField('city', e.target.value)}
              error={!!errors.city}
              helperText={errors.city}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            {orderData.country === 'US' ? (
              <FormControl fullWidth>
                <InputLabel>Eyalet *</InputLabel>
                <Select
                  value={orderData.state}
                  label="Eyalet *"
                  onChange={(e) => updateField('state', e.target.value)}
                  error={!!errors.state}
                >
                  <MenuItem value="">
                    <em>Eyalet seçin</em>
                  </MenuItem>
                  {US_STATES.map(state => (
                    <MenuItem key={state.value} value={state.value}>
                      {state.label}
                    </MenuItem>
                  ))}
                </Select>
                {errors.state && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    {errors.state}
                  </Typography>
                )}
              </FormControl>
            ) : (
              <TextField
                fullWidth
                label="İl/Eyalet"
                value={orderData.state}
                onChange={(e) => updateField('state', e.target.value)}
                error={!!errors.state}
                helperText={errors.state}
              />
            )}
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Posta Kodu *"
              value={orderData.postal}
              onChange={(e) => updateField('postal', e.target.value)}
              error={!!errors.postal}
              helperText={errors.postal}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={countries}
              getOptionLabel={(option) => option.label}
              value={countries.find(c => c.value === orderData.country) || null}
              onChange={(_, newValue) => updateField('country', newValue?.value || 'TR')}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Ülke"
                  placeholder="Ülke ara..."
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props}>
                  <Box sx={{ mr: 1, fontSize: '1.2em' }}>{option.flag}</Box>
                  {option.label}
                </Box>
              )}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              filterOptions={(options, { inputValue }) =>
                options.filter(option =>
                  option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                  option.value.toLowerCase().includes(inputValue.toLowerCase())
                )
              }
            />
          </Grid>

          {/* Order Items */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" color="primary">
                Ürünler
              </Typography>
              <Button
                startIcon={<AddIcon />}
                onClick={addItem}
                variant="outlined"
                size="small"
              >
                Ürün Ekle
              </Button>
            </Box>
          </Grid>

          {orderData.items.map((item, index) => (
            <Grid item xs={12} key={index}>
              <Box border={1} borderColor="divider" borderRadius={1} p={2} mb={2}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="subtitle1">
                    Ürün {index + 1}
                  </Typography>
                  {orderData.items.length > 1 && (
                    <IconButton onClick={() => removeItem(index)} size="small" color="error">
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Ürün Adı *"
                      value={item.productName}
                      onChange={(e) => updateItem(index, 'productName', e.target.value)}
                      error={!!errors[`item_${index}_productName`]}
                      helperText={errors[`item_${index}_productName`]}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="SKU"
                      value={item.sku}
                      onChange={(e) => updateItem(index, 'sku', e.target.value)}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label="Miktar *"
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                      error={!!errors[`item_${index}_quantity`]}
                      helperText={errors[`item_${index}_quantity`]}
                      inputProps={{ min: 1 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label="Birim Fiyat *"
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                      error={!!errors[`item_${index}_unitPrice`]}
                      helperText={errors[`item_${index}_unitPrice`]}
                      inputProps={{ min: 0, step: 0.01 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label="Ağırlık (kg) *"
                      type="number"
                      value={item.weight}
                      onChange={(e) => updateItem(index, 'weight', parseFloat(e.target.value) || 0)}
                      error={!!errors[`item_${index}_weight`]}
                      helperText={errors[`item_${index}_weight`]}
                      inputProps={{ min: 0.01, step: 0.01 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label="Toplam"
                      value={`${currencySymbol} ${(item.quantity * item.unitPrice).toFixed(2)}`}
                      InputProps={{ readOnly: true }}
                      variant="filled"
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="HS Kodu"
                      value={item.hsCode}
                      onChange={(e) => updateItem(index, 'hsCode', e.target.value)}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      options={countries}
                      getOptionLabel={(option) => option.label}
                      value={countries.find(c => c.value === item.countryOfOrigin) || null}
                      onChange={(_, newValue) => updateItem(index, 'countryOfOrigin', newValue?.value || 'TR')}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Menşei Ülke"
                          placeholder="Ülke ara..."
                          size="small"
                        />
                      )}
                      renderOption={(props, option) => (
                        <Box component="li" {...props}>
                          <Box sx={{ mr: 1, fontSize: '1.1em' }}>{option.flag}</Box>
                          {option.label}
                        </Box>
                      )}
                      isOptionEqualToValue={(option, value) => option.value === value.value}
                      filterOptions={(options, { inputValue }) =>
                        options.filter(option =>
                          option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                          option.value.toLowerCase().includes(inputValue.toLowerCase())
                        )
                      }
                      size="small"
                    />
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          ))}

          {/* Order Total */}
          <Grid item xs={12}>
            <Alert severity="info">
              <Typography variant="h6">
                Toplam Tutar: {currencySymbol} {totalPrice.toFixed(2)}
              </Typography>
            </Alert>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} disabled={loading}>
          İptal
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Oluşturuluyor...' : 'Sipariş Oluştur'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}