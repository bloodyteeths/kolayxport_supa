import React from 'react';
import { Grid, TextField } from '@mui/material';
import { useTranslations } from 'next-intl';
import SettingsSection from './SettingsSection';
import CredentialField from './CredentialField';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';

interface ApiKeysPanelProps {
  integrationSettings: NonNullable<UserSettingsResponse['integrationSettings']>;
  onChange: (name: string, value: string) => void;
}

export default function ApiKeysPanel({ integrationSettings: s, onChange }: ApiKeysPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const v = (name: string) => (s?.[name] as string) || '';

  return (
    <>
      <SettingsSection title={t('section.ecommerceApis')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Veeqo API Key" name="veeqoApiKey" value={v('veeqoApiKey')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Shippo Token" name="shippoToken" value={v('shippoToken')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Trendyol API Key" name="trendyolApiKey" value={v('trendyolApiKey')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Trendyol API Secret" name="trendyolApiSecret" value={v('trendyolApiSecret')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="Trendyol Supplier ID" name="trendyolSupplierId" value={v('trendyolSupplierId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('section.carriers')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="FedEx API Key" name="fedexApiKey" value={v('fedexApiKey')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="FedEx API Secret" name="fedexApiSecret" value={v('fedexApiSecret')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="FedEx Account Number" name="fedexAccountNumber" value={v('fedexAccountNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="UPS API Key" name="upsApiKey" value={v('upsApiKey')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="UPS API Secret" name="upsApiSecret" value={v('upsApiSecret')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="UPS Account Number" name="upsAccountNumber" value={v('upsAccountNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('mngCustomerNumber')} name="mngCustomerNumber" value={v('mngCustomerNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('mngPassword')} name="mngPassword" value={v('mngPassword')} onChange={onChange} /></Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('section.accounting')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutClientId')} name="parasutClientId" value={v('parasutClientId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('parasutClientSecret')} name="parasutClientSecret" value={v('parasutClientSecret')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutUsername')} name="parasutUsername" value={v('parasutUsername')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('parasutPassword')} name="parasutPassword" value={v('parasutPassword')} onChange={onChange} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutCompanyId')} name="parasutCompanyId" value={v('parasutCompanyId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={6}><TextField fullWidth label={`Parasut Base URL (${tc('optional')})`} name="parasutBaseUrl" placeholder={t('parasutBaseUrlPlaceholder')} value={v('parasutBaseUrl')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={6}><TextField fullWidth label={`Parasut Redirect URI (${tc('optional')})`} name="parasutRedirectUri" placeholder={t('parasutRedirectUriPlaceholder')} value={v('parasutRedirectUri')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
        </Grid>
      </SettingsSection>
    </>
  );
}
