import React from 'react';
import { Grid, TextField } from '@mui/material';
import { useTranslations } from 'next-intl';
import SettingsSection from './SettingsSection';
import CredentialField from './CredentialField';
import { isMaskedSecret, type UserSettingsResponse } from '@/lib/hooks/useSettings';

interface ApiKeysPanelProps {
  integrationSettings: NonNullable<UserSettingsResponse['integrationSettings']>;
  onChange: (name: string, value: string) => void;
}

export default function ApiKeysPanel({ integrationSettings: s, onChange }: ApiKeysPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const v = (name: string) => (s?.[name] as string) || '';

  // Saved secrets arrive masked ('••••1234'). Typing next to the mask replaces
  // it with just the typed text. A partial edit of the mask (backspace, typing
  // inside it) keeps the saved secret; only clearing the whole field removes it.
  const onSecretChange = (name: string, value: string) => {
    const current = v(name);
    if (isMaskedSecret(current)) {
      if (value.includes(current)) value = value.replace(current, '');
      else if (isMaskedSecret(value)) value = current;
    }
    onChange(name, value);
  };
  const secretProps = (name: string) => ({
    name,
    value: v(name),
    onChange: onSecretChange,
    helperText: isMaskedSecret(v(name)) ? t('credential.savedReplaceHint') : undefined,
  });

  return (
    <>
      <SettingsSection title={t('section.ecommerceApis')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Veeqo API Key" {...secretProps('veeqoApiKey')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Shippo Token" {...secretProps('shippoToken')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Trendyol API Key" {...secretProps('trendyolApiKey')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="Trendyol API Secret" {...secretProps('trendyolApiSecret')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="Trendyol Supplier ID" name="trendyolSupplierId" value={v('trendyolSupplierId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('section.carriers')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="FedEx API Key" {...secretProps('fedexApiKey')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="FedEx API Secret" {...secretProps('fedexApiSecret')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="FedEx Account Number" name="fedexAccountNumber" value={v('fedexAccountNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="UPS API Key" {...secretProps('upsApiKey')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label="UPS API Secret" {...secretProps('upsApiSecret')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label="UPS Account Number" name="upsAccountNumber" value={v('upsAccountNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('mngCustomerNumber')} name="mngCustomerNumber" value={v('mngCustomerNumber')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('mngPassword')} {...secretProps('mngPassword')} /></Grid>
        </Grid>
      </SettingsSection>

      <SettingsSection title={t('section.accounting')}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutClientId')} name="parasutClientId" value={v('parasutClientId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('parasutClientSecret')} {...secretProps('parasutClientSecret')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutUsername')} name="parasutUsername" value={v('parasutUsername')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={4}><CredentialField secret label={t('parasutPassword')} {...secretProps('parasutPassword')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth label={t('parasutCompanyId')} name="parasutCompanyId" value={v('parasutCompanyId')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={6}><TextField fullWidth label={`Parasut Base URL (${tc('optional')})`} name="parasutBaseUrl" placeholder={t('parasutBaseUrlPlaceholder')} value={v('parasutBaseUrl')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
          <Grid item xs={12} sm={6} md={6}><TextField fullWidth label={`Parasut Redirect URI (${tc('optional')})`} name="parasutRedirectUri" placeholder={t('parasutRedirectUriPlaceholder')} value={v('parasutRedirectUri')} onChange={(e) => onChange(e.target.name, e.target.value)} /></Grid>
        </Grid>
      </SettingsSection>
    </>
  );
}
