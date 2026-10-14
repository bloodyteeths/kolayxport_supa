import { Box, Button, Checkbox, FormControlLabel, Paper, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import CopyButton from '@/components/ui/CopyButton';

interface LabelsBulkBarProps {
  count: number;
  pageAllSelected: boolean;
  pageSomeSelected: boolean;
  onTogglePage: (checked: boolean) => void;
  onClear: () => void;
  etgbEnabled: boolean;
  processingEtgb: boolean;
  onEtgb: () => void;
  /** Computed at click time. */
  getAddressesTsv: () => string;
}

/** Sticky bottom bar shown while orders are selected on the labels page. */
export default function LabelsBulkBar({
  count,
  pageAllSelected,
  pageSomeSelected,
  onTogglePage,
  onClear,
  etgbEnabled,
  processingEtgb,
  onEtgb,
  getAddressesTsv,
}: LabelsBulkBarProps) {
  const t = useTranslations('labels');
  if (count === 0) return null;

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
        mx: { xs: 0, sm: 0.5 },
        mt: 0.5,
        px: { xs: 1, sm: 1.5 },
        py: 0.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: { xs: 0, sm: 1.5 },
        pb: { xs: 'calc(6px + env(safe-area-inset-bottom))', sm: 0.75 },
      }}
    >
      <FormControlLabel
        sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
        control={
          <Checkbox
            size="small"
            checked={pageAllSelected}
            indeterminate={!pageAllSelected && pageSomeSelected}
            onChange={(e) => onTogglePage(e.target.checked)}
            sx={{ p: { xs: 1.25, md: 0.75 } }}
          />
        }
        label={t('selectPage')}
      />
      <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem' }}>
        {t('selectedCount', { count })}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', ml: 'auto', flexWrap: 'wrap' }}>
        <CopyButton
          variant="chip"
          size="medium"
          label={t('copyAddressesTsv')}
          successMessage={t('addressesCopied', { count })}
          value={getAddressesTsv}
        />
        {etgbEnabled && (
          <Button
            variant="contained"
            color="secondary"
            size="small"
            onClick={onEtgb}
            disabled={processingEtgb}
            sx={{ textTransform: 'none', minHeight: { xs: 44, md: 32 } }}
          >
            {processingEtgb ? t('processing') : `ETGB (${count})`}
          </Button>
        )}
        <Button size="small" onClick={onClear} sx={{ textTransform: 'none', minHeight: { xs: 44, md: 32 } }}>
          {t('clearSelection')}
        </Button>
      </Box>
    </Paper>
  );
}
