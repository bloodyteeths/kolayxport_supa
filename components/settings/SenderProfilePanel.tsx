import React from 'react';
import { Grid, TextField, FormControl, InputLabel, Select, MenuItem, FormHelperText, Typography, SelectChangeEvent } from '@mui/material';
import { useTranslations } from 'next-intl';
import SettingsSection from './SettingsSection';
import ImporterFormCollapsible from '@/components/ImporterFormCollapsible';
import { fedexOptionsData, FedExOption } from '@/lib/fedex/fedex.config';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';

const COUNTRY_CODE_KEYS = ['TR', 'US', 'DE', 'GB'] as const;
const CURRENCY_CODE_KEYS = ['TRY', 'USD', 'EUR'] as const;
const tinTypes = [
  'VAT', 'EORI', 'IOSS', 'OSS', 'PAN', 'GST', 'TIN', 'EIN', 'SSN', 'NIE', 'DNI', 'CNPJ', 'CPF', 'DUNS',
  'FEDERAL_TAX_ID', 'STATE_TAX_ID', 'BUSINESS_NATIONAL', 'PERSONAL_NATIONAL', 'BUSINESS_UNION', 'PERSONAL_UNION',
].map(type => ({ value: type, label: type.replace(/_/g, ' ') }));

interface SenderProfilePanelProps {
  shipperProfile: NonNullable<UserSettingsResponse['shipperProfile']>;
  shippingSettings: NonNullable<UserSettingsResponse['shippingSettings']>;
  onChangeProfile: (name: string, value: string) => void;
  onChangeShipping: (name: string, value: string | boolean) => void;
  importerJsonError: string | null;
  etgbCollapsed: boolean;
}

export default function SenderProfilePanel(props: SenderProfilePanelProps) {
  const { shipperProfile: p, shippingSettings: sh, onChangeProfile, onChangeShipping, importerJsonError, etgbCollapsed } = props;
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const pv = (name: string) => (p?.[name] as string) || '';
  const onP = (e: any) => onChangeProfile(e.target.name, e.target.value);
  const onSel = (e: SelectChangeEvent<string>) => onChangeProfile(e.target.name as string, e.target.value as string);

  return (
    <>
      <SettingsSection title={t('section.companyAddress')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}><TextField fullWidth required label={t('companyName')} name="shipperName" value={pv('shipperName')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6}><TextField fullWidth required label={t('authorizedPerson')} name="shipperPersonName" value={pv('shipperPersonName')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6}><TextField fullWidth required label={t('phone')} name="shipperPhoneNumber" value={pv('shipperPhoneNumber')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6}><TextField fullWidth label={t('fedexFolderId')} name="fedexFolderId" value={pv('fedexFolderId')} onChange={onP} /></Grid>
          <Grid item xs={12}><TextField fullWidth required label={t('address1')} name="shipperStreet1" value={pv('shipperStreet1')} onChange={onP} /></Grid>
          <Grid item xs={12}><TextField fullWidth label={t('address2')} name="shipperStreet2" value={pv('shipperStreet2')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth required label={t('city')} name="shipperCity" value={pv('shipperCity')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('stateRegionCode')} name="shipperStateCode" value={pv('shipperStateCode')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth required label={t('postalCode')} name="shipperPostalCode" value={pv('shipperPostalCode')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel id="shipperCountryCode-label">{t('countryCode')}</InputLabel>
              <Select labelId="shipperCountryCode-label" name="shipperCountryCode" label={t('countryCode')} value={pv('shipperCountryCode')} onChange={onSel}>
                {COUNTRY_CODE_KEYS.map(code => <MenuItem key={code} value={code}>{t(`countryCodes.${code}`)}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth required label={t('taxNumber')} name="shipperTinNumber" value={pv('shipperTinNumber')} onChange={onP} /></Grid>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel id="shipperTinType-label">{t('taxType')}</InputLabel>
              <Select labelId="shipperTinType-label" name="shipperTinType" label={t('taxType')} value={pv('shipperTinType')} onChange={onSel}>
                {tinTypes.map(tt => <MenuItem key={tt.value} value={tt.value}>{tt.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('section.customsCurrency')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel id="defaultCurrencyCode-label">{t('defaultCurrency')}</InputLabel>
              <Select labelId="defaultCurrencyCode-label" name="defaultCurrencyCode" label={t('defaultCurrency')} value={pv('defaultCurrencyCode') || 'USD'} onChange={onSel}>
                {CURRENCY_CODE_KEYS.map(code => <MenuItem key={code} value={code}>{t(`currencyCodes.${code}`)}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel id="dutiesPaymentType-label">{t('customsDutyPayment')}</InputLabel>
              <Select labelId="dutiesPaymentType-label" name="dutiesPaymentType" label={t('customsDutyPayment')} value={pv('dutiesPaymentType') || 'SENDER'} onChange={onSel}>
                {(fedexOptionsData.dutiesPaymentTypes as FedExOption[]).map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth required>
              <InputLabel id="defaultShippingChargesPaymentType-label">Default Shipping Charges Payment Type</InputLabel>
              <Select labelId="defaultShippingChargesPaymentType-label" name="defaultShippingChargesPaymentType" label="Default Shipping Charges Payment Type" value={pv('defaultShippingChargesPaymentType') || 'SENDER'} onChange={onSel}>
                {(fedexOptionsData.shippingChargesPaymentTypes as FedExOption[]).map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <ImporterFormCollapsible
              value={pv('importerOfRecord')}
              onChange={(jsonString: string) => onChangeProfile('importerOfRecord', jsonString)}
              error={importerJsonError}
            />
          </Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('etgbSettings')} description={t('etgbDesc')} collapsible={etgbCollapsed} defaultExpanded={!etgbCollapsed}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <TextField fullWidth type="email" label={t('etgbRecipientEmail')} name="etgbRecipientEmail" value={sh?.etgbRecipientEmail || ''} onChange={(e) => onChangeShipping(e.target.name, e.target.value)} helperText={t('etgbRecipientEmailHelper')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel id="etgb-enabled-label">{t('etgbFeature')}</InputLabel>
              <Select labelId="etgb-enabled-label" name="etgbEnabled" label={t('etgbFeature')} value={sh?.etgbEnabled ? 'true' : 'false'} onChange={(e: SelectChangeEvent<string>) => onChangeShipping('etgbEnabled', e.target.value === 'true')}>
                <MenuItem value="true">{tc('active')}</MenuItem>
                <MenuItem value="false">{tc('passive')}</MenuItem>
              </Select>
              <FormHelperText>{t('etgbFeatureHelper')}</FormHelperText>
            </FormControl>
          </Grid>
          <Grid item xs={12}><Typography variant="body2" color="text.secondary">{t('etgbNote')}</Typography></Grid>
        </Grid>
      </SettingsSection>
    </>
  );
}
