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
  statusLabel?: string;          // e.g. "Shop ID: 123 · Last sync 5 minutes ago"
  connectedLabel?: string;       // badge label when connected
  notConnectedLabel?: string;    // badge label when not connected
  /** Connected but the stored grant has lapsed: warning badge + primary Reconnect. */
  needsReauth?: boolean;
  reauthHint?: string;
  detail?: React.ReactNode;      // extra info when connected (chips, site names)
  onConnect?: () => void;
  connectHref?: string;
  connectLabel?: string;
  onReconnect?: () => void;
  reconnectHref?: string;
  onDisconnect?: () => void;
  /** Disables the action buttons while a disconnect is in flight. */
  busy?: boolean;
  children?: React.ReactNode;    // extra controls shown when NOT connected (Amazon multiselect, Shopify domain)
  /** Always rendered below the row (e.g. Wix install polling state, inline errors). */
  footer?: React.ReactNode;
  disabledConnect?: boolean;
}

// 44px tap targets on phones, compact on desktop.
const actionSx = { textTransform: 'none', whiteSpace: 'nowrap', minHeight: { xs: 44, sm: 32 }, flex: { xs: 1, sm: 'none' } } as const;

/**
 * One marketplace connection row. Replaces the 5 near-duplicate Etsy/eBay/
 * Amazon/Wix/Shopify blocks. Per-marketplace spinner via `loading`.
 */
export default function ConnectionCard(props: ConnectionCardProps) {
  const {
    name, logo, description, connected, loading, statusLabel, connectedLabel, notConnectedLabel,
    needsReauth, reauthHint, detail, onConnect, connectHref, connectLabel, onReconnect, reconnectHref,
    onDisconnect, busy, children, footer, disabledConnect,
  } = props;
  const t = useTranslations('settings');

  const badgeVariant = !connected ? 'neutral' : needsReauth ? 'warning' : 'success';
  const badgeLabel = !connected
    ? (notConnectedLabel || t('notConnected'))
    : needsReauth ? t('reauthNeeded') : (connectedLabel || t('connected'));

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.5 }, mb: 2, border: '1px solid', borderRadius: 2,
        borderColor: connected ? (needsReauth ? 'warning.light' : 'success.light') : 'divider',
        bgcolor: connected ? (needsReauth ? 'rgba(245,158,11,0.04)' : 'rgba(16,185,129,0.03)') : 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          {logo && <Box sx={{ flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{logo}</Box>}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>{name}</Typography>
              {loading ? <CircularProgress size={14} /> : <StatusBadge variant={badgeVariant} label={badgeLabel} />}
            </Box>
            {description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{description}</Typography>}
            {connected && statusLabel && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, wordBreak: 'break-word' }}>{statusLabel}</Typography>
            )}
            {connected && needsReauth && reauthHint && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'warning.dark' }}>{reauthHint}</Typography>
            )}
            {connected && detail}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
          {connected ? (
            <>
              {(onReconnect || reconnectHref) && (
                <Button
                  size="small" variant={needsReauth ? 'contained' : 'outlined'} color={needsReauth ? 'warning' : 'primary'}
                  onClick={onReconnect} href={reconnectHref} disabled={busy} sx={actionSx}
                >
                  {t('reconnect')}
                </Button>
              )}
              {onDisconnect && (
                <Button size="small" variant="outlined" color="error" onClick={onDisconnect} disabled={busy} sx={actionSx}
                  startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
                  {t('disconnect')}
                </Button>
              )}
            </>
          ) : (
            !loading && (onConnect || connectHref) && !children && (
              <Button size="small" variant="contained" onClick={onConnect} href={connectHref} disabled={disabledConnect || busy} sx={actionSx}>
                {connectLabel || t('connect')}
              </Button>
            )
          )}
        </Box>
      </Box>

      {!connected && !loading && children && <Box sx={{ mt: 2 }}>{children}</Box>}
      {footer && <Box sx={{ mt: 2 }}>{footer}</Box>}
    </Paper>
  );
}
