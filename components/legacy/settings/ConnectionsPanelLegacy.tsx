// Legacy body of components/settings/ConnectionsPanel.tsx, moved unchanged (settings §17 Group B; only the two
// relative imports became absolute). Rendered by the legacy settings page (flag `settings` off). Deleted with
// components/legacy/settings/SettingsLegacy.tsx one release after the flag flips.
import React, { useCallback, useEffect, useRef, useState } from 'react';
// @ts-ignore
import axios from 'axios';
import {
  Box, Typography, Button, Chip, FormControl, InputLabel, Select, MenuItem,
  FormHelperText, TextField, SelectChangeEvent, InputAdornment, CircularProgress,
} from '@mui/material';
import { toast } from 'react-hot-toast';
import { useFormatter, useTranslations } from 'next-intl';
import SettingsSection from '@/components/settings/SettingsSection';
import ConnectionCard from '@/components/settings/ConnectionCard';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import StorefrontIcon from '@mui/icons-material/Storefront';
import { useConnections, type ConnectionAccount, type ConnectionProvider } from '@/lib/hooks/useConnections';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { notify } from '@/lib/notify';

type AmazonMarketplaceOpt = { id: string; code: string; name: string; domain: string; region: string };

// Existing OAuth entry points (each 302s to the provider and back to /ayarlar).
const ETSY_CONNECT_HREF = '/api/integrations/etsy/connect';
const EBAY_CONNECT_HREF = '/api/integrations/ebay/connect';

const WIX_POLL_MS = 3000;
const WIX_POLL_MAX = 100; // ~5 min: install + permission consent takes a while

interface ConnectionsPanelProps {
  refreshKey: number; // bump to refetch provider details (e.g. after an OAuth callback)
}

