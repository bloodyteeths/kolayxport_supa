import React, { useEffect, useRef, useState } from 'react';
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
import { useConnections } from '@/lib/hooks/useConnections';
import { sanitizeMessage } from '@/lib/notify';
import BillingPanel from '@/components/settings/BillingPanel';
import ConnectionsPanel from '@/components/settings/ConnectionsPanel';
import ApiKeysPanel from '@/components/settings/ApiKeysPanel';
import SenderProfilePanel from '@/components/settings/SenderProfilePanel';
import SyncPanel from '@/components/settings/SyncPanel';
import SettingsSaveBar from '@/components/settings/SettingsSaveBar';

// Connections is the default (first) tab; every tab stays deep-linkable via ?tab=<key>.
const TAB_KEYS = ['connections', 'billing', 'apiKeys', 'senderProfile', 'syncAdvanced'] as const;
type TabKey = typeof TAB_KEYS[number];
const DEFAULT_TAB: TabKey = 'connections';
const isTabKey = (v: unknown): v is TabKey => typeof v === 'string' && (TAB_KEYS as readonly string[]).includes(v);

// Tabs that render from the /api/user/settings payload. The others render immediately.
const SETTINGS_TABS: readonly TabKey[] = ['billing', 'apiKeys', 'senderProfile'];

// OAuth callbacks redirect here with ?success=<provider>_<x> or ?error=<provider>_<x>[&details=].
const PROVIDER_NAMES: Record<string, string> = {
  etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', wix: 'Wix',
  trendyol: 'Trendyol', hepsiburada: 'Hepsiburada',
};
// Existing per-provider messages in the `settings` namespace.
const PROVIDER_SUCCESS_KEY: Record<string, string> = {
  etsy: 'etsyShopConnected', ebay: 'ebayConnectedSuccess', amazon: 'amazonConnectedSuccess',
  shopify: 'shopifyConnectedSuccess', wix: 'wixConnectedSuccess',
};
const PROVIDER_FAILED_KEY: Record<string, string> = {
  etsy: 'etsyConnectionFailed', ebay: 'ebayConnectionFailed', amazon: 'amazonConnectionFailed',
  shopify: 'shopifyConnectionFailed', wix: 'wixConnectionFailed',
};
const OAUTH_PARAMS = ['success', 'error', 'details'] as const;

/** 'shopify_invalid_state' -> { id: 'shopify', name: 'Shopify', known: true } */
function providerOf(code: string): { id: string; name: string; known: boolean } | null {
  const id = code.split('_')[0]?.toLowerCase();
  if (!id) return null;
  return { id, name: PROVIDER_NAMES[id] || id, known: !!PROVIDER_NAMES[id] };
}

