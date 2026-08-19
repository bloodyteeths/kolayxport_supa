import React from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { useTranslations } from 'next-intl';

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSubmitting: boolean;
  onSave: () => void;
}

/** Sticky bottom save bar for the form tabs (API & Carriers, Sender Profile). */
export default function SettingsSaveBar({ isDirty, isSubmitting, onSave }: SettingsSaveBarProps) {
  const t = useTranslations('settings');
  return (
    <Box
      sx={{
        position: 'sticky', bottom: 0, left: 0, right: 0, zIndex: 10, mt: 2,
        py: 1.5, px: { xs: 1.5, sm: 2 },
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2,
        borderTop: '1px solid', borderColor: 'divider',
        bgcolor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)',
        borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
      }}
    >
      {isDirty && (
        <Typography variant="body2" color="warning.main" sx={{ mr: 'auto', fontWeight: 600 }}>
          {t('saveBar.unsaved')}
        </Typography>
      )}
      <Button
        variant="contained"
        onClick={onSave}
        disabled={isSubmitting || !isDirty}
        startIcon={isSubmitting ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SaveIcon />}
        sx={{ minHeight: 44, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '10px' }}
      >
        {t('saveBar.save')}
      </Button>
    </Box>
  );
}