export default function ConnectionsPanel({ refreshKey }: ConnectionsPanelProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const confirm = useConfirm();
  const { connections, isLoading, isValidating, error: connError, get, mutate } = useConnections();

  // Amazon marketplace details (selection list + chips) still come from its own endpoint.
  const [amazonSellerId, setAmazonSellerId] = useState<string | null>(null);
  const [amazonMarketplaces, setAmazonMarketplaces] = useState<AmazonMarketplaceOpt[]>([]);
  const [amazonAvailable, setAmazonAvailable] = useState<AmazonMarketplaceOpt[]>([]);
  const [amazonSelectedIds, setAmazonSelectedIds] = useState<string[]>(['A33AVAJ2PDY3EV']);
  const [amazonLoading, setAmazonLoading] = useState(false);
  const [amazonError, setAmazonError] = useState<unknown>(null);

  // Shopify connect form
  const [shopifyDomain, setShopifyDomain] = useState('');

  // Which disconnect is in flight (provider or provider:accountId)
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Wix install polling
  const [wixPoll, setWixPoll] = useState<'idle' | 'polling' | 'timedOut'>('idle');
  const wixSinceRef = useRef<string | null>(null);
  const wixTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAmazonDetails = useCallback(async () => {
    setAmazonLoading(true); setAmazonError(null);
    try {
      const r = await axios.get('/api/integrations/amazon/status');
      setAmazonSellerId(r.data.sellerId || null);
      setAmazonMarketplaces(r.data.marketplaces || []);
      setAmazonAvailable(r.data.availableMarketplaces || []);
      if (r.data.marketplaceIds?.length) setAmazonSelectedIds(r.data.marketplaceIds);
    } catch (e) {
      setAmazonError(e);
    } finally { setAmazonLoading(false); }
  }, []);

  useEffect(() => { fetchAmazonDetails(); }, [refreshKey, fetchAmazonDetails]);

  const stopWixPoll = useCallback(() => {
    if (wixTimerRef.current) clearInterval(wixTimerRef.current);
    wixTimerRef.current = null;
  }, []);
  useEffect(() => stopWixPoll, [stopWixPoll]); // never leak the interval past unmount

  // If Wix becomes connected some other way (e.g. SWR revalidates on focus after the install finished in the
  // other tab), stop polling and clear the waiting / "didn't finish" box. Keyed on the boolean, and only on a
  // false -> true transition so adding a second site while already connected keeps its poll running.
  const wixConnectedNow = !!get('wix')?.connected;
  const prevWixConnectedRef = useRef(wixConnectedNow);
  useEffect(() => {
    const was = prevWixConnectedRef.current;
    prevWixConnectedRef.current = wixConnectedNow;
    if (!was && wixConnectedNow) {
      stopWixPoll();
      setWixPoll('idle');
    }
  }, [wixConnectedNow, stopWixPoll]);

  // --- helpers ---
  const lastSyncText = (iso?: string | null) =>
    iso ? t('lastSyncAgo', { time: format.relativeTime(new Date(iso), new Date()) }) : '';
  const joinParts = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || undefined;
  const reauthHint = (provider: string) => t('reauthHint', { provider });

  const confirmDisconnect = (title: string, accounts: ConnectionAccount[]) => confirm({
    title,
    description: t('disconnectKeepsData'),
    items: accounts.map(a => a.name).filter(Boolean),
    confirmLabel: t('disconnect'),
    destructive: true,
  });

  /** Shared disconnect flow: confirm -> API -> refresh the shared connections cache (nav updates too). */
  const runDisconnect = async (
    key: string, title: string, accounts: ConnectionAccount[],
    request: () => Promise<unknown>, successMsg: string, failMsg: string, after?: () => void,
  ) => {
    if (!(await confirmDisconnect(title, accounts))) return;
    setBusyKey(key);
    try {
      await request();
      after?.();
      toast.success(successMsg);
    } catch (e) {
      notify.error(e, failMsg);
    } finally {
      setBusyKey(null);
      await mutate();
    }
  };

  // --- handlers ---
  const handleConnectAmazon = () => {
    if (amazonSelectedIds.length === 0) { toast.error(t('amazonSelectMarketplaceFirst')); return; }
    window.location.href = `/api/integrations/amazon/connect?marketplaceIds=${amazonSelectedIds.join(',')}`;
  };

  const startWixPoll = useCallback((since: string | null) => {
    stopWixPoll();
    setWixPoll('polling');
    let attempts = 0;
    let inFlight = false;
    const timer = setInterval(async () => {
      // Skip a tick while the previous check is still pending (no overlapping requests / duplicate toasts).
      if (inFlight) return;
      inFlight = true;
      attempts++;
      try {
        // 200 once a Wix site was stored/updated for this user at or after `since`, else 404.
        await axios.post('/api/integrations/wix/callback', { since });
        if (wixTimerRef.current !== timer) return; // poll was stopped/restarted meanwhile
        stopWixPoll();
        setWixPoll('idle');
        toast.success(t('wixConnectedSuccess'), { id: 'wix-connected' });
        void mutate();
      } catch (e: any) {
        if (wixTimerRef.current !== timer) return;
        const status = e?.response?.status;
        if (status === 401 || attempts >= WIX_POLL_MAX) {
          stopWixPoll();
          setWixPoll('timedOut');
        }
      } finally {
        inFlight = false;
      }
    }, WIX_POLL_MS);
    wixTimerRef.current = timer;
  }, [mutate, stopWixPoll, t]);

  const handleConnectWix = async () => {
    try {
      const res = await axios.get('/api/integrations/wix/connect');
      window.open(res.data.installUrl, '_blank');
      toast(t('wixInstallOpened'), { icon: 'ℹ️' });
      // `since` is server time; only a connection saved after this install started counts.
      wixSinceRef.current = res.data.since || null;
      startWixPoll(wixSinceRef.current);
    } catch (e) { notify.error(e, t('wixConnectFailed')); }
  };

  // --- derived status ---
  const loadingAll = isLoading && !connections;
  const ebay = get('ebay');
  const amazon = get('amazon');
  const wix = get('wix');
  const shopify = get('shopify');
  const accountsOf = (p: ConnectionProvider) => get(p)?.accounts ?? [];

  // Status endpoint failed and nothing cached: never claim "not connected".
  if (connError && !connections) {
    return (
      <SettingsSection title={t('marketplaceConnections')}>
        <ErrorState title={t('connectionsLoadFailed')} error={connError} onRetry={() => mutate()} retrying={isValidating} />
      </SettingsSection>
    );
  }

  const etsyAccounts = accountsOf('etsy');
  const wixAccounts = accountsOf('wix');
  const shopifyAccounts = accountsOf('shopify');

  const wixFooter = wixPoll !== 'idle' ? (
    wixPoll === 'polling' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} role="status">
        <CircularProgress size={14} />
        <Typography variant="body2" color="text.secondary">{t('wixWaiting')}</Typography>
      </Box>
    ) : (
      <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'rgba(245,158,11,0.06)', border: '1px solid', borderColor: 'warning.light' }} role="alert">
        <Typography variant="body2" fontWeight={600}>{t('wixPollTimedOut')}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{t('wixPollTimedOutDesc')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" onClick={() => startWixPoll(wixSinceRef.current)}
            sx={{ textTransform: 'none', minHeight: { xs: 44, sm: 32 }, flex: { xs: 1, sm: 'none' } }}>
            {t('wixCheckAgain')}
          </Button>
          <Button size="small" variant="outlined" onClick={handleConnectWix}
            sx={{ textTransform: 'none', minHeight: { xs: 44, sm: 32 }, flex: { xs: 1, sm: 'none' } }}>
            {t('wixOpenInstallAgain')}
          </Button>
        </Box>
      </Box>
    )
  ) : null;

  return (
    <>
      {connError && connections && (
        <Box sx={{ mb: 2 }}>
          <ErrorState compact title={t('connectionsLoadFailed')} error={connError} onRetry={() => mutate()} retrying={isValidating} />
        </Box>
      )}

      {/* Etsy — multi-shop */}
      <SettingsSection
        title={t('etsyShopConnections')}
        action={<Button variant="contained" href={ETSY_CONNECT_HREF} sx={{ textTransform: 'none', whiteSpace: 'nowrap', minHeight: { xs: 44, sm: 36 } }}>{t('connectNewShop')}</Button>}
      >
        <Box sx={{ mb: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1.5 }}>
          <Typography variant="body2" color="warning.dark" fontWeight={700}>{t('etsyApiLimited')}</Typography>
          <Typography variant="caption" color="warning.dark">{t('etsyApiLimitedDesc')}</Typography>
        </Box>
        {loadingAll ? (
          <Typography color="text.secondary">{t('loadingEtsyShops')}</Typography>
        ) : etsyAccounts.length === 0 ? (
          <EmptyState icon={<StorefrontIcon sx={{ fontSize: 30 }} />} title={t('noEtsyShops')}
            action={<Button variant="outlined" href={ETSY_CONNECT_HREF} sx={{ textTransform: 'none', minHeight: 44 }}>{t('connectFirstShop')}</Button>} />
        ) : (
          etsyAccounts.map((shop) => (
            <ConnectionCard
              key={shop.id}
              name={shop.name}
              connected
              connectedLabel={t('connected')}
              needsReauth={shop.needsReauth}
              reauthHint={reauthHint('Etsy')}
              statusLabel={joinParts(shop.externalId && t('shopIdLabel', { id: shop.externalId }), lastSyncText(shop.lastSyncAt))}
              reconnectHref={ETSY_CONNECT_HREF}
              busy={busyKey === `etsy:${shop.id}`}
              onDisconnect={() => runDisconnect(
                `etsy:${shop.id}`, t('disconnectEtsyConfirm'), [shop],
                () => axios.post('/api/integrations/etsy/shops', { shopId: shop.id, action: 'delete' }),
                t('etsyShopDisconnected'), t('shopDisconnectFailed'),
              )}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t('marketplaceConnections')} description={t('ebayDesc')}>
        {/* eBay */}
        <ConnectionCard
          name="eBay"
          connected={!!ebay?.connected}
          loading={loadingAll}
          connectedLabel={t('ebayConnected')}
          notConnectedLabel={t('noEbayConnected')}
          needsReauth={ebay?.needsReauth}
          reauthHint={reauthHint('eBay')}
          connectHref={EBAY_CONNECT_HREF}
          connectLabel={t('connectEbay')}
          reconnectHref={EBAY_CONNECT_HREF}
          busy={busyKey === 'ebay'}
          onDisconnect={() => runDisconnect(
            'ebay', t('disconnectEbayConfirm'), ebay?.accounts ?? [],
            () => axios.delete('/api/integrations/ebay/status'),
            t('ebayDisconnected'), t('ebayDisconnectFailed'),
          )}
        />

        {/* Amazon */}
        <ConnectionCard
          name="Amazon"
          connected={!!amazon?.connected}
          loading={loadingAll}
          connectedLabel={t('amazonConnected')}
          notConnectedLabel={t('amazonAccountConnection')}
          needsReauth={amazon?.needsReauth}
          reauthHint={reauthHint('Amazon')}
          statusLabel={joinParts(
            (amazonSellerId || amazon?.accounts[0]?.externalId) && `${t('amazonSellerId')}: ${amazonSellerId || amazon?.accounts[0]?.externalId}`,
            lastSyncText(amazon?.accounts[0]?.lastSyncAt),
          )}
          detail={amazonMarketplaces.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {amazonMarketplaces.map((m) => <Chip key={m.id} size="small" label={`${m.code} · ${m.domain}`} />)}
            </Box>
          )}
          footer={amazonError ? (
            <ErrorState compact title={t('amazonDetailsLoadFailed')} error={amazonError} onRetry={fetchAmazonDetails} retrying={amazonLoading} />
          ) : null}
          // Reconnect re-runs OAuth with the selected marketplaces; until the stored selection has loaded it
          // would fall back to the default and drop the user's other marketplaces.
          onReconnect={amazonError || amazonLoading ? undefined : handleConnectAmazon}
          busy={busyKey === 'amazon'}
          onDisconnect={() => runDisconnect(
            'amazon', t('disconnectAmazonConfirm'), amazon?.accounts ?? [],
            () => axios.delete('/api/integrations/amazon/status'),
            t('amazonDisconnected'), t('amazonDisconnectFailed'),
            () => { setAmazonSellerId(null); setAmazonMarketplaces([]); },
          )}
        >
          {!amazonError && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('amazonSelectMarketplacesHelp')}</Typography>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel id="amazon-marketplaces-label">{t('amazonMarketplaces')}</InputLabel>
                <Select
                  labelId="amazon-marketplaces-label" multiple value={amazonSelectedIds} label={t('amazonMarketplaces')}
                  onChange={(e: SelectChangeEvent<string[]>) => { const val = e.target.value; setAmazonSelectedIds(typeof val === 'string' ? val.split(',') : val); }}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(selected as string[]).map((id) => { const m = amazonAvailable.find((x) => x.id === id); return <Chip key={id} size="small" label={m ? `${m.code} · ${m.domain}` : id} />; })}
                    </Box>
                  )}
                >
                  {amazonAvailable.map((m) => <MenuItem key={m.id} value={m.id}>{m.code} — {m.name} ({m.domain})</MenuItem>)}
                </Select>
                <FormHelperText>{t('amazonMarketplacesHelp')}</FormHelperText>
              </FormControl>
              <Button variant="contained" onClick={handleConnectAmazon} disabled={amazonSelectedIds.length === 0}
                sx={{ textTransform: 'none', minHeight: { xs: 44, sm: 36 }, width: { xs: '100%', sm: 'auto' } }}>
                {t('connectAmazon')}
              </Button>
            </Box>
          )}
        </ConnectionCard>

        {/* Wix */}
        <ConnectionCard
          name="Wix"
          connected={!!wix?.connected}
          loading={loadingAll}
          connectedLabel={t('wixConnected')}
          notConnectedLabel={t('noWixConnected')}
          description={t('wixDesc')}
          needsReauth={wix?.needsReauth}
          reauthHint={reauthHint('Wix')}
          detail={wixAccounts.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              {wixAccounts.map((s) => (
                <Typography key={s.id} variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                  {joinParts(s.name, lastSyncText(s.lastSyncAt))}
                </Typography>
              ))}
            </Box>
          )}
          onConnect={handleConnectWix}
          connectLabel={t('connectWix')}
          disabledConnect={wixPoll === 'polling'}
          onReconnect={handleConnectWix}
          footer={wixFooter}
          busy={busyKey === 'wix'}
          onDisconnect={() => runDisconnect(
            'wix', t('disconnectWixConfirm'), wixAccounts,
            () => axios.delete('/api/integrations/wix/status'),
            t('wixDisconnected'), t('wixDisconnectFailed'),
          )}
        />

        {/* Shopify */}
        <ConnectionCard
          name="Shopify"
          connected={!!shopify?.connected}
          loading={loadingAll}
          connectedLabel={t('shopifyConnected')}
          notConnectedLabel={t('noShopifyConnected')}
          description={t('shopifyDesc')}
          needsReauth={shopify?.needsReauth}
          reauthHint={reauthHint('Shopify')}
          detail={shopifyAccounts.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              {shopifyAccounts.map((s) => (
                <Typography key={s.id} variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                  {joinParts(s.name, lastSyncText(s.lastSyncAt))}
                </Typography>
              ))}
            </Box>
          )}
          busy={busyKey === 'shopify'}
          onDisconnect={() => runDisconnect(
            'shopify', t('disconnectShopifyConfirm'), shopifyAccounts,
            () => axios.delete('/api/integrations/shopify/status', { data: {} }),
            t('shopifyDisconnected'), t('shopifyDisconnectFailed'),
          )}
        >
          <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              size="small" placeholder={t('shopifyShopDomainPlaceholder')} value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value.replace(/\s/g, '').replace(/\.myshopify\.com$/i, ''))}
              sx={{ flex: 1 }}
              InputProps={{ endAdornment: <InputAdornment position="end"><Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>.myshopify.com</Typography></InputAdornment> }}
            />
            <Button variant="contained" disabled={!shopifyDomain.trim()} href={`/api/integrations/shopify/connect?shop=${encodeURIComponent(shopifyDomain.trim() + '.myshopify.com')}`}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap', minHeight: { xs: 44, sm: 40 } }}>
              {t('connectShopify')}
            </Button>
          </Box>
        </ConnectionCard>
      </SettingsSection>
    </>
  );
}