export default function AyarlarPage() {
  const router = useRouter();
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { config } = useLocale();
  const { mutate: refreshConnections } = useConnections();

  const {
    formData, subscriptionData, initialDataLoaded, isLoading, fetchError,
    isSubmitting, isDirty, handleInputChange, handleSave, importerJsonError,
  } = useSettings();

  const [tab, setTab] = useState<TabKey>(DEFAULT_TAB);
  const [connRefreshKey, setConnRefreshKey] = useState(0);
  const handledOAuth = useRef<string | null>(null);

  // Sync active tab from ?tab= (missing / unknown -> Connections).
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query.tab;
    setTab(isTabKey(q) ? q : DEFAULT_TAB);
  }, [router.isReady, router.query.tab]);

  // OAuth callback results: toast, jump to Connections, refetch statuses, strip the params.
  useEffect(() => {
    if (!router.isReady) return;
    const success = typeof router.query.success === 'string' ? router.query.success : '';
    const error = typeof router.query.error === 'string' ? router.query.error : '';
    if (!success && !error) return;

    const signature = `${success}|${error}`;
    if (handledOAuth.current === signature) return; // re-render / StrictMode guard
    handledOAuth.current = signature;

    if (success) {
      const p = providerOf(success);
      let msg: string;
      if (success === 'shopify_install_complete') msg = t('oauth.shopifyInstallComplete');
      else if (p && PROVIDER_SUCCESS_KEY[p.id]) msg = t(PROVIDER_SUCCESS_KEY[p.id] as any);
      else if (p?.known) msg = t('oauth.connectedGeneric', { provider: p.name });
      else msg = t('oauth.unknownSuccess');
      hotToast.success(msg, { id: `oauth-${signature}` });
    } else {
      const rawDetails = typeof router.query.details === 'string' ? router.query.details : '';
      let decoded = rawDetails;
      try { decoded = decodeURIComponent(rawDetails); } catch { /* already decoded by Next */ }
      const details = sanitizeMessage(decoded); // null for technical / JSON / HTML text
      const p = providerOf(error);
      let msg: string;
      if (error === 'amazon_no_marketplace_selected') msg = t('amazonSelectMarketplaceFirst');
      else if (error === 'shopify_expiring_token_required') msg = t('oauth.shopifyTokenType');
      else if (p?.known && /_(csrf_failed|invalid_state|hmac_failed)$/.test(error)) msg = t('oauth.securityCheckFailed', { provider: p.name });
      else if (p?.known && /_missing_params$/.test(error)) msg = t('oauth.missingParams', { provider: p.name });
      else if (p && PROVIDER_FAILED_KEY[p.id]) msg = t(PROVIDER_FAILED_KEY[p.id] as any);
      else if (p?.known) msg = t('oauth.failedGeneric', { provider: p.name });
      else msg = t('oauth.unknownFailed');
      if (details) msg = `${msg} ${details}`;
      hotToast.error(msg, { id: `oauth-${signature}`, duration: 7000 });
    }

    setTab('connections');
    setConnRefreshKey(k => k + 1);
    void refreshConnections();

    const rest = { ...router.query };
    OAUTH_PARAMS.forEach(k => { delete rest[k]; });
    router.replace({ pathname: '/ayarlar', query: { ...rest, tab: 'connections' } }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.success, router.query.error]);

  const handleTabChange = (_: React.SyntheticEvent, v: TabKey) => {
    setTab(v);
    router.replace({ pathname: '/ayarlar', query: { tab: v } }, undefined, { shallow: true });
  };

  const tabLabel = (icon: React.ReactNode, label: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>{icon}<span>{label}</span></Box>
  );

  // Only tabs fed by /api/user/settings wait for it; Connections and Sync render at once.
  const needsSettings = SETTINGS_TABS.includes(tab);
  const settingsPending = needsSettings && isLoading && !initialDataLoaded;
  // Never offer Save before the stored settings loaded: it would PATCH blank defaults over them.
  const showSaveBar = (tab === 'apiKeys' || tab === 'senderProfile') && initialDataLoaded;

  return (
    <AppLayout title={t('pageTitle')}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, maxWidth: '100%', px: { xs: 1.5, sm: 3 } }}>
        <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

        {needsSettings && fetchError && <Alert severity="error" sx={{ mb: 2 }}>{fetchError}</Alert>}

        <Paper elevation={0} sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
            <Tab value="connections" label={tabLabel(<StorefrontIcon fontSize="small" />, t('tabs.connections'))} />
            <Tab value="billing" label={tabLabel(<CreditCardIcon fontSize="small" />, t('tabs.billing'))} />
            <Tab value="apiKeys" label={tabLabel(<VpnKeyIcon fontSize="small" />, t('tabs.apiKeys'))} />
            <Tab value="senderProfile" label={tabLabel(<LocalShippingIcon fontSize="small" />, t('tabs.senderProfile'))} />
            <Tab value="syncAdvanced" label={tabLabel(<SyncIcon fontSize="small" />, t('tabs.syncAdvanced'))} />
          </Tabs>
        </Paper>

        {settingsPending ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }} color="text.secondary">{tc('loading')}</Typography>
          </Box>
        ) : (
          <>
            {tab === 'connections' && <ConnectionsPanel refreshKey={connRefreshKey} />}
            {tab === 'billing' && <BillingPanel subscriptionData={subscriptionData} ready={initialDataLoaded} />}
            {tab === 'apiKeys' && (
              <ApiKeysPanel
                integrationSettings={formData.integrationSettings || {}}
                onChange={(name, value) => handleInputChange('integrationSettings', name, value)}
              />
            )}
            {tab === 'senderProfile' && (
              <SenderProfilePanel
                shipperProfile={formData.shipperProfile || {}}
                shippingSettings={formData.shippingSettings || {}}
                onChangeProfile={(name, value) => handleInputChange('shipperProfile', name, value)}
                onChangeShipping={(name, value) => handleInputChange('shippingSettings', name, value)}
                importerJsonError={importerJsonError}
                etgbCollapsed={config.etgbProminence === 'collapsed'}
              />
            )}
            {tab === 'syncAdvanced' && <SyncPanel />}
          </>
        )}

        {showSaveBar && <SettingsSaveBar isDirty={isDirty} isSubmitting={isSubmitting} onSave={handleSave} />}
      </Container>
    </AppLayout>
  );
}
