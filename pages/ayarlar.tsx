import React, { useEffect, useState } from 'react';
import { Container, Box, Paper, Tabs, Tab, Alert, CircularProgress, Typography } from '@mui/material';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import StorefrontIcon from '@mui/icons-material/Storefront';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import SyncIcon from '@mui/icons-material/Sync';
import { useRouter } from 'next/router';
import { toast as hotToast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import AppLayout from '../components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import { useSettings } from '@/lib/hooks/useSettings';
import BillingPanel from '@/components/settings/BillingPanel';
import ConnectionsPanel from '@/components/settings/ConnectionsPanel';
import ApiKeysPanel from '@/components/settings/ApiKeysPanel';
import SenderProfilePanel from '@/components/settings/SenderProfilePanel';
import SyncPanel from '@/components/settings/SyncPanel';
import SettingsSaveBar from '@/components/settings/SettingsSaveBar';

const TAB_KEYS = ['billing', 'connections', 'apiKeys', 'senderProfile', 'syncAdvanced'] as const;

// Toast wrapper so OAuth-callback handling can pass a severity.
function toast(message: string, severity: 'success' | 'error' | 'info' = 'info') {
  if (severity === 'success') hotToast.success(message);
  else if (severity === 'error') hotToast.error(message);
  else hotToast(message, { icon: 'ℹ️' });
}

export default function AyarlarPage() {
  const router = useRouter();
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { config } = useLocale();

  const {
    formData, subscriptionData, initialDataLoaded, isLoading, fetchError,
    isSubmitting, isDirty, handleInputChange, handleSave, importerJsonError,
  } = useSettings();

  const [tab, setTab] = useState(0);
  const [connRefreshKey, setConnRefreshKey] = useState(0);

  // Sync active tab from ?tab=
  useEffect(() => {
    const q = router.query.tab;
    if (typeof q === 'string') {
      const i = TAB_KEYS.indexOf(q as any);
      if (i >= 0) setTab(i);
    }
  }, [router.query.tab]);

  // OAuth callback results — toast, jump to Connections tab, refetch statuses.
  useEffect(() => {
    const { success, error, details } = router.query;
    const detailMsg = details ? ` ${decodeURIComponent(details as string)}` : '';
    let handled = true;
    if (success === 'etsy_connected') toast(t('etsyShopConnected'), 'success');
    else if (success === 'ebay_connected') toast(t('ebayConnectedSuccess'), 'success');
    else if (success === 'wix_connected') toast(t('wixConnectedSuccess'), 'success');
    else if (success === 'amazon_connected') toast(t('amazonConnectedSuccess'), 'success');
    else if (success === 'shopify_connected') toast(t('shopifyConnectedSuccess'), 'success');
    else if (error === 'wix_auth_failed' || error === 'wix_token_failed' || error === 'wix_callback_failed') toast(`${t('wixConnectionFailed')}${detailMsg}`, 'error');
    else if (error === 'ebay_auth_failed' || error === 'ebay_token_failed' || error === 'ebay_callback_failed') toast(`${t('ebayConnectionFailed')}${detailMsg}`, 'error');
    else if (error === 'amazon_auth_failed' || error === 'amazon_callback_failed' || error === 'amazon_csrf_failed' || error === 'amazon_no_marketplace_selected') toast(`${t('amazonConnectionFailed')}${detailMsg}`, 'error');
    else if (error === 'etsy_callback_failed' || error === 'etsy_auth_failed' || error === 'etsy_token_failed') toast(`${t('etsyConnectionFailed')}${detailMsg}`, 'error');
    else if (error === 'shopify_hmac_failed' || error === 'shopify_token_failed' || error === 'shopify_connection_failed') toast(`${t('shopifyConnectionFailed')}${detailMsg}`, 'error');
    else handled = false;

    if (handled) {
      setTab(1);
      setConnRefreshKey(k => k + 1);
      router.replace({ pathname: '/ayarlar', query: { tab: 'connections' } }, undefined, { shallow: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query]);

  const handleTabChange = (_: React.SyntheticEvent, v: number) => {
    setTab(v);
    router.replace({ pathname: '/ayarlar', query: { tab: TAB_KEYS[v] } }, undefined, { shallow: true });
  };

  if (isLoading && !initialDataLoaded) {
    return (
      <AppLayout title={t('loadingTitle')}>
        <Container sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>{tc('loading')}</Typography>
        </Container>
      </AppLayout>
    );
  }

  const tabLabel = (icon: React.ReactNode, label: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>{icon}<span>{label}</span></Box>
  );

  const showSaveBar = tab === 2 || tab === 3;

  return (
    <AppLayout title={t('pageTitle')}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, overflowX: 'hidden', maxWidth: '100%', px: { xs: 1.5, sm: 3 } }}>
        <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

        {fetchError && <Alert severity="error" sx={{ mb: 2 }}>{fetchError}</Alert>}

        <Paper elevation={0} sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
            <Tab label={tabLabel(<CreditCardIcon fontSize="small" />, t('tabs.billing'))} />
            <Tab label={tabLabel(<StorefrontIcon fontSize="small" />, t('tabs.connections'))} />
            <Tab label={tabLabel(<VpnKeyIcon fontSize="small" />, t('tabs.apiKeys'))} />
            <Tab label={tabLabel(<LocalShippingIcon fontSize="small" />, t('tabs.senderProfile'))} />
            <Tab label={tabLabel(<SyncIcon fontSize="small" />, t('tabs.syncAdvanced'))} />
          </Tabs>
        </Paper>

        {tab === 0 && <BillingPanel subscriptionData={subscriptionData} ready={initialDataLoaded} />}
        {tab === 1 && <ConnectionsPanel refreshKey={connRefreshKey} />}
        {tab === 2 && (
          <ApiKeysPanel
            integrationSettings={formData.integrationSettings || {}}
            onChange={(name, value) => handleInputChange('integrationSettings', name, value)}
          />
        )}
        {tab === 3 && (
          <SenderProfilePanel
            shipperProfile={formData.shipperProfile || {}}
            shippingSettings={formData.shippingSettings || {}}
            onChangeProfile={(name, value) => handleInputChange('shipperProfile', name, value)}
            onChangeShipping={(name, value) => handleInputChange('shippingSettings', name, value)}
            importerJsonError={importerJsonError}
            etgbCollapsed={config.etgbProminence === 'collapsed'}
          />
        )}
        {tab === 4 && <SyncPanel />}

        {showSaveBar && <SettingsSaveBar isDirty={isDirty} isSubmitting={isSubmitting} onSave={handleSave} />}
      </Container>
    </AppLayout>
  );
}
