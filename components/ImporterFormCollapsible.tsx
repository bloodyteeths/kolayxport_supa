import React, { useState, useEffect } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Box,
  Alert,
  Chip,
  SelectChangeEvent
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { TURKISH_CITIES, getRegionCodeForCity } from '../lib/data/turkishLocations';

export interface ImporterData {
  contact: {
    personName: string;
    companyName: string;
    phoneNumber: string;
    emailAddress: string;
  };
  address: {
    streetLines: string[];
    city: string;
    stateOrProvinceCode: string;
    postalCode: string;
    countryCode: string;
  };
  tins?: Array<{
    tinType: string;
    number: string;
    usage?: string;
  }>;
}

interface ImporterFormProps {
  value: string; // JSON string
  onChange: (jsonString: string) => void;
  error?: string | null;
}

const INITIAL_IMPORTER_DATA: ImporterData = {
  contact: {
    personName: '',
    companyName: '',
    phoneNumber: '',
    emailAddress: ''
  },
  address: {
    streetLines: [''],
    city: '',
    stateOrProvinceCode: '',
    postalCode: '',
    countryCode: 'TR'
  },
  tins: []
};

const TIN_TYPES = [
  { value: 'VAT', label: 'KDV Numarası' },
  { value: 'EORI', label: 'EORI Numarası' },
  { value: 'BUSINESS_NATIONAL', label: 'İş Vergi Numarası' },
  { value: 'TIN', label: 'Vergi Kimlik Numarası' }
];

const TIN_USAGE_TYPES = [
  { value: 'IMPORTER_OF_RECORD', label: 'Importer of Record' },
  { value: 'ULTIMATE_CONSIGNEE', label: 'Ultimate Consignee' }
];

