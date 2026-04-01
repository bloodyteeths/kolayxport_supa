import React, { useState, useEffect, useMemo } from 'react';
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
import { useTranslations } from 'next-intl';
import { useLocale } from '../lib/i18n/useLocale';

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

function getInitialImporterData(defaultCountry: string): ImporterData {
  return {
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
      countryCode: defaultCountry || ''
    },
    tins: []
  };
}

const TIN_TYPE_CODES = ['VAT', 'EORI', 'BUSINESS_NATIONAL', 'TIN'] as const;
const TIN_USAGE_CODES = ['IMPORTER_OF_RECORD', 'ULTIMATE_CONSIGNEE'] as const;

const ImporterFormCollapsible: React.FC<ImporterFormProps> = ({
  value,
  onChange,
  error
}) => {
  const t = useTranslations('importer');
  const { config } = useLocale();
  const initialData = useMemo(() => getInitialImporterData(config.defaultCountryOfOrigin), [config]);
  const [importerData, setImporterData] = useState<ImporterData>(initialData);
  const [isExpanded, setIsExpanded] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  const tinTypes = useMemo(() =>
    TIN_TYPE_CODES.map(code => ({ value: code, label: t(`tinTypes.${code}`) })),
    [t]
  );
  const tinUsageTypes = useMemo(() =>
    TIN_USAGE_CODES.map(code => ({ value: code, label: t(`tinUsageTypes.${code}`) })),
    [t]
  );

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
            countryCode: parsed.address?.countryCode || config.defaultCountryOfOrigin
          },
          tins: parsed.tins || []
        });
        setHasData(true);
        setJsonError(null);
      } catch (e) {
        setJsonError(t('invalidJson'));
        setHasData(false);
      }
    } else {
      setImporterData(initialData);
      setHasData(false);
      setJsonError(null);
    }
  }, [value, config, initialData]);

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
        setJsonError(t('nameAndCompanyRequired'));
        return;
      }

      if (!importerData.address.city || !importerData.address.postalCode) {
        setJsonError(t('cityAndPostalRequired'));
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
      setJsonError(t('saveError'));
    }
  };

  const handleClear = () => {
    setImporterData(initialData);
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
            {t('title')}
          </Typography>
          {hasData && (
            <Chip
              label={t('configured')}
              color="success"
              size="small"
            />
          )}
          {!hasData && (
            <Chip
              label={t('notConfigured')}
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
            {t('contactInfo')}
          </Typography>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={`${t('personName')} *`}
                value={importerData.contact.personName}
                onChange={(e) => handleFormChange('contact.personName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={`${t('companyName')} *`}
                value={importerData.contact.companyName}
                onChange={(e) => handleFormChange('contact.companyName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('phoneNumber')}
                value={importerData.contact.phoneNumber}
                onChange={(e) => handleFormChange('contact.phoneNumber', e.target.value)}
                placeholder="905335010211"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={t('emailAddress')}
                type="email"
                value={importerData.contact.emailAddress}
                onChange={(e) => handleFormChange('contact.emailAddress', e.target.value)}
              />
            </Grid>
          </Grid>

          {/* Address Information */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('addressInfo')}
          </Typography>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            {/* Street Lines */}
            {importerData.address.streetLines.map((line, index) => (
              <Grid item xs={12} key={index}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    fullWidth
                    label={`${t('addressLine')} ${index + 1}${index === 0 ? ' *' : ''}`}
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
                      {t('delete')}
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
                <InputLabel>{t('city')} *</InputLabel>
                <Select
                  value={importerData.address.city}
                  onChange={(e: SelectChangeEvent<string>) => handleCityChange(e.target.value)}
                  label={`${t('city')} *`}
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
                label={t('regionCode')}
                value={importerData.address.stateOrProvinceCode}
                InputProps={{ readOnly: true }}
                helperText={t('regionCodeHelper')}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label={`${t('postalCode')} *`}
                value={importerData.address.postalCode}
                onChange={(e) => handleFormChange('address.postalCode', e.target.value)}
                required
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label={t('countryCode')}
                value={importerData.address.countryCode}
                InputProps={{ readOnly: true }}
                helperText={t('countryCodeHelper')}
              />
            </Grid>
          </Grid>

          {/* TIN Information */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              {t('taxNumbers')}
            </Typography>
            <Button color="primary" onClick={addTin}>
              {t('addTaxNumber')}
            </Button>
          </Box>

          {importerData.tins?.map((tin, index) => (
            <Grid container spacing={3} key={index} sx={{ mb: 2, p: 2, border: '1px solid #ddd', borderRadius: 1 }}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>{t('tinType')}</InputLabel>
                  <Select
                    value={tin.tinType}
                    onChange={(e: SelectChangeEvent<string>) => updateTin(index, 'tinType', e.target.value)}
                    label={t('tinType')}
                  >
                    {tinTypes.map(type => (
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
                  label={t('tinNumber')}
                  value={tin.number}
                  onChange={(e) => updateTin(index, 'number', e.target.value)}
                />
              </Grid>

              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>{t('tinUsage')}</InputLabel>
                  <Select
                    value={tin.usage || ''}
                    onChange={(e: SelectChangeEvent<string>) => updateTin(index, 'usage', e.target.value)}
                    label={t('tinUsage')}
                  >
                    {tinUsageTypes.map(usage => (
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
                  {t('delete')}
                </Button>
              </Grid>
            </Grid>
          ))}

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 3 }}>
            <Button variant="outlined" onClick={handleClear}>
              {t('clear')}
            </Button>
            <Button variant="contained" onClick={handleSave} color="primary">
              {t('save')}
            </Button>
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export default ImporterFormCollapsible;