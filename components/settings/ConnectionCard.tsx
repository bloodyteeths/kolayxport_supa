import React from 'react';
import { Paper, Box, Typography, Button, CircularProgress } from '@mui/material';
import StatusBadge from '@/components/ui/StatusBadge';
import { useTranslations } from 'next-intl';

interface ConnectionCardProps {
  name: string;
  logo?: React.ReactNode;
  description?: string;
  connected: boolean;
  loading?: boolean;
  statusLabel?: string;          // e.g. token validity / seller id line
  connectedLabel?: string;       // badge label when connected
  notConnectedLabel?: string;    // badge label when not connected
  detail?: React.ReactNode;      // extra info (chips, site names)
  onConnect?: () => void;
  connectHref?: string;
  connectLabel?: string;
  onReconnect?: () => void;
  reconnectHref?: string;
  onDisconnect?: () => void;
  children?: React.ReactNode;    // extra controls (Amazon multiselect, Shopify domain)
  disabledConnect?: boolean;
}

/**
 * One marketplace connection row. Replaces the 5 near-duplicate Etsy/eBay/
 * Amazon/Wix/Shopify blocks. Per-marketplace spinner via `loading`.
 */
export default function ConnectionCard(props: ConnectionCardProps) {
  const {
    name, logo, description, connected, loading, statusLabel, connectedLabel, notConnectedLabel, detail,
    onConnect, connectHref, connectLabel, onReconnect, reconnectHref, onDisconnect,
    children, disabledConnect,
  } = props;
  const t = useTranslations('settings');

  return (
    <Paper
      elevation={0}
      sx={{ p: { xs: 2, sm: 2.5 }, mb: 2, border: '1px solid', borderColor: connected ? 'success.light' : 'divider', borderRadius: 2, bgcolor: connected ? 'rgba(16,185,129,0.03)' : 'background.paper' }}
    >
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          {logo && <Box sx={{ flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{logo}</Box>}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{name}</Typography>
              {loading ? (
                <CircularProgress size={14} />
              ) : (
                <StatusBadge variant={connected ? 'success' : 'neutral'} label={connected ? (connectedLabel || 'Connected') : (notConnectedLabel || 'Not connected')} />
              )}
            </Box>
            {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{description}</Typography>}
            {connected && statusLabel && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusLabel}</Typography>
            )}
            {connected && detail}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
          {connected ? (
            <>
              {(onReconnect || reconnectHref) && (
                <Button size="small" variant="outlined" onClick={onReconnect} href={reconnectHref} sx={{ textTransform: 'none' }}>
                  {t('reconnect')}
                </Button>
              )}
              {onDisconnect && (
                <Button size="small" variant="outlined" color="error" onClick={onDisconnect} sx={{ textTransform: 'none' }}>
                  {t('disconnect')}
                </Button>
              )}
            </>
          ) : (
            !loading && (onConnect || connectHref) && !children && (
              <Button size="small" variant="contained" onClick={onConnect} href={connectHref} disabled={disabledConnect} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                {connectLabel || 'Connect'}
              </Button>
            )
          )}
        </Box>
      </Box>

      {!connected && !loading && children && <Box sx={{ mt: 2 }}>{children}</Box>}
    </Paper>
  );
}
