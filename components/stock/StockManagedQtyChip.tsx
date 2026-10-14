import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import SyncLockRoundedIcon from '@mui/icons-material/SyncLockRounded';
import { useTranslations } from 'next-intl';

export type StockManagedQtyChipProps = {
  qty: number;
  /** false while stock sync is in dry run (tooltip explains nothing is changed yet) */
  live?: boolean;
  size?: 'small' | 'medium';
};

/** "Stok senkronu yönetiyor (7)" — shown instead of an editable quantity for managed variants. */
export default function StockManagedQtyChip({ qty, live = true, size = 'small' }: StockManagedQtyChipProps) {
  const t = useTranslations('stockSync');
  return (
    <Tooltip title={live ? t('managed.tooltip') : t('managed.dryRunTooltip')} slotProps={{ popper: { sx: { zIndex: 1600 } } }}>
      <Chip
        size={size}
        color={live ? 'primary' : 'default'}
        variant="outlined"
        icon={<SyncLockRoundedIcon fontSize="small" />}
        label={t('managed.chip', { qty })}
        sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
      />
    </Tooltip>
  );
}
