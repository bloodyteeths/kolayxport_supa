import React from 'react';
import { Button } from '@mui/material';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';
import { PRINT_MAX_IDS } from './types';

interface PrintSelectionActionsProps {
  /** Order ids (Order.id) currently selected. */
  orderIds: string[];
}

/**
 * "Packing slips" / "Pick list" buttons for a bulk selection. Each opens the
 * print page in a new tab synchronously inside the click handler (no await
 * before window.open) so pop-up blockers treat it as a user gesture.
 */
export default function PrintSelectionActions({ orderIds }: PrintSelectionActionsProps) {
  const t = useTranslations('printSlips');
  if (orderIds.length === 0) return null;

  const open = (path: 'packing-slips' | 'pick-list') => {
    const ids = orderIds.slice(0, PRINT_MAX_IDS);
    const win = window.open(`/app/print/${path}?ids=${encodeURIComponent(ids.join(','))}`, '_blank');
    if (!win) {
      notify.info(t('popupBlocked'));
      return;
    }
    try { win.opener = null; } catch { /* ignore */ }
    if (orderIds.length > PRINT_MAX_IDS) {
      notify.info(t('truncated', { max: PRINT_MAX_IDS }));
    }
  };

  const sx = { textTransform: 'none', minHeight: { xs: 44, md: 32 } } as const;
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<ReceiptLongRoundedIcon />} onClick={() => open('packing-slips')} sx={sx}>
        {t('packingSlips')}
      </Button>
      <Button size="small" variant="outlined" startIcon={<ChecklistRoundedIcon />} onClick={() => open('pick-list')} sx={sx}>
        {t('pickList')}
      </Button>
    </>
  );
}
