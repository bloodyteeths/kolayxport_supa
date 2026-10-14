import React from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useTranslations } from 'next-intl';

export type LabelGuardCode = 'ORDER_CANCELLED' | 'ORDER_SHIPPED_EXTERNALLY';

/**
 * True when a label route answered with the W4 label guard (HTTP 409 +
 * { code: ORDER_CANCELLED | ORDER_SHIPPED_EXTERNALLY }).
 */
export function isLabelGuardResponse(status: number, body: any): body is { success: false; code: LabelGuardCode; messageKey: string } {
  return status === 409 && !!body && (body.code === 'ORDER_CANCELLED' || body.code === 'ORDER_SHIPPED_EXTERNALLY');
}

export interface CancelledOrderLabelDialogProps {
  open: boolean;
  code: LabelGuardCode | null;
  orderNumber?: string | null;
  /** Retry the label request with `forceCancelled: true`. */
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}

/**
 * Shown when a label route refuses a label for a cancelled / externally
 * shipped order. Rendered above the label drawers (z-index 1550), so it works
 * from inside UPSLabelDrawer / MngLabelDrawer / the FedEx flow.
 */
export default function CancelledOrderLabelDialog({ open, code, orderNumber, onConfirm, onClose, busy = false }: CancelledOrderLabelDialogProps) {
  const t = useTranslations('orderPipeline');
  const cancelled = code !== 'ORDER_SHIPPED_EXTERNALLY';
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      sx={{ zIndex: 1550 }}
      PaperProps={{ sx: { m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: undefined } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <WarningAmberRoundedIcon color={cancelled ? 'error' : 'warning'} />
        <Box component="span" sx={{ fontSize: 17, fontWeight: 600 }}>
          {cancelled ? t('labelGuard.cancelledTitle') : t('labelGuard.shippedTitle')}
        </Box>
      </DialogTitle>
      <DialogContent>
        {orderNumber ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('labelGuard.orderNumber', { orderNumber })}
          </Typography>
        ) : null}
        <Alert severity={cancelled ? 'error' : 'warning'} sx={{ mb: 1.5 }}>
          {cancelled ? t('labelGuard.cancelled') : t('labelGuard.shippedExternally')}
        </Alert>
        <Typography variant="body2">{t('labelGuard.overrideHint')}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} disabled={busy} variant="contained" disableElevation>
          {t('labelGuard.keepSafe')}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          color={cancelled ? 'error' : 'warning'}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t('labelGuard.createAnyway')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