const ImporterFormCollapsible: React.FC<ImporterFormProps> = ({
  value,
  onChange,
  error
}) => {
  const [importerData, setImporterData] = useState<ImporterData>(INITIAL_IMPORTER_DATA);
  const [isExpanded, setIsExpanded] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  // Parse JSON value on mount and when it changes
  useEffect(() => {
    if (value && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        setImporterData({
          contact: {
            personName: parsed.contact?.personName || '',
            companyName: parsed.contact?.companyName || '',
            phoneNumber: parsed.contact?.phoneNumber || '',
            emailAddress: parsed.contact?.emailAddress || ''
          },
          address: {
            streetLines: parsed.address?.streetLines || [''],
            city: parsed.address?.city || '',
            stateOrProvinceCode: parsed.address?.stateOrProvinceCode || '',
            postalCode: parsed.address?.postalCode || '',
            countryCode: parsed.address?.countryCode || 'TR'
          },
          tins: parsed.tins || []
        });
        setHasData(true);
        setJsonError(null);
      } catch (e) {
        setJsonError('Geçersiz JSON formatı');
        setHasData(false);
      }
    } else {
      setImporterData(INITIAL_IMPORTER_DATA);
      setHasData(false);
      setJsonError(null);
    }
  }, [value]);

  const handleFormChange = (path: string, newValue: any) => {
    const updatedData = { ...importerData };
    const pathParts = path.split('.');
    
    let current: any = updatedData;
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) {
        current[pathParts[i]] = {};
      }
      current = current[pathParts[i]];
    }
    current[pathParts[pathParts.length - 1]] = newValue;
    
    setImporterData(updatedData);
  };

  const handleCityChange = (cityName: string) => {
    const regionCode = getRegionCodeForCity(cityName);
    handleFormChange('address.city', cityName);
    handleFormChange('address.stateOrProvinceCode', regionCode);
  };

  const addTin = () => {
    const newTins = [...(importerData.tins || []), { tinType: 'VAT', number: '', usage: 'IMPORTER_OF_RECORD' }];
    handleFormChange('tins', newTins);
  };

  const removeTin = (index: number) => {
    const newTins = (importerData.tins || []).filter((_, i) => i !== index);
    handleFormChange('tins', newTins);
  };

  const updateTin = (index: number, field: string, value: string) => {
    const newTins = [...(importerData.tins || [])];
    newTins[index] = { ...newTins[index], [field]: value };
    handleFormChange('tins', newTins);
  };

  const addStreetLine = () => {
    const newStreetLines = [...importerData.address.streetLines, ''];
    handleFormChange('address.streetLines', newStreetLines);
  };

  const removeStreetLine = (index: number) => {
    if (importerData.address.streetLines.length > 1) {
      const newStreetLines = importerData.address.streetLines.filter((_, i) => i !== index);
      handleFormChange('address.streetLines', newStreetLines);
    }
  };

  const updateStreetLine = (index: number, value: string) => {
    const newStreetLines = [...importerData.address.streetLines];
    newStreetLines[index] = value;
    handleFormChange('address.streetLines', newStreetLines);
  };

  const handleSave = () => {
    try {
      // Validate required fields
      if (!importerData.contact.personName || !importerData.contact.companyName) {
        setJsonError('Kişi adı ve şirket adı gereklidir');
        return;
      }

      if (!importerData.address.city || !importerData.address.postalCode) {
        setJsonError('Şehir ve posta kodu gereklidir');
        return;
      }

      // Filter out empty street lines
      const cleanData = {
        ...importerData,
        address: {
          ...importerData.address,
          streetLines: importerData.address.streetLines.filter(line => line.trim() !== '')
        },
        tins: importerData.tins?.filter(tin => tin.number.trim() !== '') || undefined
      };

      // Remove tins if empty
      if (cleanData.tins && cleanData.tins.length === 0) {
        delete cleanData.tins;
      }

      const jsonString = JSON.stringify(cleanData, null, 2);
      onChange(jsonString);
      setJsonError(null);
      setHasData(true);
    } catch (e) {
      setJsonError('Veri kaydedilirken hata oluştu');
    }
  };

  const handleClear = () => {
    setImporterData(INITIAL_IMPORTER_DATA);
    onChange('');
    setHasData(false);
    setJsonError(null);
  };

  return (
    <Accordion 
      expanded={isExpanded} 
      onChange={(_, expanded) => setIsExpanded(expanded)}
      sx={{ mb: 2 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
          <Typography variant="h6">
            Importer of Record Bilgileri
          </Typography>
          {hasData && (
            <Chip 
              label="Yapılandırılmış" 
              color="success" 
              size="small"
            />
          )}
          {!hasData && (
            <Chip 
              label="Yapılandırılmamış" 
              color="default" 
              size="small"
            />
          )}
        </Box>
      </AccordionSummary>
      
      <AccordionDetails>
        <Box sx={{ width: '100%' }}>
          {jsonError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {jsonError}
            </Alert>
          )}
          
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Contact Information */}
          <Typography variant="h6" sx={{ mb: 2, mt: 1 }}>
            İletişim Bilgileri
          </Typography>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Kişi Adı *"
                value={importerData.contact.personName}
                onChange={(e) => handleFormChange('contact.personName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Şirket Adı *"
                value={importerData.contact.companyName}
                onChange={(e) => handleFormChange('contact.companyName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Telefon Numarası"
                value={importerData.contact.phoneNumber}
                onChange={(e) => handleFormChange('contact.phoneNumber', e.target.value)}
                placeholder="905335010211"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="E-posta Adresi"
                type="email"
                value={importerData.contact.emailAddress}
                onChange={(e) => handleFormChange('contact.emailAddress', e.target.value)}
              />
            </Grid>
          </Grid>

          {/* Address Information */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            Adres Bilgileri
          </Typography>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            {/* Street Lines */}
            {importerData.address.streetLines.map((line, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    fullWidth
                    label={`Adres Satırı ${index + 1}${index === 0 ? ' *' : ''}`}
                    value={line}
                    onChange={(e) => updateStreetLine(index, e.target.value)}
                    required={index === 0}
                  />
                  {index > 0 && (
                    <Button 
                      color="error" 
                      onClick={() => removeStreetLine(index)}
                      sx={{ minWidth: 'auto', px: 2 }}
                    >
                      Sil
                    </Button>
                  )}
                  {index === importerData.address.streetLines.length - 1 && (
                    <Button 
                      color="primary" 
                      onClick={addStreetLine}
                      sx={{ minWidth: 'auto', px: 2 }}
                    >
                      +
                    </Button>
                  )}
                </Box>
              </Grid>
            ))}

            <Grid item xs={12} md={4}>
              <FormControl fullWidth required>
                <InputLabel>Şehir *</InputLabel>
                <Select
                  value={importerData.address.city}
                  onChange={(e: SelectChangeEvent<string>) => handleCityChange(e.target.value)}
                  label="Şehir *"
                >
                  {TURKISH_CITIES.map(city => (
                    <MenuItem key={city.code} value={city.name}>
                      {city.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Bölge Kodu (Otomatik)"
                value={importerData.address.stateOrProvinceCode}
                InputProps={{ readOnly: true }}
                helperText="Şehir seçimine göre otomatik belirlenir"
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Posta Kodu *"
                value={importerData.address.postalCode}
                onChange={(e) => handleFormChange('address.postalCode', e.target.value)}
                required
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Ülke Kodu"
                value={importerData.address.countryCode}
                InputProps={{ readOnly: true }}
                helperText="Türkiye için TR sabitlenmiştir"
              />
            </Grid>
          </Grid>

          {/* TIN Information */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Vergi Numaraları
            </Typography>
            <Button color="primary" onClick={addTin}>
              Vergi Numarası Ekle
            </Button>
          </Box>

          {importerData.tins?.map((tin, index) => (
            <Grid container spacing={3} key={index} sx={{ mb: 2, p: 2, border: '1px solid #ddd', borderRadius: 1 }}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Vergi Tipi</InputLabel>
                  <Select
                    value={tin.tinType}
                    onChange={(e: SelectChangeEvent<string>) => updateTin(index, 'tinType', e.target.value)}
                    label="Vergi Tipi"
                  >
                    {TIN_TYPES.map(type => (
                      <MenuItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Vergi Numarası"
                  value={tin.number}
                  onChange={(e) => updateTin(index, 'number', e.target.value)}
                />
              </Grid>

              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Kullanım Amacı</InputLabel>
                  <Select
                    value={tin.usage || ''}
                    onChange={(e: SelectChangeEvent<string>) => updateTin(index, 'usage', e.target.value)}
                    label="Kullanım Amacı"
                  >
                    {TIN_USAGE_TYPES.map(usage => (
                      <MenuItem key={usage.value} value={usage.value}>
                        {usage.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={1}>
                <Button 
                  color="error" 
                  onClick={() => removeTin(index)}
                  sx={{ height: '56px' }}
                >
                  Sil
                </Button>
              </Grid>
            </Grid>
          ))}

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 3 }}>
            <Button variant="outlined" onClick={handleClear}>
              Temizle
            </Button>
            <Button variant="contained" onClick={handleSave} color="primary">
              Kaydet
            </Button>
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export default ImporterFormCollapsible;