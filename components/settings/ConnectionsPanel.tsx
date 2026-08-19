import React, { useCallback, useEffect, useState } from 'react';
// @ts-ignore
import axios from 'axios';
import {
  Box, Typography, Button, Paper, Chip, FormControl, InputLabel, Select, MenuItem,
  FormHelperText, TextField, SelectChangeEvent, InputAdornment,
} from '@mui/material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import SettingsSection from './SettingsSection';
import ConnectionCard from './ConnectionCard';
import EmptyState from '@/components/ui/EmptyState';
import StorefrontIcon from '@mui/icons-material/Storefront';

type AmazonMarketplaceOpt = { id: string; code: string; name: string; domain: string; region: string };

interface ConnectionsPanelProps {
  refreshKey: number; // bump to refetch all statuses (e.g. after an OAuth callback)
}

export default function ConnectionsPanel({ refreshKey }: ConnectionsPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { formatDateTime } = useLocale();

  // Etsy
  const [etsyShops, setEtsyShops] = useState<any[]>([]);
  const [etsyShopsLoading, setEtsyShopsLoading] = useState(false);
  const [etsyShopsError, setEtsyShopsError] = useState<string | null>(null);
  // eBay
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayTokenExpires, setEbayTokenExpires] = useState<string | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  // Amazon
  const [amazonConnected, setAmazonConnected] = useState(false);
  const [amazonTokenExpires, setAmazonTokenExpires] = useState<string | null>(null);
  const [amazonSellerId, setAmazonSellerId] = useState<string | null>(null);
  const [amazonMarketplaces, setAmazonMarketplaces] = useState<AmazonMarketplaceOpt[]>([]);
  const [amazonAvailable, setAmazonAvailable] = useState<AmazonMarketplaceOpt[]>([]);
  const [amazonSelectedIds, setAmazonSelectedIds] = useState<string[]>(['A33AVAJ2PDY3EV']);
  const [amazonLoading, setAmazonLoading] = useState(false);
  // Wix
  const [wixConnected, setWixConnected] = useState(false);
  const [wixSites, setWixSites] = useState<any[]>([]);
  const [wixLoading, setWixLoading] = useState(false);
  // Shopify
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyShops, setShopifyShops] = useState<any[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');

  const fetchEtsyShops = useCallback(async () => {
    setEtsyShopsLoading(true); setEtsyShopsError(null);
    try {
      const r = await axios.get('/api/integrations/etsy/shops');
      setEtsyShops(r.data.shops || []);
    } catch (e: any) {
      setEtsyShopsError(e.response?.data?.error || 'Failed to fetch Etsy shops');
    } finally { setEtsyShopsLoading(false); }
  }, []);

  const fetchEbayStatus = useCallback(async () => {
    setEbayLoading(true);
    try {
      const r = await axios.get('/api/integrations/ebay/status');
      setEbayConnected(r.data.connected); setEbayTokenExpires(r.data.tokenExpiresAt);
    } catch { setEbayConnected(false); } finally { setEbayLoading(false); }
  }, []);

  const fetchAmazonStatus = useCallback(async () => {
    setAmazonLoading(true);
    try {
      const r = await axios.get('/api/integrations/amazon/status');
      setAmazonConnected(r.data.connected); setAmazonTokenExpires(r.data.tokenExpiresAt);
      setAmazonSellerId(r.data.sellerId); setAmazonMarketplaces(r.data.marketplaces || []);
      setAmazonAvailable(r.data.availableMarketplaces || []);
      if (r.data.marketplaceIds?.length) setAmazonSelectedIds(r.data.marketplaceIds);
    } catch { setAmazonConnected(false); } finally { setAmazonLoading(false); }
  }, []);

  const fetchWixStatus = useCallback(async () => {
    setWixLoading(true);
    try {
      const r = await axios.get('/api/integrations/wix/status');
      setWixConnected(r.data.connected); setWixSites(r.data.sites || []);
    } catch { setWixConnected(false); } finally { setWixLoading(false); }
  }, []);

  const fetchShopifyStatus = useCallback(async () => {
    setShopifyLoading(true);
    try {
      const r = await axios.get('/api/integrations/shopify/status');
      setShopifyConnected(r.data.connected); setShopifyShops(r.data.shops || []);
    } catch { setShopifyConnected(false); } finally { setShopifyLoading(false); }
  }, []);

  useEffect(() => {
    fetchEtsyShops(); fetchEbayStatus(); fetchAmazonStatus(); fetchWixStatus(); fetchShopifyStatus();
  }, [refreshKey, fetchEtsyShops, fetchEbayStatus, fetchAmazonStatus, fetchWixStatus, fetchShopifyStatus]);

  // --- handlers ---
  const handleDisconnectEtsyShop = async (shopId: string) => {
    if (!window.confirm(t('disconnectEtsyConfirm'))) return;
    try {
      await axios.post('/api/integrations/etsy/shops', { shopId, action: 'delete' });
      toast.success(t('etsyShopDisconnected'));
      await fetchEtsyShops();
    } catch { toast.error(t('shopDisconnectFailed')); }
  };
  const handleDisconnectEbay = async () => {
    if (!window.confirm(t('disconnectEbayConfirm'))) return;
    try {
      await axios.delete('/api/integrations/ebay/status');
      setEbayConnected(false); setEbayTokenExpires(null);
      toast.success(t('ebayDisconnected'));
    } catch { toast.error(t('ebayDisconnectFailed')); }
  };
  const handleConnectAmazon = () => {
    if (amazonSelectedIds.length === 0) { toast.error(t('amazonSelectMarketplaceFirst')); return; }
    window.location.href = `/api/integrations/amazon/connect?marketplaceIds=${amazonSelectedIds.join(',')}`;
  };
  const handleDisconnectAmazon = async () => {
    if (!window.confirm(t('disconnectAmazonConfirm'))) return;
    try {
      await axios.delete('/api/integrations/amazon/status');
      setAmazonConnected(false); setAmazonTokenExpires(null); setAmazonSellerId(null); setAmazonMarketplaces([]);
      toast.success(t('amazonDisconnected'));
    } catch { toast.error(t('amazonDisconnectFailed')); }
  };
  const handleConnectWix = async () => {
    try {
      const res = await axios.get('/api/integrations/wix/connect');
      window.open(res.data.installUrl, '_blank');
      toast(t('wixInstallOpened'), { icon: 'ℹ️' });
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          await axios.post('/api/integrations/wix/callback', {});
          clearInterval(poll);
          toast.success(t('wixConnectedSuccess'));
          fetchWixStatus();
        } catch { if (attempts >= 40) clearInterval(poll); }
      }, 3000);
    } catch { toast.error(t('wixConnectFailed')); }
  };
  const handleDisconnectWix = async () => {
    if (!window.confirm(t('disconnectWixConfirm'))) return;
    try {
      await axios.delete('/api/integrations/wix/status');
      setWixConnected(false); setWixSites([]);
      toast.success(t('wixDisconnected'));
    } catch { toast.error(t('wixDisconnectFailed')); }
  };
  const handleDisconnectShopify = async (shopId?: string) => {
    if (!window.confirm(t('disconnectShopifyConfirm'))) return;
    try {
      await axios.delete('/api/integrations/shopify/status', { data: { shopId } });
      setShopifyConnected(false); setShopifyShops([]);
      toast.success(t('shopifyDisconnected'));
    } catch { toast.error(t('shopifyDisconnectFailed')); }
  };

  return (
    <>
      {/* Etsy — multi-shop */}
      <SettingsSection
        title={t('etsyShopConnections')}
        action={<Button variant="contained" href="/api/integrations/etsy/connect" sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>{t('connectNewShop')}</Button>}
      >
        <Box sx={{ mb: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1.5 }}>
          <Typography variant="body2" color="warning.dark" fontWeight={700}>{t('etsyApiLimited')}</Typography>
          <Typography variant="caption" color="warning.dark">{t('etsyApiLimitedDesc')}</Typography>
        </Box>
        {etsyShopsLoading ? (
          <Typography color="text.secondary">{t('loadingEtsyShops')}</Typography>
        ) : etsyShopsError ? (
          <Typography color="error">{tc('error')}: {etsyShopsError}</Typography>
        ) : etsyShops.length === 0 ? (
          <EmptyState icon={<StorefrontIcon sx={{ fontSize: 30 }} />} title={t('noEtsyShops')}
            action={<Button variant="outlined" href="/api/integrations/etsy/connect" sx={{ textTransform: 'none' }}>{t('connectFirstShop')}</Button>} />
        ) : (
          etsyShops.map((shop) => (
            <ConnectionCard
              key={shop.id}
              name={shop.shopName || `Shop ${shop.shopId}`}
              connected
              connectedLabel={t('connected')}
              statusLabel={`Shop ID: ${shop.shopId}${shop.tokenExpiresAt ? ` · ${t('tokenValidity')}: ${formatDateTime(shop.tokenExpiresAt)}` : ''}`}
              onDisconnect={() => handleDisconnectEtsyShop(shop.id)}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={t('marketplaceConnections')} description={t('ebayDesc')}>
        {/* eBay */}
        <ConnectionCard
          name="eBay"
          connected={ebayConnected}
          loading={ebayLoading}
          connectedLabel={t('ebayConnected')}
          notConnectedLabel={t('noEbayConnected')}
          statusLabel={ebayTokenExpires ? `${t('tokenValidity')}: ${formatDateTime(ebayTokenExpires)}` : undefined}
          connectHref="/api/integrations/ebay/connect"
          connectLabel={t('connectEbay')}
          reconnectHref="/api/integrations/ebay/connect"
          onDisconnect={handleDisconnectEbay}
        />

        {/* Amazon */}
        <ConnectionCard
          name="Amazon"
          connected={amazonConnected}
          loading={amazonLoading}
          connectedLabel={t('amazonConnected')}
          notConnectedLabel={t('amazonAccountConnection')}
          statusLabel={[amazonSellerId ? `${t('amazonSellerId')}: ${amazonSellerId}` : '', amazonTokenExpires ? `${t('tokenValidity')}: ${formatDateTime(amazonTokenExpires)}` : ''].filter(Boolean).join(' · ') || undefined}
          detail={amazonConnected && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {amazonMarketplaces.map((m) => <Chip key={m.id} size="small" label={`${m.code} · ${m.domain}`} />)}
            </Box>
          )}
          onReconnect={handleConnectAmazon}
          onDisconnect={handleDisconnectAmazon}
        >
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
            <Button variant="contained" onClick={handleConnectAmazon} disabled={amazonSelectedIds.length === 0} sx={{ textTransform: 'none' }}>{t('connectAmazon')}</Button>
          </Box>
        </ConnectionCard>

        {/* Wix */}
        <ConnectionCard
          name="Wix"
          connected={wixConnected}
          loading={wixLoading}
          connectedLabel={t('wixConnected')}
          notConnectedLabel={t('noWixConnected')}
          description={t('wixDesc')}
          detail={wixConnected && wixSites.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{wixSites.map((s: any) => s.siteName || s.siteId).join(', ')}</Typography>
          )}
          onConnect={handleConnectWix}
          connectLabel={t('connectWix')}
          onReconnect={handleConnectWix}
          onDisconnect={handleDisconnectWix}
        />

        {/* Shopify */}
        <ConnectionCard
          name="Shopify"
          connected={shopifyConnected}
          loading={shopifyLoading}
          connectedLabel={t('shopifyConnected')}
          notConnectedLabel={t('noShopifyConnected')}
          description={t('shopifyDesc')}
          detail={shopifyConnected && shopifyShops.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{shopifyShops.map((s: any) => s.shopName || s.shopDomain).join(', ')}</Typography>
          )}
          onDisconnect={() => handleDisconnectShopify()}
        >
          <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
            <TextField
              size="small" placeholder={t('shopifyShopDomainPlaceholder')} value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value.replace(/\s/g, '').replace(/\.myshopify\.com$/i, ''))}
              sx={{ flex: 1 }}
              InputProps={{ endAdornment: <InputAdornment position="end"><Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>.myshopify.com</Typography></InputAdornment> }}
            />
            <Button variant="contained" disabled={!shopifyDomain.trim()} href={`/api/integrations/shopify/connect?shop=${encodeURIComponent(shopifyDomain.trim() + '.myshopify.com')}`} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>{t('connectShopify')}</Button>
          </Box>
        </ConnectionCard>
      </SettingsSection>
    </>
  );
}
